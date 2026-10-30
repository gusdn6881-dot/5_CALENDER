// 주소창에 과거 쿼리 파라미터(sb_url, sb_key)가 남아 있으면 키를 저장하지 않고 주소만 정리
(function stripLegacySecretParamsFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('sb_url') || params.has('sb_key')) {
      params.delete('sb_url');
      params.delete('sb_key');
      const qs = params.toString();
      const cleanUrl = window.location.origin + window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  } catch (e) {}
})();

// ==============================================================================
// 🔐 Supabase 부부 전용 인증 · 구성원 확인 · 실시간 동기화 모듈
// ==============================================================================
const DEFAULT_SUPABASE_URL = 'https://jfmwbjefszwvfxuxtgzg.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_U5bm3JSYDqZq3Sa3wifm5Q_uYBPSNpp';
const COUPLE_LOCK_ID = '__couple_lock__';
const COUPLE_LOCK_HUSBAND_ID = '__couple_lock_husband__';
const COUPLE_LOCK_WIFE_ID = '__couple_lock_wife__';
const COUPLE_LOCK_BOOTSTRAP_ID = '__couple_lock_bootstrap__';
const COUPLE_LOCK_VERIFIER = 'WOORIHAROO_COUPLE_VERIFIED_V1';
const COUPLE_VAULT_PREFIX = 'COUPLE_VAULT_V1:';
const BOOTSTRAP_PASSCODE = 'wooriharoo-couple-bootstrap-key-v1';

let supabaseClient = null;
let realtimeChannel = null;
let authSubscription = null;
let isRemoteUpdating = false;
let coupleCryptoKey = null;
let currentMasterSecret = '';
function isAccountPasswordSetupLink(locationLike) {
  const locationValue = locationLike || window.location;
  const hashParams = new URLSearchParams(String(locationValue.hash || '').replace(/^#/, ''));
  const queryParams = new URLSearchParams(String(locationValue.search || '').replace(/^\?/, ''));
  const hashType = hashParams.get('type');
  const queryType = queryParams.get('type');
  return hashType === 'invite' || hashType === 'recovery' || queryType === 'invite' || queryType === 'recovery';
}

async function updateInvitedAccountPassword(client, password, confirmation) {
  const cleanPassword = String(password || '');
  if (cleanPassword.length < 10) return { ok: false, reason: 'password_too_short' };
  if (cleanPassword !== String(confirmation || '')) return { ok: false, reason: 'password_mismatch' };
  if (!client || !client.auth || typeof client.auth.updateUser !== 'function') {
    return { ok: false, reason: 'auth_unavailable' };
  }
  const { data, error } = await client.auth.updateUser({ password: cleanPassword });
  if (error) return { ok: false, reason: 'update_failed', error: error };
  return { ok: true, user: (data && data.user) || null };
}

async function requestAccountPasswordReset(client, email, redirectTo) {
  const cleanEmail = String(email || '').trim();
  if (!cleanEmail) return { ok: false, reason: 'email_required' };
  if (!client || !client.auth || typeof client.auth.resetPasswordForEmail !== 'function') {
    return { ok: false, reason: 'auth_unavailable' };
  }
  const { error } = await client.auth.resetPasswordForEmail(cleanEmail, { redirectTo: redirectTo });
  if (error) return { ok: false, reason: 'request_failed', error: error };
  return { ok: true };
}

async function sendAccountPasswordReset() {
  const emailInput = document.getElementById('gateEmailInput');
  const gateMsg = document.getElementById('gateStatusMessage');
  const email = String((emailInput && emailInput.value) || '').trim();
  const showGateMessage = function(message, success) {
    if (!gateMsg) return;
    gateMsg.textContent = message;
    gateMsg.className = success
      ? 'text-xs font-semibold rounded-xl p-3 bg-emerald-50 text-emerald-700 border border-emerald-200'
      : 'text-xs font-semibold rounded-xl p-3 bg-rose-50 text-rose-700 border border-rose-200';
    gateMsg.classList.remove('hidden');
  };

  if (!supabaseClient) await initSupabase(state.supabaseUrl, state.supabaseKey, false);
  if (!supabaseClient) {
    showGateMessage('로그인 서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.', false);
    return false;
  }

  try {
    const result = await requestAccountPasswordReset(
      supabaseClient,
      email,
      window.location.origin + window.location.pathname
    );
    if (!result.ok) {
      const messages = {
        email_required: '먼저 이메일 주소를 입력해 주세요.',
        auth_unavailable: '로그인 서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.',
        request_failed: '재설정 메일을 보내지 못했어요. 이메일 주소와 메일 발송 제한을 확인해 주세요.'
      };
      showGateMessage(messages[result.reason] || '재설정 메일을 보내지 못했어요.', false);
      return false;
    }
    showGateMessage('재설정 링크를 요청했어요. 받은 메일을 열고 새 암호를 정해 주세요.', true);
    return true;
  } catch (error) {
    console.warn('Account password reset request failed:', error);
    showGateMessage('재설정 메일 요청 중 오류가 났어요. 잠시 뒤 다시 시도해 주세요.', false);
    return false;
  }
}

async function finishAccountPasswordSetup() {
  const passwordInput = document.getElementById('gateInvitePasswordInput');
  const confirmInput = document.getElementById('gateInvitePasswordConfirmInput');
  const status = document.getElementById('gatePasswordSetupStatus');
  const showMessage = function(message, success) {
    if (!status) return;
    status.textContent = message;
    status.className = success
      ? 'text-xs font-semibold rounded-xl p-3 bg-emerald-50 text-emerald-700 border border-emerald-200'
      : 'text-xs font-semibold rounded-xl p-3 bg-rose-50 text-rose-700 border border-rose-200';
    status.classList.remove('hidden');
  };
  if (authState.status !== 'password_setup' || !authState.user) {
    showMessage('초대 링크를 다시 열어 주세요. 링크가 만료되었을 수 있어요.', false);
    return false;
  }

  try {
    const result = await updateInvitedAccountPassword(
      supabaseClient,
      passwordInput ? passwordInput.value : '',
      confirmInput ? confirmInput.value : ''
    );
    if (!result.ok) {
      const messages = {
        password_too_short: '계정 암호는 10자 이상으로 정해 주세요.',
        password_mismatch: '두 암호가 서로 달라요. 다시 확인해 주세요.',
        auth_unavailable: '로그인 연결이 만료됐어요. 초대 메일 링크를 다시 열어 주세요.',
        update_failed: '암호 저장에 실패했어요. 초대 링크가 만료되지 않았는지 확인해 주세요.'
      };
      showMessage(messages[result.reason] || '암호를 저장하지 못했어요. 다시 시도해 주세요.', false);
      return false;
    }

    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
    pendingAccountPasswordSetup = false;
    window.history.replaceState({}, document.title, window.location.origin + window.location.pathname + window.location.search);
    showToast('계정 암호를 저장했어요. 부부 등록 상태를 확인할게요.');
    return await verifyMemberAndSync(result.user || authState.user, true, '');
  } catch (error) {
    console.warn('Invite account password update failed:', error);
    showMessage('암호 저장 중 오류가 났어요. 초대 링크를 다시 열어 시도해 주세요.', false);
    return false;
  }
}

let pendingAccountPasswordSetup = isAccountPasswordSetupLink(window.location);
let remoteSnapshotIds = { events: new Set(), todos: new Set(), diaries: new Set() };
let authState = {
  status: 'signed_out', // 'offline' | 'signed_out' | 'checking' | 'unauthorized' | 'authorized' | 'error'
  user: null,
  member: null,
  lastVerifiedSyncAt: null,
  errorMessage: '',
  schemaProtected: true,
  hasRemoteLock: false,
  lockStatusKnown: false,
  husbandLocked: false,
  wifeLocked: false
};

function isSystemLockRecordId(id) {
  const s = String(id || '');
  return s === COUPLE_LOCK_ID || s === COUPLE_LOCK_HUSBAND_ID || s === COUPLE_LOCK_WIFE_ID || s === COUPLE_LOCK_BOOTSTRAP_ID || s.indexOf('__couple_lock') === 0;
}

function isStickerRecordId(id) {
  return String(id || '').indexOf('__sticker__') === 0;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function deriveCoupleCryptoKey(passcode) {
  const clean = String(passcode || '').trim();
  if (!clean || !window.crypto || !window.crypto.subtle) return null;
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(clean),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('wooriharoo-couple-salt-v1'),
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptCoupleField(plainText, keyOverride) {
  const key = keyOverride || coupleCryptoKey;
  const str = String(plainText ?? '');
  if (!str || !key || str.startsWith('ENC1:')) return str;
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(str));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return 'ENC1:' + bytesToBase64(combined);
}

async function decryptCoupleField(cipherText, keyOverride) {
  const key = keyOverride || coupleCryptoKey;
  const str = String(cipherText ?? '');
  if (!str || !str.startsWith('ENC1:')) return str;
  if (!key) return '🔒 (암구호 잠금)';
  try {
    const raw = base64ToBytes(str.slice(5));
    const iv = raw.subarray(0, 12);
    const ct = raw.subarray(12);
    const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch (e) {
    return null;
  }
}

function generateRandomMasterSecret() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

function makeSystemLockRow(id, encryptedTitle) {
  return {
    id: id,
    title: encryptedTitle,
    date: '1970-01-01',
    time: '',
    owner: 'system',
    color: '#6366F1',
    start_time: '1970-01-01T00:00:00',
    end_time: '1970-01-01T23:59:59'
  };
}

async function refreshRemoteLockStatus() {
  if (!supabaseClient) {
    authState.lockStatusKnown = false;
    return false;
  }
  try {
    const { data, error } = await supabaseClient
      .from('events')
      .select('id,title')
      .in('id', [COUPLE_LOCK_HUSBAND_ID, COUPLE_LOCK_WIFE_ID, COUPLE_LOCK_BOOTSTRAP_ID]);
    if (error) {
      authState.lockStatusKnown = false;
      return false;
    }
    const rows = data || [];
    authState.husbandLocked = rows.some(r => r.id === COUPLE_LOCK_HUSBAND_ID && String(r.title || '').startsWith('ENC1:'));
    authState.wifeLocked = rows.some(r => r.id === COUPLE_LOCK_WIFE_ID && String(r.title || '').startsWith('ENC1:'));
    authState.hasRemoteLock = authState.husbandLocked || authState.wifeLocked;
    authState.lockStatusKnown = true;
    return true;
  } catch (e) {
    authState.lockStatusKnown = false;
    return false;
  }
}

async function verifyOrCreateRemoteCoupleLock(role, passcode) {
  const clean = String(passcode || '').trim();
  if (!clean) return { ok: false, reason: 'empty' };
  const norm = clean.toLowerCase().replace(/\s+/g, '');
  const personalKey = await deriveCoupleCryptoKey(role + ':' + norm);
  if (!personalKey) return { ok: false, reason: 'crypto_unavailable' };

  const myLockId = role === 'wife' ? COUPLE_LOCK_WIFE_ID : COUPLE_LOCK_HUSBAND_ID;
  const partnerLockId = role === 'wife' ? COUPLE_LOCK_HUSBAND_ID : COUPLE_LOCK_WIFE_ID;

  if (!supabaseClient) {
    // A configured remote project that failed to initialize must never fall back
    // to a locally derived key and masquerade as a successful remote unlock.
    if (state.supabaseUrl && state.supabaseKey) {
      return { ok: false, reason: 'server_unavailable' };
    }
    const localMaster = localStorage.getItem('cal_couple_master_secret') || generateRandomMasterSecret();
    localStorage.setItem('cal_couple_master_secret', localMaster);
    currentMasterSecret = localMaster;
    coupleCryptoKey = await deriveCoupleCryptoKey(localMaster);
    return { ok: true, key: coupleCryptoKey, offline: true };
  }

  try {
    const { data: authData, error: authError } = await supabaseClient.auth.getSession();
    if (authError) return { ok: false, reason: 'server_error' };
    if (!authData || !authData.session || !authData.session.user) {
      return { ok: false, reason: 'auth_required' };
    }

    const { data, error } = await supabaseClient
      .from('events')
      .select('*')
      .in('id', [COUPLE_LOCK_HUSBAND_ID, COUPLE_LOCK_WIFE_ID, COUPLE_LOCK_BOOTSTRAP_ID]);

    if (error) {
      console.warn('Lock check warning:', error);
      return { ok: false, reason: 'server_error' };
    }

    const rows = data || [];
    const myRow = rows.find(r => r.id === myLockId);
    const partnerRow = rows.find(r => r.id === partnerLockId);
    const bootRow = rows.find(r => r.id === COUPLE_LOCK_BOOTSTRAP_ID);

    authState.husbandLocked = rows.some(r => r.id === COUPLE_LOCK_HUSBAND_ID && String(r.title || '').startsWith('ENC1:'));
    authState.wifeLocked = rows.some(r => r.id === COUPLE_LOCK_WIFE_ID && String(r.title || '').startsWith('ENC1:'));
    authState.hasRemoteLock = authState.husbandLocked || authState.wifeLocked;
    authState.lockStatusKnown = true;

    // 1. 내 역할의 암호 슬롯이 이미 등록되어 있는 경우 -> 내 암호 검증
    if (myRow && myRow.title && String(myRow.title).startsWith('ENC1:')) {
      const cap = clean.charAt(0).toUpperCase() + clean.slice(1);
      const candidateSeeds = [
        role + ':' + norm,
        role + ':' + clean,
        role + ':' + cap,
        (role === 'wife' ? 'husband:' : 'wife:') + norm,
        (role === 'wife' ? 'husband:' : 'wife:') + clean
      ];
      let decrypted = null;
      for (const seed of candidateSeeds) {
        const k = await deriveCoupleCryptoKey(seed);
        const dec = k ? await decryptCoupleField(myRow.title, k) : null;
        if (dec && dec.startsWith(COUPLE_VAULT_PREFIX)) {
          decrypted = dec;
          break;
        }
      }
      // 만약 배우자 암호를 입력한 경우 배우자 슬롯도 함께 확인해 허용
      if (!decrypted && partnerRow && partnerRow.title && String(partnerRow.title).startsWith('ENC1:')) {
        for (const seed of candidateSeeds) {
          const k = await deriveCoupleCryptoKey(seed);
          const dec = k ? await decryptCoupleField(partnerRow.title, k) : null;
          if (dec && dec.startsWith(COUPLE_VAULT_PREFIX)) {
            decrypted = dec;
            break;
          }
        }
      }
      if (!decrypted || !decrypted.startsWith(COUPLE_VAULT_PREFIX)) {
        return { ok: false, reason: 'mismatch' };
      }
      const masterSecret = decrypted.slice(COUPLE_VAULT_PREFIX.length);
      currentMasterSecret = masterSecret;
      localStorage.setItem('cal_couple_master_secret', masterSecret);
      coupleCryptoKey = await deriveCoupleCryptoKey(masterSecret);
      return { ok: true, key: coupleCryptoKey, verified: true };
    }

    // 2. 내 역할의 암호 슬롯이 아직 없는 경우 -> 새 내 암호로 등록!
    let masterSecret = '';
    if (bootRow && bootRow.title && String(bootRow.title).startsWith('ENC1:')) {
      const bootKey = await deriveCoupleCryptoKey(BOOTSTRAP_PASSCODE);
      const decBoot = await decryptCoupleField(bootRow.title, bootKey);
      if (decBoot && decBoot.startsWith(COUPLE_VAULT_PREFIX)) {
        masterSecret = decBoot.slice(COUPLE_VAULT_PREFIX.length);
      }
    }
    if (!masterSecret && (partnerRow || bootRow)) {
      return { ok: false, reason: 'key_unavailable' };
    }
    if (!masterSecret) {
      masterSecret = localStorage.getItem('cal_couple_master_secret') || generateRandomMasterSecret();
    }

    const wrappedForMe = await encryptCoupleField(COUPLE_VAULT_PREFIX + masterSecret, personalKey);
    const bootKey = await deriveCoupleCryptoKey(BOOTSTRAP_PASSCODE);
    const wrappedBoot = await encryptCoupleField(COUPLE_VAULT_PREFIX + masterSecret, bootKey);
    const upserts = [
      makeSystemLockRow(myLockId, wrappedForMe),
      makeSystemLockRow(COUPLE_LOCK_BOOTSTRAP_ID, wrappedBoot)
    ];
    const { error: saveError } = await supabaseClient.from('events').upsert(upserts);
    if (saveError) {
      console.warn('Lock save warning:', saveError);
      return { ok: false, reason: 'server_write_failed' };
    }

    if (role === 'wife') authState.wifeLocked = true;
    else authState.husbandLocked = true;
    authState.hasRemoteLock = true;

    currentMasterSecret = masterSecret;
    localStorage.setItem('cal_couple_master_secret', masterSecret);
    coupleCryptoKey = await deriveCoupleCryptoKey(masterSecret);
    return { ok: true, key: coupleCryptoKey, created: true };
  } catch (e) {
    console.warn('verifyOrCreateRemoteCoupleLock error:', e);
    return { ok: false, reason: 'server_error' };
  }
}

async function changeMyCouplePasscode(newRawPasscode) {
  const clean = String(newRawPasscode || '').trim();
  if (!clean || clean.length < 2) {
    showToast('새 암호를 2글자 이상 입력해 주세요 🔑');
    return false;
  }
  if (!isAuthorizedCoupleSession() || !currentMasterSecret || !authState.member) {
    showToast('먼저 내 휴대폰으로 로그인된 상태여야 해요.');
    return false;
  }
  const role = authState.member.role;
  const myLockId = role === 'wife' ? COUPLE_LOCK_WIFE_ID : COUPLE_LOCK_HUSBAND_ID;
  const norm = clean.toLowerCase().replace(/\s+/g, '');
  const personalKey = await deriveCoupleCryptoKey(role + ':' + norm);
  const wrappedForMe = await encryptCoupleField(COUPLE_VAULT_PREFIX + currentMasterSecret, personalKey);
  if (supabaseClient) {
    const { error } = await supabaseClient.from('events').upsert(makeSystemLockRow(myLockId, wrappedForMe));
    if (error) {
      showToast('암호 변경 저장에 실패했어요. 네트워크를 확인해 주세요.');
      return false;
    }
  }
  localStorage.removeItem('cal_couple_passcode');
  const inp = document.getElementById('inputChangeMyPasscode');
  if (inp) inp.value = '';
  showToast(authState.member.display_name + ' 님의 전용 암호를 변경했어요! 🔒');
  return true;
}

async function resetPartnerPasscodeSlot() {
  if (!isAuthorizedCoupleSession() || !currentMasterSecret || !supabaseClient || !authState.member) {
    showToast('먼저 내 휴대폰이 연결되어 있어야 해요.');
    return false;
  }
  const myRole = authState.member.role;
  const partnerName = myRole === 'wife' ? (state.husbandName || '강현우') : (state.wifeName || '김시문');
  const partnerLockId = myRole === 'wife' ? COUPLE_LOCK_HUSBAND_ID : COUPLE_LOCK_WIFE_ID;
  if (!confirm(partnerName + ' 님이 새 암호를 다시 정할 수 있도록 기존 암호 잠금을 풀어줄까요? (일정과 일기 기록은 모두 안전하게 유지됩니다)')) {
    return false;
  }
  try {
    const bootKey = await deriveCoupleCryptoKey(BOOTSTRAP_PASSCODE);
    const wrappedBoot = await encryptCoupleField(COUPLE_VAULT_PREFIX + currentMasterSecret, bootKey);
    await supabaseClient.from('events').upsert(makeSystemLockRow(COUPLE_LOCK_BOOTSTRAP_ID, wrappedBoot));
    await supabaseClient.from('events').delete().eq('id', partnerLockId);
    await refreshRemoteLockStatus();
    renderAuthUiState();
    showToast(partnerName + ' 님 폰에서 이제 새 암호를 다시 설정할 수 있어요! 🔓');
    return true;
  } catch (e) {
    showToast('초기화 중 오류가 발생했어요. 다시 시도해 주세요.');
    return false;
  }
}

async function forceResetAllPasscodeLocksFromGate() {
  if (!isAuthorizedCoupleSession()) {
    showToast('암호 초기화는 인증된 부부 계정으로 로그인한 뒤에만 할 수 있어요.');
    return false;
  }
  if (!confirm('강현우·김시문 두 사람의 암호를 처음부터 새로 정할 수 있도록 암호 잠금을 초기화할까요?\n(휴대폰에 저장된 일정과 일기는 절대 지워지지 않습니다!)')) {
    return false;
  }
  try {
    if (!supabaseClient && state.supabaseUrl && state.supabaseKey && window.supabase) {
      supabaseClient = window.supabase.createClient(state.supabaseUrl, state.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    if (supabaseClient) {
      await supabaseClient.from('events').delete().in('id', [COUPLE_LOCK_ID, COUPLE_LOCK_HUSBAND_ID, COUPLE_LOCK_WIFE_ID]);
    }
  } catch (e) {}
  localStorage.removeItem('cal_couple_passcode');
  localStorage.removeItem('cal_device_role');
  authState.husbandLocked = false;
  authState.wifeLocked = false;
  authState.hasRemoteLock = false;
  const gateMsg = document.getElementById('gateStatusMessage');
  if (gateMsg) gateMsg.classList.add('hidden');
  renderAuthUiState();
  showToast('암호 잠금을 초기화했어요! 이제 원하는 새 암호를 입력해 시작하세요 🔓');
  return true;
}

function isForbiddenSecretKey(k) {
  const val = String(k || '').trim();
  if (!val) return false;
  if (val.startsWith('sb_secret_')) return true;
  if (/service_role/i.test(val)) return true;
  return false;
}

function getPendingSyncQueue() {
  try {
    return JSON.parse(localStorage.getItem('cal_pending_sync') || '[]');
  } catch (e) {
    return [];
  }
}

function savePendingSyncQueue(list) {
  try {
    localStorage.setItem('cal_pending_sync', JSON.stringify(list));
  } catch (e) {}
  renderSyncRetryBanner();
}

function enqueuePendingSync(table, action, item) {
  const list = getPendingSyncQueue().filter(x => !(x.table === table && x.id === item.id));
  list.push({
    table: table,
    action: action,
    id: item.id,
    item: item,
    queuedAt: new Date().toISOString()
  });
  savePendingSyncQueue(list);
}

function clearPendingSyncItem(table, id) {
  const list = getPendingSyncQueue().filter(x => !(x.table === table && x.id === id));
  savePendingSyncQueue(list);
}

function renderSyncRetryBanner() {
  const banner = document.getElementById('syncRetryBanner');
  const txt = document.getElementById('syncRetryText');
  if (!banner || !txt) return;
  const q = getPendingSyncQueue();
  if (q.length > 0) {
    banner.classList.remove('hidden');
    txt.textContent = '전송되지 않은 변경 사항 ' + q.length + '개가 이 휴대폰에 안전하게 보관되어 있어요.';
  } else {
    banner.classList.add('hidden');
  }
}

function updateSupabaseBadge(status, text, colorClass) {
  const badge = document.getElementById('supabaseStatusBadge');
  if (badge) {
    badge.className = 'text-xs px-2.5 py-1 rounded-full font-bold ' + colorClass;
    badge.textContent = text;
  }
  const headerBtn = document.getElementById('btnHeaderSyncStatus');
  if (headerBtn) {
    headerBtn.className = 'text-[11px] px-2.5 py-1 rounded-full font-bold transition ' + colorClass;
    headerBtn.textContent = text;
  }
}

function isSampleRecord(type, item) {
  if (!item) return false;
  if (item.isSample === true) return true;
  if (type === 'event' && (item.id === '1' || item.id === '2') && (item.title === '부부 저녁 외식' || item.title === '주말 드라이브 계획')) return true;
  if (type === 'todo' && (item.id === '1' || item.id === '2') && (item.title === '주말 식재료 장보기' || item.title === '아파트 관리비 확인')) return true;
  if (type === 'diary' && item.id === '1' && String(item.content || '').indexOf('오늘 함께 퇴근하고 산책하면서 나눈 대화가 정말 좋았다') === 0) return true;
  return false;
}

function isAuthorizedCoupleSession() {
  return !!(supabaseClient && authState.status === 'authorized' && authState.user && authState.member && coupleCryptoKey);
}

function createCurrentPushReminderClient() {
  if (!window.PushReminders || typeof window.PushReminders.createClient !== 'function') return null;
  return window.PushReminders.createClient({
    Notification: window.Notification || null,
    navigator: window.navigator,
    supabaseClient: supabaseClient,
    vapidPublicKey: window.PUSH_VAPID_PUBLIC_KEY || ''
  });
}

function pushReminderStatusText(status) {
  const messages = {
    subscribed: '이 휴대폰에서 약속 알림을 받고 있어요.',
    not_subscribed: '이 휴대폰은 아직 알림이 꺼져 있어요. 아래 버튼을 눌러 켜 주세요.',
    not_registered: '기기 알림 등록이 서버와 맞지 않아요. 아래 버튼을 눌러 다시 등록해 주세요.',
    permission_required: '휴대폰 알림 권한이 필요해요. 아래 버튼을 누르고 허용해 주세요.',
    denied: '휴대폰 설정에서 우리하루 알림을 허용한 뒤 다시 확인해 주세요.',
    unsupported: '현재 브라우저는 푸시 알림을 지원하지 않아요. iPhone은 홈 화면에 추가한 앱에서 열어 주세요.',
    missing_config: '알림 서버 키 설정이 아직 끝나지 않았어요. 설정 안내를 먼저 적용해 주세요.',
    signed_out: '부부 계정으로 로그인한 뒤 사용할 수 있어요.',
    auth_required: '부부 계정으로 로그인한 뒤 사용할 수 있어요.',
    save_failed: '이 휴대폰 알림을 서버에 저장하지 못했어요. 알림 SQL과 부부 등록 상태를 확인해 주세요.',
    subscription_failed: '휴대폰 알림 등록에 실패했어요. 브라우저 권한과 네트워크를 확인해 주세요.',
    server_unavailable: '알림 서버에 연결하지 못했어요. 알림 SQL과 인터넷 연결을 확인해 주세요.',
    error: '알림 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  };
  return messages[status] || messages.error;
}

async function renderPushReminderSettings() {
  const statusEl = document.getElementById('pushReminderStatus');
  const button = document.getElementById('btnTogglePushReminders');
  if (!statusEl || !button || !isAuthorizedCoupleSession()) return;
  const client = createCurrentPushReminderClient();
  if (!client) {
    statusEl.textContent = '알림 기능을 불러오지 못했어요. 앱을 새로고침해 주세요.';
    button.disabled = true;
    return;
  }

  button.disabled = true;
  const result = await client.getStatus(authState.user.id);
  statusEl.textContent = pushReminderStatusText(result.status);
  button.dataset.enabled = result.enabled ? 'true' : 'false';
  button.textContent = result.enabled ? '🔕 이 기기 알림 끄기' : '🔔 이 기기 알림 켜기';
  button.disabled = false;
}

async function toggleCurrentDevicePushReminders() {
  const button = document.getElementById('btnTogglePushReminders');
  const statusEl = document.getElementById('pushReminderStatus');
  if (!isAuthorizedCoupleSession()) {
    if (statusEl) statusEl.textContent = '먼저 부부 계정으로 로그인해 주세요.';
    return;
  }
  const client = createCurrentPushReminderClient();
  if (!client) {
    if (statusEl) statusEl.textContent = '알림 기능을 불러오지 못했어요. 앱을 새로고침해 주세요.';
    return;
  }

  const wasEnabled = !!(button && button.dataset.enabled === 'true');
  if (button) button.disabled = true;
  if (statusEl) statusEl.textContent = wasEnabled ? '이 휴대폰 알림을 끄고 있어요...' : '이 휴대폰 알림을 준비하고 있어요...';

  const result = wasEnabled
    ? await client.disable(authState.user.id)
    : await client.enable(authState.user.id);
  if (!result.ok) {
    if (statusEl) statusEl.textContent = pushReminderStatusText(result.reason === 'permission_denied'
      ? (window.Notification && window.Notification.permission === 'denied' ? 'denied' : 'permission_required')
      : result.reason);
    if (button) button.disabled = false;
    return;
  }

  await renderPushReminderSettings();
  showToast(result.status === 'disabled' ? '이 휴대폰 알림을 껐어요.' : '이 휴대폰에서 약속 알림을 받을게요 🔔');
}

function remoteLockFailureMessage(reason, displayName) {
  if (reason === 'mismatch') {
    return '🔒 ' + (displayName || '등록된 사용자') + ' 님의 암호와 일치하지 않아요. 다시 입력해 주세요.';
  }
  if (reason === 'server_write_failed') {
    return '서버에 암호 잠금을 저장하지 못했어요. Supabase 권한과 테이블 설정을 확인해 주세요.';
  }
  if (reason === 'key_unavailable') {
    return '공유 잠금 복구 정보를 확인할 수 없어요. 기존 기기와 등록 정보를 확인해 주세요.';
  }
  if (reason === 'server_unavailable') {
    return '서버에 연결할 수 없어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요. 입력한 암호는 보존됩니다.';
  }
  if (reason === 'server_error') {
    return '서버에서 암호를 확인하지 못했어요. 입력한 암호는 보존됩니다. 잠시 후 다시 시도해 주세요.';
  }
  if (reason === 'auth_required') {
    return '먼저 내 Supabase 계정으로 로그인해 주세요.';
  }
  return '암호 확인에 실패했어요. 입력한 암호와 서버 연결을 확인해 주세요.';
}

function getSavedDeviceMember() {
  const role = localStorage.getItem('cal_device_role') || '';
  const savedPasscode = localStorage.getItem('cal_couple_passcode') || '';
  if (!savedPasscode || (role !== 'husband' && role !== 'wife')) return null;
  return { passcode: savedPasscode, role: role };
}

function renderAuthUiState() {
  const gate = document.getElementById('coupleAccessGate');
  const gateSignedOut = document.getElementById('gateSignedOutView');
  const gateChecking = document.getElementById('gateCheckingView');
  const gateUnauth = document.getElementById('gateUnauthorizedView');
  const gatePasswordSetup = document.getElementById('gatePasswordSetupView');
  const mainEl = document.querySelector('main');
  const navEl = document.querySelector('nav');
  const fabEl = document.getElementById('btnOpenAddModal');

  const summaryEl = document.getElementById('authStateSummary');
  const emailFormWrap = document.getElementById('authEmailFormWrap');
  const unregWrap = document.getElementById('authUnregisteredWrap');
  const memberActionsWrap = document.getElementById('authMemberActionsWrap');
  const signOutBtn = document.getElementById('btnSignOutSupabase');
  const userIdDisplay = document.getElementById('authUserIdDisplay');
  const gateUserIdBox = document.getElementById('gateUserIdBox');
  const gateUnauthEmail = document.getElementById('gateUnauthEmail');
  const gatePasswordSetupEmail = document.getElementById('gatePasswordSetupEmail');

  const hasSupabaseConfig = !!(state.supabaseUrl && state.supabaseKey);
  const shouldLockScreen = hasSupabaseConfig && (authState.status === 'signed_out' || authState.status === 'checking' || authState.status === 'password_setup' || authState.status === 'needs_vault_passcode' || authState.status === 'unauthorized' || authState.status === 'error');

  if (gate) {
    gate.classList.toggle('hidden', !shouldLockScreen);
    gate.classList.toggle('flex', shouldLockScreen);
  }
  if (mainEl) mainEl.classList.toggle('invisible', shouldLockScreen);
  if (navEl) navEl.classList.toggle('invisible', shouldLockScreen);
  if (fabEl && shouldLockScreen) fabEl.classList.add('hidden');
  else if (fabEl && !shouldLockScreen) {
    const activeSettings = !document.getElementById('tabSettings').classList.contains('hidden');
    fabEl.classList.toggle('hidden', activeSettings);
  }

  if (gateSignedOut) gateSignedOut.classList.toggle('hidden', authState.status !== 'signed_out' && authState.status !== 'needs_vault_passcode' && authState.status !== 'error');
  if (gateChecking) gateChecking.classList.toggle('hidden', authState.status !== 'checking');
  if (gateUnauth) gateUnauth.classList.toggle('hidden', authState.status !== 'unauthorized');
  if (gatePasswordSetup) gatePasswordSetup.classList.toggle('hidden', authState.status !== 'password_setup');

  if (!hasSupabaseConfig || authState.status === 'offline') {
    updateSupabaseBadge('offline', '⚪ 오프라인 보관 모드', 'bg-slate-100 text-slate-500 border border-slate-200');
    if (summaryEl) summaryEl.textContent = '현재 이 휴대폰에만 저장하는 오프라인 모드예요.';
    if (emailFormWrap) emailFormWrap.classList.remove('hidden');
    if (unregWrap) unregWrap.classList.add('hidden');
    if (memberActionsWrap) memberActionsWrap.classList.add('hidden');
    if (gatePasswordSetup) gatePasswordSetup.classList.add('hidden');
    if (signOutBtn) signOutBtn.classList.add('hidden');
    renderSyncRetryBanner();
    return;
  }

  if (authState.status === 'checking') {
    updateSupabaseBadge('checking', '🟡 부부 인증 확인 중', 'bg-amber-50 text-amber-700 border border-amber-200');
    if (summaryEl) summaryEl.textContent = 'Supabase 계정과 부부 허용 목록을 확인하고 있어요...';
    if (emailFormWrap) emailFormWrap.classList.add('hidden');
    if (unregWrap) unregWrap.classList.add('hidden');
    if (memberActionsWrap) memberActionsWrap.classList.add('hidden');
    if (signOutBtn) signOutBtn.classList.add('hidden');
  } else if (authState.status === 'password_setup') {
    updateSupabaseBadge('checking', '✉️ 초대 계정 설정', 'bg-indigo-50 text-indigo-700 border border-indigo-200');
    if (summaryEl) summaryEl.textContent = '초대를 확인했어요. 사용할 계정 암호를 정해 주세요.';
    if (gatePasswordSetupEmail) gatePasswordSetupEmail.textContent = '초대 이메일: ' + ((authState.user && authState.user.email) || '');
    if (emailFormWrap) emailFormWrap.classList.add('hidden');
    if (unregWrap) unregWrap.classList.add('hidden');
    if (memberActionsWrap) memberActionsWrap.classList.add('hidden');
    if (signOutBtn) signOutBtn.classList.add('hidden');
  } else if (authState.status === 'signed_out') {
    updateSupabaseBadge('signed_out', '🔒 계정 로그인 필요', 'bg-slate-100 text-slate-600 border border-slate-200');
    if (summaryEl) {
      summaryEl.textContent = '부부 계정으로 로그인해야 공유 기록을 열 수 있어요. 계정 암호는 저장하지 않습니다.';
    }
    if (emailFormWrap) emailFormWrap.classList.remove('hidden');
    if (unregWrap) unregWrap.classList.add('hidden');
    if (memberActionsWrap) memberActionsWrap.classList.add('hidden');
    if (signOutBtn) signOutBtn.classList.add('hidden');
  } else if (authState.status === 'unauthorized') {
    const email = (authState.user && authState.user.email) || '';
    const uid = (authState.user && authState.user.id) || '';
    updateSupabaseBadge('unauthorized', '🟠 부부 등록 필요', 'bg-amber-50 text-amber-700 border border-amber-200');
    if (summaryEl) summaryEl.textContent = '로그인됨 (' + email + ') · couple_members 등록 대기 중';
    if (emailFormWrap) emailFormWrap.classList.add('hidden');
    if (unregWrap) unregWrap.classList.remove('hidden');
    if (memberActionsWrap) memberActionsWrap.classList.add('hidden');
    if (signOutBtn) signOutBtn.classList.remove('hidden');
    if (userIdDisplay) userIdDisplay.textContent = '내 User ID: ' + uid;
    if (gateUserIdBox) gateUserIdBox.textContent = '내 User ID: ' + uid;
    if (gateUnauthEmail) gateUnauthEmail.textContent = '로그인 이메일: ' + email;
  } else if (authState.status === 'authorized') {
    const memberName = (authState.member && authState.member.display_name) || '부부 구성원';
    const email = (authState.user && authState.user.email) || '';
    const pendingCount = getPendingSyncQueue().length;
    if (pendingCount > 0) {
      updateSupabaseBadge('warning', '🟠 재동기화 필요 (' + pendingCount + ')', 'bg-amber-50 text-amber-700 border border-amber-200');
    } else {
      updateSupabaseBadge('online', '🟢 ' + memberName + ' (🔒보호됨)', 'bg-emerald-50 text-emerald-600 border border-emerald-200');
    }
    if (summaryEl) summaryEl.textContent = '💑 인증된 부부 기기: ' + memberName + ' · 🔒 암구호 암호화 작동 중';
    if (emailFormWrap) emailFormWrap.classList.add('hidden');
    if (unregWrap) unregWrap.classList.add('hidden');
    if (memberActionsWrap) memberActionsWrap.classList.remove('hidden');
    if (signOutBtn) signOutBtn.classList.remove('hidden');
  } else if (authState.status === 'needs_vault_passcode') {
    updateSupabaseBadge('signed_out', '🔑 기록 암호 필요', 'bg-amber-50 text-amber-700 border border-amber-200');
    if (summaryEl) summaryEl.textContent = '계정은 확인됐어요. 기록 암호를 입력해 공유 기록을 열어 주세요.';
    const gateStatus = document.getElementById('gateStatusMessage');
    if (gateStatus && authState.errorMessage) {
      gateStatus.textContent = authState.errorMessage;
      gateStatus.className = 'text-xs font-semibold rounded-xl p-3 bg-amber-50 text-amber-800 border border-amber-200';
      gateStatus.classList.remove('hidden');
    }
    if (emailFormWrap) emailFormWrap.classList.add('hidden');
    if (unregWrap) unregWrap.classList.add('hidden');
    if (memberActionsWrap) memberActionsWrap.classList.add('hidden');
    if (signOutBtn) signOutBtn.classList.toggle('hidden', !authState.user);
  } else if (authState.status === 'error') {
    updateSupabaseBadge('error', '🔴 동기화 오류', 'bg-rose-50 text-rose-600 border border-rose-200');
    if (summaryEl) summaryEl.textContent = authState.errorMessage || '서버 연결 또는 권한 확인 중 오류가 발생했어요. 로컬 기록은 안전합니다.';
    const gateStatus = document.getElementById('gateStatusMessage');
    if (gateStatus && authState.errorMessage) {
      gateStatus.textContent = authState.errorMessage;
      gateStatus.className = 'text-xs font-semibold rounded-xl p-3 bg-rose-50 text-rose-700 border border-rose-200';
      gateStatus.classList.remove('hidden');
    }
    if (emailFormWrap) emailFormWrap.classList.toggle('hidden', !!authState.user);
    if (unregWrap) unregWrap.classList.add('hidden');
    if (memberActionsWrap) memberActionsWrap.classList.toggle('hidden', !authState.member);
    if (signOutBtn) signOutBtn.classList.toggle('hidden', !authState.user);
  }
  renderSyncRetryBanner();
}

async function initSupabase(url, key, isManual = false) {
  if (!url || !key || !window.supabase) {
    authState = { status: 'offline', user: null, member: null, lastVerifiedSyncAt: null, errorMessage: '' };
    renderAuthUiState();
    return false;
  }
  if (isForbiddenSecretKey(key)) {
    authState = { status: 'error', user: null, member: null, lastVerifiedSyncAt: null, errorMessage: '보안을 위해 service_role / secret 키는 브라우저에 넣을 수 없어요. publishable 키만 사용해 주세요.' };
    renderAuthUiState();
    showToast('service_role 키는 사용할 수 없어요 🔒');
    return false;
  }
  try {
    authState.status = 'checking';
    renderAuthUiState();

    supabaseClient = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    const authUser = sessionData && sessionData.session && sessionData.session.user;
    if (!authUser) {
      coupleCryptoKey = null;
      currentMasterSecret = '';
      if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
      authState = {
        status: 'signed_out',
        user: null,
        member: null,
        lastVerifiedSyncAt: null,
        errorMessage: '',
        schemaProtected: true,
        hasRemoteLock: false,
        lockStatusKnown: false,
        husbandLocked: false,
        wifeLocked: false
      };
      renderAuthUiState();
      if (isManual) showToast('이메일과 Supabase 계정 암호로 먼저 로그인해 주세요 🔒');
      return true;
    }
    if (typeof pendingAccountPasswordSetup !== 'undefined' && pendingAccountPasswordSetup) {
      authState = {
        status: 'password_setup',
        user: authUser,
        member: null,
        lastVerifiedSyncAt: null,
        errorMessage: ''
      };
      renderAuthUiState();
      return true;
    }
    return await verifyMemberAndSync(authUser, isManual);
  } catch (err) {
    console.error('Supabase init error:', err);
    authState = {
      status: 'error',
      user: null,
      member: null,
      lastVerifiedSyncAt: null,
      errorMessage: '서버 연결 확인에 실패했어요. 내 폰의 기록은 안전하게 보존됩니다.'
    };
    renderAuthUiState();
    if (isManual) showToast('연결 실패: 서버 주소 또는 네트워크를 확인해 주세요 😥');
    return false;
  }
}

async function verifyMemberAndSync(user, notifySuccess = false, rawVaultPasscode = '') {
  if (!supabaseClient || !user) {
    authState = { status: 'signed_out', user: null, member: null, lastVerifiedSyncAt: null, errorMessage: '' };
    renderAuthUiState();
    return false;
  }
  authState.status = 'checking';
  authState.user = user;
  renderAuthUiState();

  try {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    const sessionUser = sessionData && sessionData.session && sessionData.session.user;
    if (sessionError || !sessionUser || sessionUser.id !== user.id) {
      authState = { status: 'signed_out', user: null, member: null, lastVerifiedSyncAt: null, errorMessage: 'Supabase 계정 로그인이 만료됐어요. 다시 로그인해 주세요.' };
      coupleCryptoKey = null;
      currentMasterSecret = '';
      renderAuthUiState();
      return false;
    }

    const { data: memberRow, error: memberErr } = await supabaseClient
      .from('couple_members')
      .select('user_id, display_name, role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberErr) {
      authState = {
        status: 'error',
        user: user,
        member: null,
        lastVerifiedSyncAt: null,
        errorMessage: /PGRST205|does not exist|schema cache/i.test(String(memberErr.code || '') + ' ' + String(memberErr.message || ''))
          ? 'Supabase 보안 테이블(couple_members)이 아직 준비되지 않았어요. 설정 SQL을 먼저 적용해 주세요.'
          : '부부 구성원 확인에 실패했어요. 서버 설정과 연결 상태를 확인해 주세요.'
      };
      renderAuthUiState();
      return false;
    }

    if (!memberRow) {
      if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
      authState = {
        status: 'unauthorized',
        user: user,
        member: null,
        lastVerifiedSyncAt: null,
        errorMessage: ''
      };
      renderAuthUiState();
      return false;
    }

    if (memberRow.role !== 'husband' && memberRow.role !== 'wife') {
      authState = { status: 'unauthorized', user: user, member: null, lastVerifiedSyncAt: null, errorMessage: '이 계정에는 남편 또는 아내 역할이 등록되어 있지 않아요.' };
      renderAuthUiState();
      return false;
    }

    authState.member = memberRow;
    if (!coupleCryptoKey || String(rawVaultPasscode || '').trim()) {
      const saved = getSavedDeviceMember();
      let passcode = String(rawVaultPasscode || '').trim();
      if (!passcode && !coupleCryptoKey && saved && saved.role === memberRow.role) passcode = saved.passcode;

      const localMaster = coupleCryptoKey ? '' : (localStorage.getItem('cal_couple_master_secret') || '');
      if (localMaster) {
        currentMasterSecret = localMaster;
        coupleCryptoKey = await deriveCoupleCryptoKey(localMaster);
      }

      if (passcode) {
        const lockCheck = await verifyOrCreateRemoteCoupleLock(memberRow.role, passcode);
        if (!lockCheck.ok) {
          if (lockCheck.reason === 'mismatch' && !rawVaultPasscode) {
            localStorage.removeItem('cal_couple_passcode');
            localStorage.removeItem('cal_device_role');
          }
          if (rawVaultPasscode) {
            coupleCryptoKey = null;
            currentMasterSecret = '';
          }
          authState.status = lockCheck.reason === 'mismatch' ? 'needs_vault_passcode' : 'error';
          authState.errorMessage = remoteLockFailureMessage(lockCheck.reason, memberRow.display_name);
          renderAuthUiState();
          return false;
        }
        localStorage.setItem('cal_device_role', memberRow.role);
        localStorage.removeItem('cal_couple_passcode');
      }

      if (!coupleCryptoKey) {
        authState.status = 'needs_vault_passcode';
        authState.errorMessage = '계정은 확인됐어요. 공유 기록을 열려면 이 계정의 기록 암호를 입력해 주세요.';
        renderAuthUiState();
        return false;
      }
    } else {
      const savedRole = localStorage.getItem('cal_device_role') || '';
      if (savedRole && savedRole !== memberRow.role) {
        localStorage.removeItem('cal_couple_passcode');
        localStorage.removeItem('cal_device_role');
      }
    }

    const pullOk = await pullRemoteSupabaseData();
    if (!pullOk) {
      authState.status = 'error';
      authState.errorMessage = '부부 인증은 되었지만 공유 기록을 불러오지 못했어요. 로컬 기록은 그대로 유지됩니다.';
      renderAuthUiState();
      return false;
    }

    authState.status = 'authorized';
    authState.lastVerifiedSyncAt = new Date().toISOString();
    authState.errorMessage = '';
    renderAuthUiState();
    renderPushReminderSettings();
    setupSupabaseRealtime();

    // URL에 매직링크 해시나 코드가 남아 있으면 깔끔하게 정리
    if (window.location.hash && /access_token|refresh_token|error_description/.test(window.location.hash)) {
      window.history.replaceState({}, document.title, window.location.origin + window.location.pathname + window.location.search);
    }

    if (notifySuccess) {
      showToast('반가워요 ' + memberRow.display_name + ' 님! 부부 전용 연결 완료 💑');
    }

    maybePromptInitialSync();
    return true;
  } catch (err) {
    console.error('verifyMemberAndSync error:', err);
    authState.status = 'error';
    authState.errorMessage = '인증 확인 중 오류가 발생했어요. 로컬 기록은 안전합니다.';
    renderAuthUiState();
    return false;
  }
}

async function signInCoupleAccount() {
  const emailInput = document.getElementById('gateEmailInput');
  const accountPasswordInput = document.getElementById('gateAccountPasswordInput');
  const vaultPasscodeInput = document.getElementById('gatePasscodeInput');
  const gateMsg = document.getElementById('gateStatusMessage');
  const email = String((emailInput && emailInput.value) || '').trim();
  const accountPassword = String((accountPasswordInput && accountPasswordInput.value) || '');
  const vaultPasscode = String((vaultPasscodeInput && vaultPasscodeInput.value) || '').trim();
  const showGateMessage = function(message, success) {
    if (!gateMsg) return;
    gateMsg.textContent = message;
    gateMsg.className = success
      ? 'text-xs font-semibold rounded-xl p-3 bg-emerald-50 text-emerald-700 border border-emerald-200'
      : 'text-xs font-semibold rounded-xl p-3 bg-rose-50 text-rose-700 border border-rose-200';
    gateMsg.classList.remove('hidden');
  };

  if (!supabaseClient) {
    await initSupabase(state.supabaseUrl, state.supabaseKey, false);
  }
  if (!supabaseClient) {
    showGateMessage('서버 설정을 확인할 수 없어요. 인터넷 연결을 확인해 주세요.', false);
    return false;
  }

  try {
    let user = null;
    if (email && accountPassword) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email: email, password: accountPassword });
      if (error) {
        const message = /invalid login credentials|invalid_credentials/i.test(String(error.message || error.code || ''))
          ? '이메일 또는 Supabase 계정 암호가 맞지 않아요.'
          : '계정 로그인에 실패했어요. 연결 상태를 확인하고 다시 시도해 주세요.';
        showGateMessage(message, false);
        return false;
      }
      user = data && data.user;
      localStorage.setItem('cal_last_auth_email', email);
      if (accountPasswordInput) accountPasswordInput.value = '';
    } else {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      user = data && data.session && data.session.user;
      if (!user) {
        showGateMessage('이메일과 Supabase 계정 암호를 입력해 주세요.', false);
        return false;
      }
    }

    if (!user) {
      showGateMessage('Supabase 계정 로그인을 확인할 수 없어요. 다시 로그인해 주세요.', false);
      return false;
    }
    return await verifyMemberAndSync(user, true, vaultPasscode);
  } catch (error) {
    console.warn('Supabase password sign-in failed:', error);
    showGateMessage('로그인 중 서버 연결 오류가 발생했어요. 입력한 암호는 저장하지 않았습니다.', false);
    return false;
  }
}

async function sendMagicLink(rawEmail) {
  const email = String(rawEmail || '').trim();
  if (!email || !email.includes('@')) {
    showToast('올바른 이메일 주소를 입력해 주세요 ✏️');
    return false;
  }
  if (!supabaseClient) {
    await initSupabase(state.supabaseUrl, state.supabaseKey, false);
  }
  if (!supabaseClient) {
    showToast('먼저 서버 설정을 확인해 주세요.');
    return false;
  }
  const gateMsg = document.getElementById('gateStatusMessage');
  try {
    localStorage.setItem('cal_last_auth_email', email);
    const redirectUrl = window.location.origin + window.location.pathname;
    const { error } = await supabaseClient.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectUrl
      }
    });
    if (error) {
      const msg = String(error.message || '');
      let friendly = '로그인 링크 전송에 실패했어요: ' + msg;
      if (/Signups not allowed|user not found|invalid/i.test(msg)) {
        friendly = '등록되지 않은 이메일이에요. Supabase 대시보드(Authentication -> Users)에서 두 사람의 이메일을 먼저 추가해 주세요.';
      }
      if (gateMsg) {
        gateMsg.textContent = friendly;
        gateMsg.className = 'text-xs font-semibold rounded-xl p-3 bg-rose-50 text-rose-700 border border-rose-200';
        gateMsg.classList.remove('hidden');
      }
      showToast(friendly);
      return false;
    }
    const okText = '📩 ' + email + ' 메일함으로 일회용 로그인 링크를 보냈어요! 메일에서 링크를 눌러 주세요.';
    if (gateMsg) {
      gateMsg.textContent = okText;
      gateMsg.className = 'text-xs font-semibold rounded-xl p-3 bg-emerald-50 text-emerald-700 border border-emerald-200';
      gateMsg.classList.remove('hidden');
    }
    showToast('이메일로 로그인 링크를 보냈어요! 📩');
    return true;
  } catch (e) {
    showToast('네트워크 오류로 로그인 링크를 보내지 못했어요 😥');
    return false;
  }
}

async function signOutSupabase() {
  try {
    if (realtimeChannel) {
      realtimeChannel.unsubscribe();
      realtimeChannel = null;
    }
    localStorage.removeItem('cal_device_role');
    localStorage.removeItem('cal_couple_passcode');
    coupleCryptoKey = null;
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
  } catch (e) {}
  currentMasterSecret = '';
  authState = { status: 'signed_out', user: null, member: null, lastVerifiedSyncAt: null, errorMessage: '', hasRemoteLock: authState.hasRemoteLock, lockStatusKnown: false };
  renderAuthUiState();
  showToast('이 기기의 잠금 등록을 해제했어요 🔒');
}

function buildMemberRegistrationSql(displayName, role) {
  const uid = authState.user && authState.user.id ? authState.user.id : '여기에_USER_ID';
  return "INSERT INTO public.couple_members (user_id, display_name, role) VALUES ('" + uid + "', '" + displayName + "', '" + role + "') ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role;";
}

function mergeRemoteWithLocalPreservingCollisions(localList, remoteList, normalizeRemoteFn, typeLabel) {
  const localById = new Map(localList.map(item => [item.id, item]));
  const remoteIds = new Set();
  const mergedMap = new Map();

  // 먼저 기존 로컬 기록을 그대로 넣음
  localList.forEach(item => {
    mergedMap.set(item.id, item);
  });

  remoteList.forEach(rawRemote => {
    const remoteItem = normalizeRemoteFn(rawRemote);
    remoteIds.add(remoteItem.id);
    const existingLocal = localById.get(remoteItem.id);
    if (existingLocal && !isSampleRecord(typeLabel, existingLocal)) {
      const localSig = JSON.stringify({
        t: existingLocal.title || existingLocal.content || '',
        d: existingLocal.date || existingLocal.dueDate || '',
        m: existingLocal.time || existingLocal.mood || ''
      });
      const remoteSig = JSON.stringify({
        t: remoteItem.title || remoteItem.content || '',
        d: remoteItem.date || remoteItem.dueDate || '',
        m: remoteItem.time || remoteItem.mood || ''
      });
      if (localSig !== remoteSig) {
        const preservedId = existingLocal.id + '-local-' + Date.now().toString().slice(-4);
        if (!mergedMap.has(preservedId)) {
          mergedMap.set(preservedId, Object.assign({}, existingLocal, { id: preservedId, preservedFromCollision: true }));
        }
      }
    }
    mergedMap.set(remoteItem.id, remoteItem);
  });

  return {
    merged: Array.from(mergedMap.values()),
    remoteIds: remoteIds
  };
}

async function decodeRemoteEventRow(re) {
  const parsed = parseRemoteEvent(re);
  if (parsed.title && String(parsed.title).startsWith('ENC1:')) {
    const dec = await decryptCoupleField(parsed.title);
    parsed.title = dec !== null ? dec : '🔒 암호화된 약속';
  }
  return parsed;
}

async function decodeRemoteTodoRow(rt) {
  let title = rt.title || '';
  if (String(title).startsWith('ENC1:')) {
    const dec = await decryptCoupleField(title);
    title = dec !== null ? dec : '🔒 암호화된 할 일';
  }
  return {
    id: rt.id,
    title: title,
    isCompleted: rt.is_completed ?? rt.isCompleted ?? false,
    dueDate: rt.due_date || rt.dueDate || ''
  };
}

async function decodeRemoteDiaryRow(rd) {
  let content = rd.content || '';
  if (String(content).startsWith('ENC1:')) {
    const dec = await decryptCoupleField(content);
    content = dec !== null ? dec : '🔒 암호화된 일기';
  }
  const rawMedia = Array.isArray(rd.media) ? rd.media : [];
  const decodedMedia = [];
  for (const m of rawMedia) {
    if (!m) continue;
    let url = m.url || '';
    let name = m.name || '';
    if (String(url).startsWith('ENC1:')) {
      const decUrl = await decryptCoupleField(url);
      if (decUrl !== null) url = decUrl;
    }
    if (String(name).startsWith('ENC1:')) {
      const decName = await decryptCoupleField(name);
      if (decName !== null) name = decName;
    }
    decodedMedia.push(Object.assign({}, m, { url: url, name: name }));
  }
  return {
    id: rd.id,
    date: rd.date,
    mood: rd.mood || '🥰',
    content: content,
    media: decodedMedia,
    createdAt: rd.created_at || rd.createdAt || new Date().toISOString()
  };
}

async function pullRemoteSupabaseData() {
  if (!supabaseClient || !coupleCryptoKey) return false;
  try {
    const [evRes, tdRes, diRes] = await Promise.all([
      supabaseClient.from('events').select('*'),
      supabaseClient.from('todos').select('*'),
      supabaseClient.from('diaries').select('*')
    ]);

    if (evRes.error || tdRes.error || diRes.error) {
      console.warn('pullRemoteSupabaseData RLS/query error:', evRes.error || tdRes.error || diRes.error);
      return false;
    }

    const rawEvents = (evRes.data || []).filter(r => r && !isSystemLockRecordId(r.id));
    const rawStickerRows = rawEvents.filter(r => isStickerRecordId(r.id));
    const normalEventRows = rawEvents.filter(r => !isStickerRecordId(r.id));
    const rawTodos = tdRes.data || [];
    const rawDiaries = diRes.data || [];

    const [decodedEvents, decodedStickers, decodedTodos, decodedDiaries] = await Promise.all([
      Promise.all(normalEventRows.map(decodeRemoteEventRow)),
      Promise.all(rawStickerRows.map(decodeRemoteEventRow)),
      Promise.all(rawTodos.map(decodeRemoteTodoRow)),
      Promise.all(rawDiaries.map(decodeRemoteDiaryRow))
    ]);

    isRemoteUpdating = true;
    try {
      const evMerged = mergeRemoteWithLocalPreservingCollisions(
        state.events,
        decodedEvents,
        x => x,
        'event'
      );
      state.events = evMerged.merged;
      remoteSnapshotIds.events = evMerged.remoteIds;
      saveEvents();

      if (!state.dayStickers) state.dayStickers = {};
      decodedStickers.forEach(st => {
        const dStr = st.date || String(st.id || '').replace('__sticker__', '');
        if (dStr && st.title) {
          state.dayStickers[dStr] = st.title;
        }
      });
      saveDayStickers();

      const tdMerged = mergeRemoteWithLocalPreservingCollisions(
        state.todos,
        decodedTodos,
        x => x,
        'todo'
      );
      state.todos = tdMerged.merged;
      remoteSnapshotIds.todos = tdMerged.remoteIds;
      saveTodos();

      const diMerged = mergeRemoteWithLocalPreservingCollisions(
        state.diaries,
        decodedDiaries,
        x => x,
        'diary'
      );
      state.diaries = diMerged.merged;
      remoteSnapshotIds.diaries = diMerged.remoteIds;
      saveDiaries();
    } finally {
      isRemoteUpdating = false;
    }

    renderCalendar();
    renderSelectedDateView();
    renderTodos();
    renderAllDiaries();
    return true;
  } catch (e) {
    console.warn('pullRemoteSupabaseData error:', e);
    return false;
  }
}

function setupSupabaseRealtime() {
  if (!isAuthorizedCoupleSession()) return;
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
  }

  realtimeChannel = supabaseClient.channel('couple_sync_channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, async payload => {
      if (isRemoteUpdating) return;
      if ((payload.new && isSystemLockRecordId(payload.new.id)) || (payload.old && isSystemLockRecordId(payload.old.id))) return;
      if ((payload.new && isStickerRecordId(payload.new.id)) || (payload.old && isStickerRecordId(payload.old.id))) {
        if (!state.dayStickers) state.dayStickers = {};
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const mapped = await decodeRemoteEventRow(payload.new);
          const dStr = mapped.date || String(mapped.id || '').replace('__sticker__', '');
          if (dStr && mapped.title) state.dayStickers[dStr] = mapped.title;
        } else if (payload.eventType === 'DELETE') {
          const dStr = String((payload.old && payload.old.id) || '').replace('__sticker__', '');
          if (dStr) delete state.dayStickers[dStr];
        }
        saveDayStickers();
        renderCalendar();
        renderSelectedDateView();
        showToast('상대방이 달력 스티커를 붙였어요! 🐿️');
        return;
      }
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const mapped = await decodeRemoteEventRow(payload.new);
        remoteSnapshotIds.events.add(mapped.id);
        const idx = state.events.findIndex(e => e.id === mapped.id);
        if (idx >= 0) state.events[idx] = mapped;
        else state.events.push(mapped);
      } else if (payload.eventType === 'DELETE') {
        remoteSnapshotIds.events.delete(payload.old.id);
        state.events = state.events.filter(e => e.id !== payload.old.id);
      }
      saveEvents();
      renderCalendar();
      renderSelectedDateView();
      showToast('상대방이 약속을 변경했어요! 🔄');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, async payload => {
      if (isRemoteUpdating) return;
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const mapped = await decodeRemoteTodoRow(payload.new);
        remoteSnapshotIds.todos.add(mapped.id);
        const idx = state.todos.findIndex(t => t.id === mapped.id);
        if (idx >= 0) state.todos[idx] = mapped;
        else state.todos.push(mapped);
      } else if (payload.eventType === 'DELETE') {
        remoteSnapshotIds.todos.delete(payload.old.id);
        state.todos = state.todos.filter(t => t.id !== payload.old.id);
      }
      saveTodos();
      renderTodos();
      showToast('상대방이 할 일을 변경했어요! 🔄');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'diaries' }, async payload => {
      if (isRemoteUpdating) return;
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const mapped = await decodeRemoteDiaryRow(payload.new);
        remoteSnapshotIds.diaries.add(mapped.id);
        const idx = state.diaries.findIndex(d => d.id === mapped.id);
        if (idx >= 0) state.diaries[idx] = mapped;
        else state.diaries.push(mapped);
      } else if (payload.eventType === 'DELETE') {
        remoteSnapshotIds.diaries.delete(payload.old.id);
        state.diaries = state.diaries.filter(d => d.id !== payload.old.id);
      }
      saveDiaries();
      renderCalendar();
      renderSelectedDateView();
      renderAllDiaries();
      showToast('상대방이 일기를 등록했어요! 📖');
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        updateSupabaseBadge('error', '🟠 실시간 연결 재시도 필요', 'bg-amber-50 text-amber-700 border border-amber-200');
      }
    });
}

async function pushRemoteEvent(action, item) {
  if (isRemoteUpdating) return true;
  if (!isAuthorizedCoupleSession()) {
    if (state.supabaseUrl && state.supabaseKey) {
      enqueuePendingSync('events', action, item);
      renderAuthUiState();
    }
    return false;
  }
  try {
    let res;
    if (action === 'delete') {
      res = await supabaseClient.from('events').delete().eq('id', item.id);
      if (!res.error) remoteSnapshotIds.events.delete(item.id);
    } else {
      const encTitle = await encryptCoupleField(item.title || '');
      const payload = {
        id: item.id,
        title: encTitle,
        date: item.date,
        time: item.time || '',
        owner: (item.owner || 'both') + (item.repeat && item.repeat !== 'none' ? '|' + item.repeat : ''),
        color: item.color,
        start_time: item.date + (item.time ? 'T' + item.time + ':00' : 'T00:00:00'),
        end_time: (item.endDate && item.endDate >= item.date ? item.endDate : item.date) + 'T23:59:59'
      };
      res = await supabaseClient.from('events').upsert(payload);
      if (!res.error) remoteSnapshotIds.events.add(item.id);
    }
    if (res && res.error) throw res.error;
    clearPendingSyncItem('events', item.id);
    renderAuthUiState();
    return true;
  } catch (e) {
    console.warn('pushRemoteEvent failed:', e);
    enqueuePendingSync('events', action, item);
    renderAuthUiState();
    showToast('이 폰에는 저장되었지만 공유 동기화에 실패했어요. [꾸미기]에서 다시 시도할 수 있어요.');
    return false;
  }
}

async function pushRemoteTodo(action, item) {
  if (isRemoteUpdating) return true;
  if (!isAuthorizedCoupleSession()) {
    if (state.supabaseUrl && state.supabaseKey) {
      enqueuePendingSync('todos', action, item);
      renderAuthUiState();
    }
    return false;
  }
  try {
    let res;
    if (action === 'delete') {
      res = await supabaseClient.from('todos').delete().eq('id', item.id);
      if (!res.error) remoteSnapshotIds.todos.delete(item.id);
    } else {
      const encTitle = await encryptCoupleField(item.title || '');
      const payload = {
        id: item.id,
        title: encTitle,
        is_completed: item.isCompleted,
        due_date: item.dueDate || null
      };
      res = await supabaseClient.from('todos').upsert(payload);
      if (!res.error) remoteSnapshotIds.todos.add(item.id);
    }
    if (res && res.error) throw res.error;
    clearPendingSyncItem('todos', item.id);
    renderAuthUiState();
    return true;
  } catch (e) {
    console.warn('pushRemoteTodo failed:', e);
    enqueuePendingSync('todos', action, item);
    renderAuthUiState();
    showToast('이 폰에는 저장되었지만 할 일 동기화에 실패했어요. 다시 시도할 수 있어요.');
    return false;
  }
}

async function pushRemoteDiary(action, item) {
  if (isRemoteUpdating) return true;
  if (!isAuthorizedCoupleSession()) {
    if (state.supabaseUrl && state.supabaseKey) {
      enqueuePendingSync('diaries', action, item);
      renderAuthUiState();
    }
    return false;
  }
  try {
    let res;
    if (action === 'delete') {
      res = await supabaseClient.from('diaries').delete().eq('id', item.id);
      if (!res.error) remoteSnapshotIds.diaries.delete(item.id);
    } else {
      const encContent = await encryptCoupleField(item.content || '');
      const rawMedia = Array.isArray(item.media) ? item.media : [];
      const encMedia = [];
      for (const m of rawMedia) {
        if (!m) continue;
        const eUrl = m.url ? await encryptCoupleField(m.url) : '';
        const eName = m.name ? await encryptCoupleField(m.name) : '';
        encMedia.push(Object.assign({}, m, { url: eUrl, name: eName }));
      }
      const payload = {
        id: item.id,
        date: item.date,
        mood: item.mood,
        content: encContent,
        media: encMedia,
        created_at: item.createdAt
      };
      res = await supabaseClient.from('diaries').upsert(payload);
      if (!res.error) remoteSnapshotIds.diaries.add(item.id);
    }
    if (res && res.error) throw res.error;
    clearPendingSyncItem('diaries', item.id);
    renderAuthUiState();
    return true;
  } catch (e) {
    console.warn('pushRemoteDiary failed:', e);
    enqueuePendingSync('diaries', action, item);
    renderAuthUiState();
    showToast('이 폰에는 저장되었지만 일기 동기화에 실패했어요. 다시 시도할 수 있어요.');
    return false;
  }
}

async function retryPendingSyncQueue() {
  if (!isAuthorizedCoupleSession()) {
    showToast('먼저 부부 이메일 로그인으로 인증을 완료해 주세요 🔐');
    return;
  }
  const queue = getPendingSyncQueue();
  if (queue.length === 0) {
    showToast('재시도할 항목이 없어요 👍');
    return;
  }
  let okCount = 0;
  for (const entry of queue) {
    let ok = false;
    if (entry.table === 'events') ok = await pushRemoteEvent(entry.action, entry.item);
    else if (entry.table === 'todos') ok = await pushRemoteTodo(entry.action, entry.item);
    else if (entry.table === 'diaries') ok = await pushRemoteDiary(entry.action, entry.item);
    if (ok) okCount++;
  }
  renderAuthUiState();
  if (getPendingSyncQueue().length === 0) {
    showToast(okCount + '개 변경 사항을 모두 동기화했어요! 💑');
  } else {
    showToast('일부 항목을 아직 전송하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

// ==============================================================================
// 📦 로컬 기록 최초 동기화 미리보기 (자동 덮어쓰기/삭제 방지)
// ==============================================================================
function getUnsyncedLocalCandidates(includeSeeds = false) {
  const candidates = [];
  state.events.forEach(ev => {
    const isSeed = isSampleRecord('event', ev);
    if (!includeSeeds && isSeed) return;
    if (!remoteSnapshotIds.events.has(ev.id)) {
      candidates.push({
        key: 'event:' + ev.id,
        type: 'event',
        isSeed: isSeed,
        item: ev,
        title: '📅 [약속] ' + ev.title,
        subtitle: ev.date + (ev.time ? ' ' + ev.time : ' 하루 종일') + ' · ' + ownerLabel(ev.owner)
      });
    }
  });
  state.todos.forEach(td => {
    const isSeed = isSampleRecord('todo', td);
    if (!includeSeeds && isSeed) return;
    if (!remoteSnapshotIds.todos.has(td.id)) {
      candidates.push({
        key: 'todo:' + td.id,
        type: 'todo',
        isSeed: isSeed,
        item: td,
        title: '✅ [할 일] ' + td.title,
        subtitle: (td.dueDate || '날짜 없음') + (td.isCompleted ? ' · 완료됨' : ' · 진행 중')
      });
    }
  });
  state.diaries.forEach(di => {
    const isSeed = isSampleRecord('diary', di);
    if (!includeSeeds && isSeed) return;
    if (!remoteSnapshotIds.diaries.has(di.id)) {
      const mediaCount = (di.media && di.media.length) || 0;
      const mediaBytes = (di.media || []).reduce((acc, m) => acc + String(m.url || '').length, 0);
      const approxKb = Math.round((mediaBytes * 0.75) / 1024);
      const mediaNote = mediaCount > 0 ? (' · 사진/영상 ' + mediaCount + '개 (약 ' + approxKb + 'KB)') : '';
      candidates.push({
        key: 'diary:' + di.id,
        type: 'diary',
        isSeed: isSeed,
        item: di,
        title: '📖 [일기] ' + (di.mood || '🥰') + ' ' + diaryPreviewText(di),
        subtitle: di.date + mediaNote
      });
    }
  });
  return candidates;
}

function renderInitialSyncModalList() {
  const chkSeeds = document.getElementById('chkSyncIncludeSeeds');
  const includeSeeds = !!(chkSeeds && chkSeeds.checked);
  const listEl = document.getElementById('initialSyncList');
  if (!listEl) return;

  const candidates = getUnsyncedLocalCandidates(includeSeeds);
  if (candidates.length === 0) {
    listEl.innerHTML = '<div class="py-8 text-center text-xs text-slate-400">이 휴대폰에서 새로 올릴 로컬 기록이 없어요.<br>(기본 예시 기록을 포함하려면 위 체크박스를 눌러 보세요)</div>';
    return;
  }

  listEl.innerHTML = candidates.map(c => {
    const checkedAttr = c.isSeed ? '' : 'checked';
    const seedBadge = c.isSeed ? '<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold">예시 샘플</span>' : '';
    return '<label class="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 cursor-pointer hover:bg-slate-100 transition">'
      + '<input type="checkbox" class="initial-sync-chk mt-1 w-4 h-4 rounded" data-sync-key="' + escapeHtml(c.key) + '" ' + checkedAttr + '>'
      + '<span class="flex-1 min-w-0">'
      + '<span class="block text-xs font-extrabold text-slate-800 truncate">' + escapeHtml(c.title) + seedBadge + '</span>'
      + '<span class="block text-[11px] text-slate-500 mt-0.5">' + escapeHtml(c.subtitle) + '</span>'
      + '</span>'
      + '</label>';
  }).join('');
}

function openInitialSyncModal() {
  const modal = document.getElementById('initialSyncModal');
  if (!modal) return;
  renderInitialSyncModalList();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeInitialSyncModal() {
  const modal = document.getElementById('initialSyncModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function maybePromptInitialSync() {
  if (!isAuthorizedCoupleSession()) return;
  const realCandidates = getUnsyncedLocalCandidates(false);
  const promptedKey = 'cal_initial_sync_prompted_' + (authState.user ? authState.user.id : 'default');
  if (realCandidates.length > 0 && !localStorage.getItem(promptedKey)) {
    localStorage.setItem(promptedKey, '1');
    openInitialSyncModal();
  }
}

async function confirmInitialSyncSelection() {
  if (!isAuthorizedCoupleSession()) {
    showToast('먼저 부부 계정 로그인을 완료해 주세요 🔐');
    return;
  }
  const chkSeeds = document.getElementById('chkSyncIncludeSeeds');
  const candidates = getUnsyncedLocalCandidates(!!(chkSeeds && chkSeeds.checked));
  const selectedKeys = new Set(
    Array.from(document.querySelectorAll('.initial-sync-chk:checked')).map(el => el.dataset.syncKey)
  );
  const chosen = candidates.filter(c => selectedKeys.has(c.key));
  if (chosen.length === 0) {
    closeInitialSyncModal();
    showToast('선택된 기록이 없어 로컬 상태로 유지했어요.');
    return;
  }
  let successCount = 0;
  for (const entry of chosen) {
    let ok = false;
    if (entry.type === 'event') ok = await pushRemoteEvent('insert', entry.item);
    else if (entry.type === 'todo') ok = await pushRemoteTodo('insert', entry.item);
    else if (entry.type === 'diary') ok = await pushRemoteDiary('insert', entry.item);
    if (ok) successCount++;
  }
  closeInitialSyncModal();
  if (successCount === chosen.length) {
    showToast(successCount + '개 기록을 부부 공유 캘린더에 안전하게 합쳤어요! 🎉');
  } else {
    showToast(successCount + '/' + chosen.length + '개 합침 완료 (나머지는 로컬 보존 및 재시도 가능)');
  }
}


// ==============================================================================
// 📅 우리의 캘린더 - 주간/월간 접기, 세그먼트 탭, 더보기 기능 통합 스크립트
// ==============================================================================

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// 1. 대한민국 법정 공휴일 데이터
const FIXED_HOLIDAYS = {
  '01-01': '신정',
  '03-01': '삼일절',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '성탄절'
};

const SPECIAL_HOLIDAYS = {
  '2024-02-09': '설연휴', '2024-02-10': '설날', '2024-02-11': '설연휴', '2024-02-12': '대체공휴일',
  '2024-04-10': '총선', '2024-05-06': '대체공휴일', '2024-05-15': '석가탄신일',
  '2024-09-16': '추석연휴', '2024-09-17': '추석', '2024-09-18': '추석연휴',
  '2025-01-28': '설연휴', '2025-01-29': '설날', '2025-01-30': '설연휴',
  '2025-03-03': '대체공휴일', '2025-05-06': '석가탄신일',
  '2025-10-05': '추석연휴', '2025-10-06': '추석', '2025-10-07': '추석연휴', '2025-10-08': '대체공휴일',
  '2026-02-16': '설연휴', '2026-02-17': '설날', '2026-02-18': '설연휴',
  '2026-03-02': '대체공휴일',
  '2026-05-24': '석가탄신일', '2026-05-25': '대체공휴일',
  '2026-08-17': '대체공휴일',
  '2026-09-24': '추석연휴', '2026-09-25': '추석', '2026-09-26': '추석연휴',
  '2026-10-05': '대체공휴일',
  '2027-02-06': '설연휴', '2027-02-07': '설날', '2027-02-08': '설연휴', '2027-02-09': '대체공휴일',
  '2027-05-13': '석가탄신일',
  '2027-09-14': '추석연휴', '2027-09-15': '추석', '2027-09-16': '추석연휴'
};

function getHoliday(dateStr) {
  if (SPECIAL_HOLIDAYS[dateStr]) return SPECIAL_HOLIDAYS[dateStr];
  const mmdd = dateStr.substring(5);
  if (FIXED_HOLIDAYS[mmdd]) return FIXED_HOLIDAYS[mmdd];
  return null;
}

// 2. 테마 프리셋
const THEMES = {
  indigo: { primary: '#4F46E5', secondary: '#F43F5E', bg: '#F8FAFC', card: 'rgba(255, 255, 255, 0.94)', text: '#0F172A' },
  rose: { primary: '#E11D48', secondary: '#FB7185', bg: '#FFF1F2', card: 'rgba(255, 255, 255, 0.94)', text: '#1E293B' },
  forest: { primary: '#059669', secondary: '#10B981', bg: '#F0FDF4', card: 'rgba(255, 255, 255, 0.94)', text: '#0F172A' },
  sunset: { primary: '#D97706', secondary: '#F59E0B', bg: '#FFFBEB', card: 'rgba(255, 255, 255, 0.94)', text: '#1C1917' },
  violet: { primary: '#7C3AED', secondary: '#EC4899', bg: '#FAF5FF', card: 'rgba(255, 255, 255, 0.94)', text: '#1E1B4B' },
  dark: { primary: '#6366F1', secondary: '#F43F5E', bg: '#0F172A', card: 'rgba(30, 41, 59, 0.95)', text: '#F8FAFC', isDark: true }
};

function parseRemoteEvent(re) {
  const rawOwner = re.owner || 'both';
  const parts = rawOwner.split('|');
  const owner = parts[0] || 'both';
  const repeat = parts[1] || re.repeat || 'none';
  const date = (re.date || re.start_time || '').slice(0, 10);
  const rawEnd = re.end_time ? re.end_time.slice(0, 10) : (re.endDate || date);
  const endDate = rawEnd && rawEnd >= date ? rawEnd : date;
  return {
    id: re.id,
    title: re.title,
    date: date,
    endDate: endDate,
    time: re.time !== undefined ? re.time : (re.start_time ? re.start_time.slice(11, 16) : ''),
    owner: owner,
    repeat: repeat,
    color: re.color || OWNER_COLORS[owner] || OWNER_COLORS.both
  };
}

function eventMatchesDate(ev, dateStr) {
  if (!ev || !ev.date) return false;
  const end = ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date;
  if (dateStr >= ev.date && dateStr <= end) return true;
  if (dateStr < ev.date) return false;
  if (ev.repeat === 'monthly') {
    return dateStr.slice(8, 10) === ev.date.slice(8, 10);
  }
  if (ev.repeat === 'yearly') {
    return dateStr.slice(5, 10) === ev.date.slice(5, 10);
  }
  return false;
}

function nextOccurrenceOnOrAfter(ev, todayStr) {
  const end = ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date;
  if (end >= todayStr) {
    return ev.date >= todayStr ? ev.date : todayStr;
  }
  const tp = todayStr.split('-').map(Number);
  const ep = ev.date.split('-').map(Number);
  if (ev.repeat === 'monthly') {
    let y = tp[0], m = tp[1];
    const day = ep[2];
    const candidate = y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    if (candidate >= todayStr) return candidate;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    return y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  if (ev.repeat === 'yearly') {
    let y = tp[0];
    const mmdd = ev.date.slice(5, 10);
    const candidate = y + '-' + mmdd;
    if (candidate >= todayStr) return candidate;
    return (y + 1) + '-' + mmdd;
  }
  return null;
}

function eventMetaBadge(ev) {
  const badges = [];
  if (ev.repeat === 'monthly') badges.push('🔁 매달');
  else if (ev.repeat === 'yearly') badges.push('🎂 매년');
  if (ev.endDate && ev.endDate > ev.date) {
    const s = ev.date.split('-').map(Number);
    const e = ev.endDate.split('-').map(Number);
    badges.push(s[1] + '/' + s[2] + '~' + e[1] + '/' + e[2]);
  }
  return badges.length ? ' · ' + badges.join(' · ') : '';
}

function updateRepeatButtons() {
  document.querySelectorAll('.repeat-preset-btn').forEach(function(btn) {
    const on = btn.dataset.repeat === (state.selectedRepeat || 'none');
    btn.classList.toggle('bg-theme-primary', on);
    btn.classList.toggle('text-white', on);
    btn.classList.toggle('bg-white', !on);
    btn.classList.toggle('text-slate-600', !on);
  });
}

// 누구 약속인지 색깔
const OWNER_COLORS = { husband: '#3B82F6', wife: '#EC4899', both: '#8B5CF6' };

function ownerLabel(owner) {
  if (owner === 'husband') return state.husbandName;
  if (owner === 'wife') return state.wifeName;
  return '우리 둘';
}

function eventColor(ev) {
  if (ev.owner && OWNER_COLORS[ev.owner]) return OWNER_COLORS[ev.owner];
  return ev.color || state.customPrimaryColor;
}

function timeLabel(t) {
  if (!t) return '하루 종일';
  const hm = t.split(':').map(Number);
  const ampm = hm[0] < 12 ? '오전' : '오후';
  const h12 = hm[0] % 12 === 0 ? 12 : hm[0] % 12;
  return ampm + ' ' + h12 + ':' + String(hm[1]).padStart(2, '0');
}

// 아래쪽 알림 + 되돌리기
let toastTimer = null;
let toastUndoFn = null;

function showToast(msg, undoFn) {
  const el = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  toastUndoFn = undoFn || null;
  document.getElementById('toastUndo').classList.toggle('hidden', !undoFn);
  el.classList.remove('hidden');
  el.classList.add('flex');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undoFn ? 5000 : 2200);
}

function hideToast() {
  const el = document.getElementById('toast');
  el.classList.add('hidden');
  el.classList.remove('flex');
  toastUndoFn = null;
}

function restoreAt(list, idx, item) {
  list.splice(Math.min(idx, list.length), 0, item);
}

// 선택한 날짜로 이동
function goToDate(dateStr) {
  const p = dateStr.split('-').map(Number);
  state.selectedDate = dateStr;
  state.currentYear = p[0];
  state.currentMonth = p[1] - 1;
  renderCalendar();
  renderSelectedDateView();
}

function setSubTab(name) {
  state.currentSubTab = name;
}

function eventMatchesOwnerFilter(ev) {
  const f = state.calendarOwnerFilter || 'all';
  if (f === 'all') return true;
  return (ev.owner || 'both') === f;
}

window.setCalendarOwnerFilter = function(key) {
  if (key !== 'all' && state.calendarOwnerFilter === key) {
    state.calendarOwnerFilter = 'all';
  } else {
    state.calendarOwnerFilter = key;
  }
  state.upcomingFilter = state.calendarOwnerFilter;
  renderLegend();
  renderCalendar();
  renderSelectedDateView();
};

function renderLegend() {
  const cur = state.calendarOwnerFilter || 'all';
  const items = [['all', '전체', null], ['husband', state.husbandName, OWNER_COLORS.husband], ['wife', state.wifeName, OWNER_COLORS.wife], ['both', '우리 둘', OWNER_COLORS.both]];
  document.getElementById('calendarLegend').innerHTML = items.map(function(p) {
    const key = p[0], label = p[1], dotColor = p[2];
    const active = cur === key;
    const activeBg = dotColor || 'var(--theme-primary)';
    const isDark = document.body.classList.contains('theme-dark');
    const inactiveStyle = isDark ? 'background:#0F172A;color:#CBD5E1;border-color:#334155' : 'background:#F8FAFC;color:#475569;border-color:#E2E8F0';
    const style = active ? ('background:' + activeBg + ';color:#FFFFFF;border-color:' + activeBg) : inactiveStyle;
    const dotHtml = dotColor ? ('<span class="w-2 h-2 rounded-full" style="background:' + (active ? '#FFFFFF' : dotColor) + '"></span>') : '';
    return '<button type="button" onclick="setCalendarOwnerFilter(\'' + key + '\')" class="cal-owner-chip flex items-center justify-center gap-1 py-1.5 rounded-xl border transition active:scale-95 whitespace-nowrap" data-cal-owner="' + key + '" style="' + style + '">' + dotHtml + escapeHtml(label) + '</button>';
  }).join('');
}

function updateOwnerButtons() {
  document.getElementById('ownerNameHusband').textContent = state.husbandName;
  document.getElementById('ownerNameWife').textContent = state.wifeName;
  document.querySelectorAll('.owner-btn').forEach(function(btn) {
    const c = OWNER_COLORS[btn.dataset.owner];
    const on = btn.dataset.owner === state.selectedOwner;
    const isDark = document.body.classList.contains('theme-dark');
    btn.style.borderColor = on ? c : (isDark ? '#334155' : '#E2E8F0');
    btn.style.backgroundColor = on ? c + '28' : (isDark ? '#0F172A' : '#FFFFFF');
    btn.style.color = on ? c : (isDark ? '#CBD5E1' : '#475569');
  });
}

function updateTimeButtons() {
  document.querySelectorAll('.time-preset-btn').forEach(function(btn) {
    const on = btn.dataset.time === state.selectedTime;
    btn.classList.toggle('bg-theme-primary', on);
    btn.classList.toggle('text-white', on);
    btn.classList.toggle('bg-white', !on);
    btn.classList.toggle('text-slate-600', !on);
  });
  inputItemTime.classList.toggle('hidden', state.selectedTime !== 'custom');
}

function openChooser() {
  const p = state.selectedDate.split('-');
  document.getElementById('chooserDateText').textContent = parseInt(p[1]) + '월 ' + parseInt(p[2]) + '일에 넣어요';
  const m = document.getElementById('chooserModal');
  m.classList.remove('hidden');
  m.classList.add('flex');
}

function closeChooser() {
  const m = document.getElementById('chooserModal');
  m.classList.add('hidden');
  m.classList.remove('flex');
}

function closeAddModal() {
  addModal.classList.add('hidden');
  addModal.classList.remove('flex');
  state.tempMediaFiles = [];
  state.editingId = null;
}

// 날짜를 누르면 뜨는 창
function openDaySheet() {
  const s = document.getElementById('daySheet');
  s.classList.remove('hidden');
  s.classList.add('flex');
}

function closeDaySheet() {
  const s = document.getElementById('daySheet');
  s.classList.add('hidden');
  s.classList.remove('flex');
}

function shiftSelectedDay(delta) {
  const p = state.selectedDate.split('-').map(Number);
  goToDate(formatDate(new Date(p[0], p[1] - 1, p[2] + delta)));
}

window.openDayFromList = function(dateStr) {
  closeUpcomingSheet();
  goToDate(dateStr);
  openDaySheet();
};

function relativeDayLabel(dateStr) {
  const p = dateStr.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((new Date(p[0], p[1] - 1, p[2]) - today) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === 2) return '모레';
  return p[1] + '/' + p[2] + ' (' + ['일', '월', '화', '수', '목', '금', '토'][new Date(p[0], p[1] - 1, p[2]).getDay()] + ')';
}

function upcomingEvents() {
  const todayStr = formatDate(new Date());
  const results = [];
  state.events.forEach(function(ev) {
    if (!eventMatchesOwnerFilter(ev)) return;
    const nextDate = nextOccurrenceOnOrAfter(ev, todayStr);
    if (nextDate) {
      results.push(Object.assign({}, ev, { displayDate: nextDate }));
    }
  });
  return results.sort(function(a, b) {
    return ((a.displayDate || a.date) + (a.time || '00:00')).localeCompare((b.displayDate || b.date) + (b.time || '00:00'));
  });
}

function upcomingRowHtml(ev) {
  const color = eventColor(ev);
  const targetDate = ev.displayDate || ev.date;
  return '<button type="button" class="w-full flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50/80 border border-slate-100 hover:bg-slate-100 text-left transition" onclick="openDayFromList(\'' + targetDate + '\')">'
    + '<span class="w-[64px] flex-shrink-0 text-xs font-extrabold" style="color:' + color + '">' + relativeDayLabel(targetDate) + '</span>'
    + '<span class="w-1.5 h-8 rounded-full flex-shrink-0" style="background-color:' + color + '"></span>'
    + '<span class="flex-1 min-w-0"><span class="block text-sm font-bold text-slate-800 truncate">' + escapeHtml(ev.title) + '</span>'
    + '<span class="block text-xs text-slate-500">' + timeLabel(ev.time) + ' · ' + escapeHtml(ownerLabel(ev.owner)) + escapeHtml(eventMetaBadge(ev)) + '</span></span>'
    + '<i class="fa-solid fa-chevron-right text-[10px] text-slate-300"></i>'
    + '</button>';
}

// 첫 화면에는 3개만, 나머지는 "더 보기" 창에서
function renderUpcoming() {
  const box = document.getElementById('upcomingList');
  if (!box) return;
  const all = upcomingEvents();
  const btn = document.getElementById('btnShowAllUpcoming');
  document.getElementById('upcomingCount').textContent = all.length ? all.length + '개' : '';
  if (all.length === 0) {
    box.innerHTML = '<div class="py-4 text-center text-sm text-slate-400">다가오는 약속이 없어요.<br>달력에서 날짜를 눌러 넣어 보세요.</div>';
    btn.classList.add('hidden');
  } else {
    box.innerHTML = all.slice(0, 3).map(upcomingRowHtml).join('');
    btn.classList.toggle('hidden', all.length <= 3);
    btn.textContent = '나머지 ' + (all.length - 3) + '개 더 보기 ›';
  }
  if (!document.getElementById('upcomingSheet').classList.contains('hidden')) renderUpcomingSheet();
}

function upcomingGroupLabel(dateStr) {
  const p = dateStr.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((new Date(p[0], p[1] - 1, p[2]) - today) / 86400000);
  if (diff < 0) return '지난 약속';
  const daysToSaturday = 6 - today.getDay();
  if (diff <= daysToSaturday) return '이번 주';
  if (diff <= daysToSaturday + 7) return '다음 주';
  return p[0] === today.getFullYear() ? p[1] + '월' : p[0] + '년 ' + p[1] + '월';
}

function renderUpcomingSheet() {
  const f = state.upcomingFilter;
  const q = (state.eventSearch || '').trim().toLowerCase();
  const names = { all: '전체', husband: state.husbandName, wife: state.wifeName, both: '우리 둘' };
  document.querySelectorAll('.up-filter-btn').forEach(function(b) {
    const key = b.dataset.upFilter;
    const on = key === f;
    b.textContent = names[key];
    const isDark = document.body.classList.contains('theme-dark');
    b.style.backgroundColor = on ? (key === 'all' ? 'var(--theme-primary)' : OWNER_COLORS[key]) : (isDark ? '#0F172A' : '#F1F5F9');
    b.style.color = on ? '#FFFFFF' : (isDark ? '#CBD5E1' : '#475569');
  });
  const baseList = q
    ? state.events.filter(function(e) { return (e.title || '').toLowerCase().includes(q); })
        .map(function(e) { return Object.assign({}, e, { displayDate: e.date }); })
        .sort(function(a, b) { return (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')); })
    : upcomingEvents();
  const list = baseList.filter(function(e) { return f === 'all' || (e.owner || 'both') === f; });
  const box = document.getElementById('upcomingSheetList');
  if (list.length === 0) {
    box.innerHTML = '<div class="py-8 text-center text-sm text-slate-400">' + (q ? '찾으시는 약속이 없어요.' : '해당하는 약속이 없어요.') + '</div>';
    return;
  }
  const groups = [];
  list.forEach(function(ev) {
    const label = upcomingGroupLabel(ev.displayDate || ev.date);
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) {
      g = { label: label, items: [] };
      groups.push(g);
    }
    g.items.push(ev);
  });
  box.innerHTML = groups.map(function(g) {
    return '<div class="text-xs font-extrabold text-slate-500 pt-2 pb-0.5">' + g.label + ' · ' + g.items.length + '개</div>'
      + g.items.map(upcomingRowHtml).join('');
  }).join('');
}

function openUpcomingSheet() {
  renderUpcomingSheet();
  const s = document.getElementById('upcomingSheet');
  s.classList.remove('hidden');
  s.classList.add('flex');
  document.getElementById('upcomingSheetList').scrollTop = 0;
}

function closeUpcomingSheet() {
  const s = document.getElementById('upcomingSheet');
  s.classList.add('hidden');
  s.classList.remove('flex');
}

function setEditUi(title) {
  document.getElementById('addModalTitle').textContent = title;
  btnSubmitItem.textContent = '고친 내용 저장';
  document.getElementById('btnBackToChooser').classList.add('hidden');
}

window.editEvent = function(id) {
  const ev = state.events.find(function(e) { return e.id === id; });
  if (!ev) return;
  openModalWithMode('event');
  state.editingId = id;
  inputItemTitle.value = ev.title;
  inputItemDate.value = ev.date;
  document.getElementById('inputItemEndDate').value = ev.endDate || ev.date;
  state.selectedOwner = ev.owner || 'both';
  state.selectedRepeat = ev.repeat || 'none';
  updateRepeatButtons();
  if (!ev.time) {
    state.selectedTime = 'allday';
  } else if (['09:00', '12:00', '19:00'].indexOf(ev.time) >= 0) {
    state.selectedTime = ev.time;
  } else {
    state.selectedTime = 'custom';
    inputItemTime.value = ev.time;
  }
  updateOwnerButtons();
  updateTimeButtons();
  setEditUi('📅 약속 고치기');
};

window.editDiary = function(id) {
  const d = state.diaries.find(function(x) { return x.id === id; });
  if (!d) return;
  closeDiaryDetail();
  openModalWithMode('diary');
  state.editingId = id;
  inputItemTitle.value = d.content || '';
  inputItemDate.value = d.date;
  state.selectedMood = d.mood || '🥰';
  document.querySelectorAll('.mood-btn').forEach(function(b) {
    const on = b.dataset.mood === state.selectedMood;
    b.classList.toggle('ring-2', on);
    b.classList.toggle('ring-indigo-500', on);
  });
  state.tempMediaFiles = (d.media || []).slice();
  renderMediaPreviews();
  setEditUi('📖 일기 고치기');
};

// 사진 줄이기 (휴대폰 사진은 3~5MB라 그대로 넣으면 금방 꽉 참)
function readFileAsDataURL(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImage(file, maxSide, quality) {
  return readFileAsDataURL(file).then(function(url) {
    return new Promise(function(resolve) {
      const img = new Image();
      img.onload = function() {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function() { resolve(url); };
      img.src = url;
    });
  });
}

window.openPhotoViewer = function(src) {
  document.getElementById('photoViewerImg').src = src;
  const v = document.getElementById('photoViewer');
  v.classList.remove('hidden');
  v.classList.add('flex');
};

window.closePhotoViewer = function() {
  const v = document.getElementById('photoViewer');
  v.classList.add('hidden');
  v.classList.remove('flex');
  document.getElementById('photoViewerImg').src = '';
};

// 백업
const BACKUP_KEYS = ['cal_events', 'cal_todos', 'cal_diaries', 'cal_day_stickers', 'cal_custom_stickers', 'cal_sticker_size', 'cal_anniversary', 'cal_theme_id', 'cal_custom_color', 'cal_is_dark', 'cal_custom_text_color', 'cal_bg_photo', 'cal_bg_opacity', 'cal_bg_blur', 'cal_name_husband', 'cal_name_wife'];

function renderLastBackup() {
  const t = localStorage.getItem('cal_last_backup');
  document.getElementById('lastBackupText').textContent = t ? '마지막 백업: ' + t : '아직 백업한 적이 없어요.';
}

function exportBackup() {
  const data = { app: 'our-calendar', version: 1, savedAt: new Date().toISOString(), items: {} };
  BACKUP_KEYS.forEach(function(k) {
    const v = localStorage.getItem(k);
    if (v !== null) data.items[k] = v;
  });
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '우리캘린더-백업-' + formatDate(new Date()) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 2000);
  localStorage.setItem('cal_last_backup', formatDate(new Date()));
  renderLastBackup();
  showToast('백업 파일을 저장했어요! 💾');
}

function importBackup(file) {
  file.text().then(function(txt) {
    let data;
    try { data = JSON.parse(txt); } catch (e) { data = null; }
    if (!data || data.app !== 'our-calendar' || !data.items) {
      showToast('우리 캘린더 백업 파일이 아니에요 🤔');
      return;
    }
    if (!confirm('백업 파일로 바꾸면 지금 기록이 백업 내용으로 바뀌어요. 계속할까요?')) return;
    try {
      BACKUP_KEYS.forEach(function(k) {
        if (k in data.items) localStorage.setItem(k, data.items[k]);
        else localStorage.removeItem(k);
      });
      localStorage.setItem('cal_seeded', '1');
      location.reload();
    } catch (e) {
      showToast('백업을 불러오지 못했어요 😥');
    }
  });
}

// 3. 상태 관리
let state = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  selectedDate: formatDate(new Date()),
  calendarView: 'month', // 'month' (월간) or 'week' (주간 접기)
  currentSubTab: 'events', // 'events' or 'diary' (선택 날짜 카드 서브탭)
  anniversaryDate: localStorage.getItem('cal_anniversary') || '2024-05-18',
  currentThemeId: localStorage.getItem('cal_theme_id') || 'indigo',
  customPrimaryColor: localStorage.getItem('cal_custom_color') || '#4F46E5',
  isDarkTheme: localStorage.getItem('cal_is_dark') === '1' || localStorage.getItem('cal_theme_id') === 'dark',
  customTextColor: localStorage.getItem('cal_custom_text_color') || '',
  bgPhoto: localStorage.getItem('cal_bg_photo') || null,
  bgOpacity: localStorage.getItem('cal_bg_opacity') || '18',
  bgBlur: localStorage.getItem('cal_bg_blur') || '16',
  events: JSON.parse(localStorage.getItem('cal_events') || '[]'),
  todos: JSON.parse(localStorage.getItem('cal_todos') || '[]'),
  diaries: JSON.parse(localStorage.getItem('cal_diaries') || '[]'),
  dayStickers: JSON.parse(localStorage.getItem('cal_day_stickers') || '{}'),
  customStickers: JSON.parse(localStorage.getItem('cal_custom_stickers') || '[]'),
  stickerThemeId: localStorage.getItem('cal_sticker_theme') || 'ramjju',
  stickerSize: localStorage.getItem('cal_sticker_size') || 'lg',
  stickerStampMode: false,
  activeStampStickerId: 'ramjju_happy',
  modalType: 'event',
  selectedMood: '🥰',
  tempMediaFiles: [],
  diaryFilterYM: formatDate(new Date()).slice(0, 7),
  diarySearch: '',
  showCompletedTodos: false,
  supabaseUrl: localStorage.getItem('cal_supabase_mode') === 'offline' ? '' : (localStorage.getItem('cal_supabase_url') || DEFAULT_SUPABASE_URL),
  supabaseKey: localStorage.getItem('cal_supabase_mode') === 'offline' ? '' : (localStorage.getItem('cal_supabase_key') || DEFAULT_SUPABASE_KEY),
  husbandName: localStorage.getItem('cal_name_husband') || '강현우',
  wifeName: localStorage.getItem('cal_name_wife') || '김시문',
  selectedOwner: 'both',
  selectedTime: '19:00',
  lastSwipe: 0,
  editingId: null,
  upcomingFilter: 'all',
  calendarOwnerFilter: 'all',
  selectedRepeat: 'none',
  eventSearch: ''
};

// 샘플 데이터
if (!localStorage.getItem('cal_seeded') && state.events.length === 0) {
  const todayStr = formatDate(new Date());
  state.events = [
    { id: '1', title: '부부 저녁 외식', date: todayStr, time: '19:00', owner: 'both', color: '#8B5CF6', isSample: true },
    { id: '2', title: '주말 드라이브 계획', date: todayStr, time: '21:00', owner: 'husband', color: '#3B82F6', isSample: true }
  ];
  saveEvents();
}

if (!localStorage.getItem('cal_seeded') && state.todos.length === 0) {
  const todayStr = formatDate(new Date());
  state.todos = [
    { id: '1', title: '주말 식재료 장보기', isCompleted: false, dueDate: todayStr, isSample: true },
    { id: '2', title: '아파트 관리비 확인', isCompleted: true, dueDate: todayStr, isSample: true }
  ];
  saveTodos();
}

if (!localStorage.getItem('cal_seeded') && state.diaries.length === 0) {
  const todayStr = formatDate(new Date());
  state.diaries = [
    {
      id: '1',
      date: todayStr,
      mood: '🥰',
      content: '오늘 함께 퇴근하고 산책하면서 나눈 대화가 정말 좋았다. 다음 주말에는 바다 보러 가기로 약속!',
      media: [],
      createdAt: new Date().toISOString(),
      isSample: true
    }
  ];
  saveDiaries();
}
localStorage.setItem('cal_seeded', '1');

// DOM 엘리먼트
const userBgLayer = document.getElementById('userBgLayer');
const inputBgPhoto = document.getElementById('inputBgPhoto');
const btnRemoveBgPhoto = document.getElementById('btnRemoveBgPhoto');
const rangeBgOpacity = document.getElementById('rangeBgOpacity');
const rangeBgBlur = document.getElementById('rangeBgBlur');

const calendarMonthTitle = document.getElementById('calendarMonthTitle');
const calendarDaysGrid = document.getElementById('calendarDaysGrid');
const btnToggleCalendarView = document.getElementById('btnToggleCalendarView');
const toggleViewIcon = document.getElementById('toggleViewIcon');
const toggleViewText = document.getElementById('toggleViewText');

const selectedDateTitle = document.getElementById('selectedDateTitle');
const selectedDateSubtitle = document.getElementById('selectedDateSubtitle');
const subTabEventsBtn = document.getElementById('subTabEventsBtn');
const subTabDiaryBtn = document.getElementById('subTabDiaryBtn');
const subTabEventsView = document.getElementById('subTabEventsView');
const subTabDiaryView = document.getElementById('subTabDiaryView');
const selectedDateEventsList = document.getElementById('selectedDateEventsList');
const selectedDateDiaryBox = document.getElementById('selectedDateDiaryBox');
const eventCountBadge = document.getElementById('eventCountBadge');
const diaryCountSubBadge = document.getElementById('diaryCountSubBadge');

const ddayBadge = document.getElementById('ddayBadge');
const currentHeaderDate = document.getElementById('currentHeaderDate');
const todosListContainer = document.getElementById('todosListContainer');
const todoStatsBadge = document.getElementById('todoStatsBadge');
const allDiaryContainer = document.getElementById('allDiaryContainer');
const diaryCountBadge = document.getElementById('diaryCountBadge');

// 모달 엘리먼트
const addModal = document.getElementById('addModal');
const btnOpenAddModal = document.getElementById('btnOpenAddModal');
const btnCloseAddModal = document.getElementById('btnCloseAddModal');
const moodSelectorWrap = document.getElementById('moodSelectorWrap');
const mediaUploadWrap = document.getElementById('mediaUploadWrap');
const inputMediaFiles = document.getElementById('inputMediaFiles');
const mediaCountText = document.getElementById('mediaCountText');
const mediaPreviewGrid = document.getElementById('mediaPreviewGrid');
const timeFieldWrap = document.getElementById('timeFieldWrap');
const inputItemLabel = document.getElementById('inputItemLabel');
const inputItemTitle = document.getElementById('inputItemTitle');
const inputItemDate = document.getElementById('inputItemDate');
const inputItemTime = document.getElementById('inputItemTime');
const btnSubmitItem = document.getElementById('btnSubmitItem');
const customColorPicker = document.getElementById('customColorPicker');
const customColorHex = document.getElementById('customColorHex');
const customTextColorPicker = document.getElementById('customTextColorPicker');
const btnResetTextColor = document.getElementById('btnResetTextColor');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabs = {
  tabCalendar: document.getElementById('tabCalendar'),
  tabTodos: document.getElementById('tabTodos'),
  tabDiary: document.getElementById('tabDiary'),
  tabSettings: document.getElementById('tabSettings')
};

// ==============================================================================
// 🎨 테마 및 배경
// ==============================================================================

// 🐿️ 귀여운 다람쥐(람쭈 스타일) & 아기토끼 캐릭터 일러스트 스티커팩 (SVG 내장)
function makeSvgStickerDataUri(svgInner) {
  const full = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + svgInner + '</svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(full);
}

const DEFAULT_CHARACTER_STICKERS = [
  {
    id: 'ramjju_happy',
    name: '신남 다람쥐',
    src: makeSvgStickerDataUri(
      '<ellipse cx="76" cy="62" rx="16" ry="20" fill="#E69F45" stroke="#4A2C11" stroke-width="3.5" transform="rotate(20 76 62)"/>' +
      '<path d="M72 52 C84 48 86 66 74 68" fill="none" stroke="#B86B1B" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="30" cy="24" r="11" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="64" cy="24" r="11" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="68" rx="22" ry="18" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="46" rx="28" ry="23" fill="#F7C46C" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="24" cy="50" r="10" fill="#FFD384"/>' +
      '<circle cx="70" cy="50" r="10" fill="#FFD384"/>' +
      '<path d="M42 23 L47 32 L52 23 Z" fill="#5C3317"/>' +
      '<ellipse cx="26" cy="52" rx="6" ry="4" fill="#FF7B89" opacity="0.75"/>' +
      '<ellipse cx="68" cy="52" rx="6" ry="4" fill="#FF7B89" opacity="0.75"/>' +
      '<circle cx="37" cy="43" r="3.5" fill="#2D1808"/><circle cx="38.2" cy="41.8" r="1.2" fill="#FFF"/>' +
      '<circle cx="57" cy="43" r="3.5" fill="#2D1808"/><circle cx="58.2" cy="41.8" r="1.2" fill="#FFF"/>' +
      '<path d="M42 49 Q47 56 52 49 Z" fill="#FF6B6B" stroke="#4A2C11" stroke-width="2.5"/>' +
      '<ellipse cx="20" cy="60" rx="7" ry="5" fill="#F7C46C" stroke="#4A2C11" stroke-width="3" transform="rotate(-30 20 60)"/>' +
      '<ellipse cx="74" cy="60" rx="7" ry="5" fill="#F7C46C" stroke="#4A2C11" stroke-width="3" transform="rotate(30 74 60)"/>'
    )
  },
  {
    id: 'ramjju_love',
    name: '하트뿅 다람쥐',
    src: makeSvgStickerDataUri(
      '<ellipse cx="76" cy="64" rx="15" ry="19" fill="#E69F45" stroke="#4A2C11" stroke-width="3.5" transform="rotate(20 76 64)"/>' +
      '<circle cx="30" cy="27" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="64" cy="27" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="70" rx="21" ry="16" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="48" rx="27" ry="22" fill="#F7C46C" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<path d="M42 26 L47 35 L52 26 Z" fill="#5C3317"/>' +
      '<ellipse cx="26" cy="53" rx="6.5" ry="4.5" fill="#FF5E7E" opacity="0.85"/>' +
      '<ellipse cx="68" cy="53" rx="6.5" ry="4.5" fill="#FF5E7E" opacity="0.85"/>' +
      '<path d="M33 43 Q37 38 41 43" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M53 43 Q57 38 61 43" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M43 50 Q47 54 51 50" fill="none" stroke="#4A2C11" stroke-width="2.8" stroke-linecap="round"/>' +
      '<path d="M47 18 C43 10 31 12 35 21 C38 26 47 30 47 30 C47 30 56 26 59 21 C63 12 51 10 47 18 Z" fill="#FF477E" stroke="#4A2C11" stroke-width="2.5"/>'
    )
  },
  {
    id: 'ramjju_cry',
    name: '우앙 다람쥐',
    src: makeSvgStickerDataUri(
      '<ellipse cx="75" cy="64" rx="15" ry="18" fill="#E69F45" stroke="#4A2C11" stroke-width="3.5" transform="rotate(20 75 64)"/>' +
      '<circle cx="30" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="64" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="70" rx="21" ry="16" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="48" rx="27" ry="22" fill="#F7C46C" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<path d="M42 26 L47 35 L52 26 Z" fill="#5C3317"/>' +
      '<path d="M31 44 L40 46 L31 48" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M63 44 L54 46 L63 48" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="28" y="47" width="7" height="22" rx="3.5" fill="#60A5FA"/>' +
      '<rect x="59" y="47" width="7" height="22" rx="3.5" fill="#60A5FA"/>' +
      '<path d="M40 56 Q47 48 54 56 Z" fill="#FF6B6B" stroke="#4A2C11" stroke-width="2.5"/>'
    )
  },
  {
    id: 'ramjju_cheer',
    name: '갓생 화이팅',
    src: makeSvgStickerDataUri(
      '<ellipse cx="75" cy="64" rx="15" ry="18" fill="#E69F45" stroke="#4A2C11" stroke-width="3.5" transform="rotate(20 75 64)"/>' +
      '<circle cx="30" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="64" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="70" rx="21" ry="16" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="48" rx="27" ry="22" fill="#F7C46C" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<path d="M22 36 Q47 30 72 36" fill="none" stroke="#EF4444" stroke-width="6" stroke-linecap="round"/>' +
      '<circle cx="37" cy="45" r="3.5" fill="#2D1808"/><circle cx="57" cy="45" r="3.5" fill="#2D1808"/>' +
      '<path d="M33 39 L41 42" stroke="#4A2C11" stroke-width="2.8" stroke-linecap="round"/>' +
      '<path d="M61 39 L53 42" stroke="#4A2C11" stroke-width="2.8" stroke-linecap="round"/>' +
      '<path d="M43 52 Q47 56 51 52" fill="none" stroke="#4A2C11" stroke-width="2.8" stroke-linecap="round"/>' +
      '<circle cx="21" cy="56" r="6.5" fill="#EF4444" stroke="#4A2C11" stroke-width="2.8"/>' +
      '<circle cx="73" cy="56" r="6.5" fill="#EF4444" stroke="#4A2C11" stroke-width="2.8"/>'
    )
  },
  {
    id: 'ramjju_coffee',
    name: '카페 데이트',
    src: makeSvgStickerDataUri(
      '<ellipse cx="75" cy="64" rx="15" ry="18" fill="#E69F45" stroke="#4A2C11" stroke-width="3.5" transform="rotate(20 75 64)"/>' +
      '<circle cx="30" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="64" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="70" rx="21" ry="16" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="48" rx="27" ry="22" fill="#F7C46C" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<path d="M42 26 L47 35 L52 26 Z" fill="#5C3317"/>' +
      '<circle cx="37" cy="44" r="3.5" fill="#2D1808"/>' +
      '<path d="M53 44 Q57 40 61 44" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<ellipse cx="26" cy="52" rx="5.5" ry="3.8" fill="#FF7B89" opacity="0.75"/>' +
      '<ellipse cx="68" cy="52" rx="5.5" ry="3.8" fill="#FF7B89" opacity="0.75"/>' +
      '<rect x="36" y="58" width="22" height="22" rx="5" fill="#FFF" stroke="#4A2C11" stroke-width="3"/>' +
      '<rect x="36" y="65" width="22" height="8" fill="#D97706"/>'
    )
  },
  {
    id: 'ramjju_eat',
    name: '맛있는 외식',
    src: makeSvgStickerDataUri(
      '<circle cx="30" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="64" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="70" rx="21" ry="16" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="48" rx="27" ry="22" fill="#F7C46C" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="24" cy="52" r="11" fill="#FFD384" stroke="#4A2C11" stroke-width="2.5"/>' +
      '<circle cx="70" cy="52" r="11" fill="#FFD384" stroke="#4A2C11" stroke-width="2.5"/>' +
      '<ellipse cx="24" cy="53" rx="6" ry="4" fill="#FF7B89" opacity="0.8"/>' +
      '<ellipse cx="70" cy="53" rx="6" ry="4" fill="#FF7B89" opacity="0.8"/>' +
      '<path d="M33 43 Q37 38 41 43" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M53 43 Q57 38 61 43" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M41 50 Q47 58 53 50" fill="#FF6B6B" stroke="#4A2C11" stroke-width="2.5"/>'
    )
  },
  {
    id: 'bunny_love',
    name: '사랑해 토끼',
    src: makeSvgStickerDataUri(
      '<ellipse cx="36" cy="22" rx="8" ry="18" fill="#FFF" stroke="#4A2C11" stroke-width="3.2" transform="rotate(-8 36 22)"/>' +
      '<ellipse cx="36" cy="23" rx="4" ry="12" fill="#FBB6CE" transform="rotate(-8 36 23)"/>' +
      '<ellipse cx="60" cy="22" rx="8" ry="18" fill="#FFF" stroke="#4A2C11" stroke-width="3.2" transform="rotate(8 60 22)"/>' +
      '<ellipse cx="60" cy="23" rx="4" ry="12" fill="#FBB6CE" transform="rotate(8 60 23)"/>' +
      '<ellipse cx="48" cy="72" rx="20" ry="15" fill="#FFF" stroke="#4A2C11" stroke-width="3.2"/>' +
      '<ellipse cx="48" cy="52" rx="26" ry="21" fill="#FFF" stroke="#4A2C11" stroke-width="3.2"/>' +
      '<ellipse cx="28" cy="55" rx="6" ry="4" fill="#FF7B89" opacity="0.75"/>' +
      '<ellipse cx="68" cy="55" rx="6" ry="4" fill="#FF7B89" opacity="0.75"/>' +
      '<circle cx="38" cy="48" r="3.3" fill="#2D1808"/><circle cx="58" cy="48" r="3.3" fill="#2D1808"/>' +
      '<path d="M45 53 L48 56 L51 53" fill="none" stroke="#FF5E7E" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M48 67 C43 59 31 61 35 71 C38 76 48 81 48 81 C48 81 58 76 61 71 C65 61 53 59 48 67 Z" fill="#FF477E" stroke="#4A2C11" stroke-width="2.5"/>'
    )
  },
  {
    id: 'bunny_party',
    name: '축하 토끼',
    src: makeSvgStickerDataUri(
      '<ellipse cx="34" cy="25" rx="7" ry="16" fill="#FFF" stroke="#4A2C11" stroke-width="3.2" transform="rotate(-15 34 25)"/>' +
      '<ellipse cx="62" cy="25" rx="7" ry="16" fill="#FFF" stroke="#4A2C11" stroke-width="3.2" transform="rotate(15 62 25)"/>' +
      '<polygon points="48,6 37,32 59,32" fill="#8B5CF6" stroke="#4A2C11" stroke-width="3"/>' +
      '<circle cx="48" cy="6" r="4.5" fill="#FBBF24"/>' +
      '<ellipse cx="48" cy="54" rx="26" ry="21" fill="#FFF" stroke="#4A2C11" stroke-width="3.2"/>' +
      '<ellipse cx="28" cy="57" rx="6" ry="4" fill="#FF7B89" opacity="0.8"/>' +
      '<ellipse cx="68" cy="57" rx="6" ry="4" fill="#FF7B89" opacity="0.8"/>' +
      '<path d="M34 49 Q38 44 42 49" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M54 49 Q58 44 62 49" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M43 56 Q48 63 53 56 Z" fill="#FF6B6B" stroke="#4A2C11" stroke-width="2.5"/>'
    )
  },
  {
    id: 'couple_heart',
    name: '우리 둘 하트',
    src: makeSvgStickerDataUri(
      '<circle cx="32" cy="56" r="21" fill="#F7C46C" stroke="#4A2C11" stroke-width="3.2"/>' +
      '<circle cx="68" cy="56" r="21" fill="#FFF" stroke="#4A2C11" stroke-width="3.2"/>' +
      '<ellipse cx="63" cy="29" rx="5.5" ry="13" fill="#FFF" stroke="#4A2C11" stroke-width="3"/>' +
      '<ellipse cx="75" cy="29" rx="5.5" ry="13" fill="#FFF" stroke="#4A2C11" stroke-width="3"/>' +
      '<circle cx="24" cy="39" r="7" fill="#F4B350" stroke="#4A2C11" stroke-width="3"/>' +
      '<circle cx="42" cy="39" r="7" fill="#F4B350" stroke="#4A2C11" stroke-width="3"/>' +
      '<circle cx="26" cy="54" r="2.8" fill="#2D1808"/><circle cx="38" cy="54" r="2.8" fill="#2D1808"/>' +
      '<circle cx="62" cy="54" r="2.8" fill="#2D1808"/><circle cx="74" cy="54" r="2.8" fill="#2D1808"/>' +
      '<path d="M50 22 C45 13 33 15 37 25 C40 31 50 36 50 36 C50 36 60 31 63 25 C67 15 55 13 50 22 Z" fill="#FF477E" stroke="#4A2C11" stroke-width="2.5"/>'
    )
  },
  {
    id: 'ramjju_trip',
    name: '여행 가자',
    src: makeSvgStickerDataUri(
      '<circle cx="30" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="64" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="52" rx="27" ry="22" fill="#F7C46C" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<rect x="25" y="40" width="19" height="12" rx="4" fill="#1E293B" stroke="#FFF" stroke-width="1.5"/>' +
      '<rect x="50" y="40" width="19" height="12" rx="4" fill="#1E293B" stroke="#FFF" stroke-width="1.5"/>' +
      '<line x1="44" y1="45" x2="50" y2="45" stroke="#1E293B" stroke-width="3.5"/>' +
      '<path d="M41 57 Q47 64 53 57" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>'
    )
  },
  {
    id: 'ramjju_sleep',
    name: '푹 쉬는 날',
    src: makeSvgStickerDataUri(
      '<circle cx="30" cy="28" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="64" cy="28" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="54" rx="27" ry="22" fill="#F7C46C" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<path d="M32 49 Q37 53 42 49" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M52 49 Q57 53 62 49" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<ellipse cx="60" cy="56" rx="7" ry="5" fill="#BAE6FD" opacity="0.85" stroke="#0284C7" stroke-width="2"/>' +
      '<text x="68" y="24" font-size="16" font-weight="900" fill="#6366F1">Zzz</text>'
    )
  },
  {
    id: 'ramjju_money',
    name: '월급/보너스',
    src: makeSvgStickerDataUri(
      '<circle cx="30" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<circle cx="64" cy="26" r="10" fill="#F4B350" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<ellipse cx="47" cy="52" rx="27" ry="22" fill="#F7C46C" stroke="#4A2C11" stroke-width="3.5"/>' +
      '<text x="29" y="50" font-size="15">⭐</text><text x="51" y="50" font-size="15">⭐</text>' +
      '<circle cx="47" cy="70" r="14" fill="#FBBF24" stroke="#4A2C11" stroke-width="3"/>' +
      '<text x="41" y="75" font-size="15" font-weight="900" fill="#78350F">₩</text>'
    )
  },
  {
    id: 'bear_happy',
    name: '말랑 곰돌이',
    src: makeSvgStickerDataUri(
      '<circle cx="28" cy="26" r="11" fill="#D9A074" stroke="#4A2C11" stroke-width="3.4"/>' +
      '<circle cx="28" cy="26" r="5.5" fill="#F5CBA7"/>' +
      '<circle cx="68" cy="26" r="11" fill="#D9A074" stroke="#4A2C11" stroke-width="3.4"/>' +
      '<circle cx="68" cy="26" r="5.5" fill="#F5CBA7"/>' +
      '<ellipse cx="48" cy="71" rx="21" ry="15" fill="#D9A074" stroke="#4A2C11" stroke-width="3.4"/>' +
      '<ellipse cx="48" cy="49" rx="27" ry="22" fill="#E6B288" stroke="#4A2C11" stroke-width="3.4"/>' +
      '<ellipse cx="48" cy="54" rx="10" ry="7.5" fill="#FFF5EB" stroke="#4A2C11" stroke-width="2.4"/>' +
      '<ellipse cx="28" cy="54" rx="6" ry="4" fill="#FF8FA3" opacity="0.8"/>' +
      '<ellipse cx="68" cy="54" rx="6" ry="4" fill="#FF8FA3" opacity="0.8"/>' +
      '<circle cx="37" cy="45" r="3.4" fill="#2D1808"/><circle cx="59" cy="45" r="3.4" fill="#2D1808"/>' +
      '<ellipse cx="48" cy="51" rx="3.5" ry="2.5" fill="#4A2C11"/>' +
      '<path d="M44 55 Q48 59 52 55" fill="none" stroke="#4A2C11" stroke-width="2.6" stroke-linecap="round"/>'
    )
  },
  {
    id: 'bear_love',
    name: '하트 곰돌이',
    src: makeSvgStickerDataUri(
      '<circle cx="28" cy="27" r="11" fill="#D9A074" stroke="#4A2C11" stroke-width="3.4"/>' +
      '<circle cx="68" cy="27" r="11" fill="#D9A074" stroke="#4A2C11" stroke-width="3.4"/>' +
      '<ellipse cx="48" cy="51" rx="27" ry="22" fill="#E6B288" stroke="#4A2C11" stroke-width="3.4"/>' +
      '<ellipse cx="48" cy="56" rx="10" ry="7.5" fill="#FFF5EB" stroke="#4A2C11" stroke-width="2.4"/>' +
      '<path d="M33 45 Q37 40 41 45" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M55 45 Q59 40 63 45" fill="none" stroke="#4A2C11" stroke-width="3" stroke-linecap="round"/>' +
      '<ellipse cx="48" cy="53" rx="3.2" ry="2.3" fill="#4A2C11"/>' +
      '<path d="M48 67 C43 59 31 61 35 71 C38 76 48 81 48 81 C48 81 58 76 61 71 C65 61 53 59 48 67 Z" fill="#FF477E" stroke="#4A2C11" stroke-width="2.5"/>'
    )
  },
  {
    id: 'bear_coffee',
    name: '라떼 곰돌이',
    src: makeSvgStickerDataUri(
      '<circle cx="28" cy="26" r="11" fill="#D9A074" stroke="#4A2C11" stroke-width="3.4"/>' +
      '<circle cx="68" cy="26" r="11" fill="#D9A074" stroke="#4A2C11" stroke-width="3.4"/>' +
      '<ellipse cx="48" cy="49" rx="27" ry="22" fill="#E6B288" stroke="#4A2C11" stroke-width="3.4"/>' +
      '<ellipse cx="48" cy="54" rx="10" ry="7" fill="#FFF5EB" stroke="#4A2C11" stroke-width="2.4"/>' +
      '<circle cx="37" cy="45" r="3.4" fill="#2D1808"/><circle cx="59" cy="45" r="3.4" fill="#2D1808"/>' +
      '<ellipse cx="48" cy="51" rx="3.2" ry="2.2" fill="#4A2C11"/>' +
      '<rect x="37" y="59" width="22" height="21" rx="5" fill="#FFF" stroke="#4A2C11" stroke-width="3"/>' +
      '<rect x="37" y="66" width="22" height="7" fill="#B45309"/>'
    )
  }
];

const STICKER_THEMES = [
  {
    id: 'ramjju',
    name: '람쭈와 갓생 다람쥐 테마',
    author: '우리하루 오리지널 · 주간마다 귀여운 다람쥐가 달력을 꾸며줘요',
    badge: '인기 테마',
    mascotId: 'ramjju_happy',
    stickerIds: ['ramjju_happy', 'ramjju_coffee', 'ramjju_love', 'ramjju_cheer', 'ramjju_eat', 'ramjju_sleep'],
    previewIds: ['ramjju_happy', 'ramjju_coffee', 'ramjju_love', 'ramjju_cheer']
  },
  {
    id: 'couple_bunny',
    name: '알콩달콩 토끼·다람쥐 신혼 테마',
    author: '아기토끼와 다람쥐 부부 일러스트가 달력과 일기장을 채워줘요',
    badge: '부부 추천',
    mascotId: 'couple_heart',
    stickerIds: ['couple_heart', 'bunny_love', 'ramjju_love', 'bunny_party', 'ramjju_coffee', 'ramjju_happy'],
    previewIds: ['couple_heart', 'bunny_love', 'ramjju_love', 'bunny_party']
  },
  {
    id: 'peach_bear',
    name: '말랑 복숭아 곰돌이 테마',
    author: '따뜻하고 포근한 곰돌이와 다람쥐 친구들 일러스트 테마',
    badge: '포근 감성',
    mascotId: 'bear_happy',
    stickerIds: ['bear_happy', 'bear_love', 'bear_coffee', 'ramjju_sleep', 'bunny_love'],
    previewIds: ['bear_happy', 'bear_love', 'bear_coffee', 'ramjju_sleep']
  },
  {
    id: 'custom_pack',
    name: '내 사진/짤 캐릭터 테마',
    author: '아래에 추가한 내 사진 캐릭터들로 달력 전체를 자동 꾸며줘요',
    badge: '커스텀',
    mascotId: 'custom',
    stickerIds: [],
    previewIds: []
  },
  {
    id: 'none',
    name: '심플 기본 (캐릭터 없음)',
    author: '캐릭터 일러스트 없이 깔끔한 달력으로만 표시해요',
    badge: '심플',
    mascotId: '',
    stickerIds: [],
    previewIds: []
  }
];

function getAllAvailableStickers() {
  const customs = Array.isArray(state.customStickers) ? state.customStickers : [];
  return DEFAULT_CHARACTER_STICKERS.concat(customs);
}

function resolveStickerSrc(stickerValue) {
  if (!stickerValue) return '';
  if (String(stickerValue).startsWith('data:image/')) return stickerValue;
  const found = getAllAvailableStickers().find(s => s.id === stickerValue);
  return found ? found.src : '';
}

function getActiveStickerTheme() {
  return STICKER_THEMES.find(t => t.id === state.stickerThemeId) || STICKER_THEMES[0];
}

function getActiveThemeStickerPool() {
  const theme = getActiveStickerTheme();
  if (!theme || theme.id === 'none') return [];
  if (theme.id === 'custom_pack') {
    const customs = Array.isArray(state.customStickers) ? state.customStickers : [];
    return customs.length > 0 ? customs.map(c => c.src) : [resolveStickerSrc('ramjju_happy')];
  }
  return (theme.stickerIds || []).map(id => resolveStickerSrc(id)).filter(Boolean);
}

function getActiveThemeMascotSrc() {
  const pool = getActiveThemeStickerPool();
  return pool.length > 0 ? pool[0] : '';
}

// 🐿️ 수동으로 붙이지 않아도 선택된 스티커 테마가 달력 주간(행)마다 자연스럽게 캐릭터를 배치합니다
function getAutoThemeStickerForDate(dateStr, dateNum, dayOfWeek, dayEvents, dayDiaries) {
  const theme = getActiveStickerTheme();
  if (!theme || theme.id === 'none') return '';
  const pool = getActiveThemeStickerPool();
  if (pool.length === 0) return '';

  const parts = String(dateStr).split('-').map(Number);
  const year = parts[0] || state.currentYear;
  const monthIdx = (parts[1] || (state.currentMonth + 1)) - 1;
  const firstDayOffset = new Date(year, monthIdx, 1).getDay();
  const lastDate = new Date(year, monthIdx + 1, 0).getDate();
  const weekRow = Math.floor((firstDayOffset + dateNum - 1) / 7);

  // 결혼기념일 당일에는 항상 사랑스러운 하트/커플 캐릭터 표시
  if (state.anniversaryDate && dateStr.slice(5) === state.anniversaryDate.slice(5) && dateStr >= state.anniversaryDate) {
    if (theme.id === 'couple_bunny') return resolveStickerSrc('couple_heart') || pool[0];
    if (theme.id === 'peach_bear') return resolveStickerSrc('bear_love') || pool[0];
    return resolveStickerSrc('ramjju_love') || pool[0];
  }

  // 해당 주간(일~토)의 날짜 범위 계산 (람쭈 테마 스크린샷처럼 한 주에 1개씩 가장 잘 어울리는 자리에 자동 배치)
  const weekStartDate = Math.max(1, dateNum - dayOfWeek);
  const weekEndDate = Math.min(lastDate, dateNum + (6 - dayOfWeek));

  // 1순위: 이번 주에 약속이나 일기가 있는 날 중 대표 날짜 1곳 선정
  let targetDayInWeek = null;
  for (let d = weekStartDate; d <= weekEndDate; d++) {
    const dStr = year + '-' + String(monthIdx + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const hasEv = state.events.some(e => eventMatchesDate(e, dStr) && eventMatchesOwnerFilter(e));
    const hasDi = state.diaries.some(di => di.date === dStr);
    if (hasEv || hasDi) {
      targetDayInWeek = d;
      if ((d + weekRow) % 2 === 0) break;
    }
  }

  // 2순위: 약속이 없는 주간에도 테마 일러스트처럼 대각선 지그재그 요일에 1개씩 자동 배치
  if (targetDayInWeek === null) {
    const preferredCols = [5, 2, 6, 3, 1, 4];
    const prefDow = preferredCols[(weekRow + monthIdx) % preferredCols.length];
    const candidateDate = (weekRow * 7) - firstDayOffset + prefDow + 1;
    if (candidateDate >= 1 && candidateDate <= lastDate) {
      targetDayInWeek = candidateDate;
    } else {
      targetDayInWeek = weekRow === 0 ? weekEndDate : weekStartDate;
    }
  }

  if (dateNum !== targetDayInWeek) return '';

  // 커스텀 테마면 내 사진 캐릭터들을 순서대로 순환 배치
  if (theme.id === 'custom_pack') {
    return pool[(weekRow + monthIdx) % pool.length];
  }

  // 약속 제목 키워드에 어울리는 표정이 있으면 스마트 매칭
  const combinedText = dayEvents.map(e => e.title || '').join(' ') + ' ' + dayDiaries.map(d => d.content || '').join(' ');
  if (/카페|커피|디저트|브런치|티타임|스타벅스/i.test(combinedText)) {
    return resolveStickerSrc(theme.id === 'peach_bear' ? 'bear_coffee' : 'ramjju_coffee') || pool[weekRow % pool.length];
  }
  if (/외식|저녁|점심|맛집|고기|치킨|피자|술|식사|파티/i.test(combinedText)) {
    return resolveStickerSrc(theme.id === 'couple_bunny' ? 'bunny_party' : 'ramjju_eat') || pool[weekRow % pool.length];
  }
  if (/사랑|데이트|기념일|생일|웨딩|하트|축하/i.test(combinedText)) {
    return resolveStickerSrc(theme.id === 'couple_bunny' ? 'couple_heart' : (theme.id === 'peach_bear' ? 'bear_love' : 'ramjju_love')) || pool[weekRow % pool.length];
  }
  if (/운동|병원|약국|은행|공부|회의|갓생|청소|장보기/i.test(combinedText)) {
    return resolveStickerSrc('ramjju_cheer') || pool[weekRow % pool.length];
  }
  if (/휴식|주말|휴가|꿀잠|호캉스|집콕/i.test(combinedText)) {
    return resolveStickerSrc('ramjju_sleep') || pool[weekRow % pool.length];
  }

  return pool[(weekRow + monthIdx) % pool.length];
}

function saveDayStickers() {
  try {
    localStorage.setItem('cal_day_stickers', JSON.stringify(state.dayStickers || {}));
  } catch (e) {}
}

function saveCustomStickers() {
  try {
    localStorage.setItem('cal_custom_stickers', JSON.stringify(state.customStickers || []));
  } catch (e) {
    showToast('스티커 저장 공간이 부족해요 😥');
  }
}

async function setDateSticker(dateStr, stickerIdOrNull) {
  renderCalendar();
  renderSelectedDateView();
}

function renderStickerUiEverywhere() {
  const size = state.stickerSize || 'lg';
  document.querySelectorAll('.sticker-size-btn').forEach(btn => {
    const on = btn.dataset.size === size;
    btn.className = 'sticker-size-btn px-2.5 py-1 rounded-lg text-xs font-bold border transition ' +
      (on ? 'bg-theme-primary text-white border-theme-primary' : 'bg-white text-slate-600 border-slate-200');
  });

  // 상단 헤더 마스코트 배지 업데이트
  const headerMascot = document.getElementById('headerThemeMascot');
  const mascotSrc = getActiveThemeMascotSrc();
  if (headerMascot) {
    if (mascotSrc) {
      headerMascot.src = mascotSrc;
      headerMascot.classList.remove('hidden');
    } else {
      headerMascot.classList.add('hidden');
    }
  }

  // 1. 꾸미기 탭 캐릭터 스티커 테마 팩 목록 렌더링 (람쭈와 갓생 쭈고 스타일 테마 카드)
  const packList = document.getElementById('stickerThemePackList');
  if (packList) {
    const customs = Array.isArray(state.customStickers) ? state.customStickers : [];
    packList.innerHTML = STICKER_THEMES.map(theme => {
      const isSelected = state.stickerThemeId === theme.id;
      let previewImgs = [];
      if (theme.id === 'custom_pack') {
        previewImgs = customs.slice(0, 4).map(c => c.src);
      } else {
        previewImgs = (theme.previewIds || []).map(id => resolveStickerSrc(id)).filter(Boolean);
      }
      const previewHtml = previewImgs.length > 0
        ? '<div class="flex items-center -space-x-1.5 flex-shrink-0">' +
          previewImgs.map(src => '<img src="' + src + '" class="w-9 h-9 object-contain rounded-xl bg-amber-50/70 p-0.5 border border-amber-200/60 shadow-2xs" alt="">').join('') +
          '</div>'
        : '<div class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-base flex-shrink-0">' + (theme.id === 'none' ? '✨' : '🖼️') + '</div>';
      return '<button type="button" onclick="selectStickerTheme(\'' + theme.id + '\')" class="w-full text-left p-3 rounded-2xl border transition flex items-center justify-between gap-2.5 ' +
        (isSelected ? 'bg-indigo-50/70 border-theme-primary ring-2 ring-theme-primary' : 'bg-slate-50 border-slate-200/80 hover:bg-slate-100/70') + '">' +
        '<div class="flex items-center gap-3 min-w-0">' +
          previewHtml +
          '<div class="min-w-0">' +
            '<div class="flex items-center gap-1.5">' +
              '<span class="text-sm font-extrabold text-slate-800 truncate">' + escapeHtml(theme.name) + '</span>' +
              '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full ' + (isSelected ? 'bg-theme-primary text-white' : 'bg-slate-200/80 text-slate-600') + '">' + (isSelected ? '적용 중' : escapeHtml(theme.badge)) + '</span>' +
            '</div>' +
            '<p class="text-[11px] text-slate-500 truncate mt-0.5">' + escapeHtml(theme.author) + '</p>' +
          '</div>' +
        '</div>' +
      '</button>';
    }).join('');
  }

  // 2. 내 커스텀 캐릭터 목록
  const catalog = document.getElementById('settingsStickerCatalog');
  if (catalog) {
    const customs = Array.isArray(state.customStickers) ? state.customStickers : [];
    if (customs.length === 0) {
      catalog.innerHTML = '<div class="col-span-4 py-3 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">위 [➕ 내 사진 캐릭터 추가]를 눌러 우리 부부 사진이나 좋아하는 캐릭터를 넣으면 테마처럼 달력을 자동 꾸며줘요!</div>';
    } else {
      catalog.innerHTML = customs.map(s => {
        const delBtn = '<button type="button" onclick="deleteCustomSticker(\'' + s.id + '\', event)" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shadow">×</button>';
        return '<div onclick="selectStickerTheme(\'custom_pack\')" class="relative cursor-pointer flex flex-col items-center p-2 rounded-2xl bg-slate-50 border border-slate-200/80 hover:border-amber-400 transition active:scale-95">' +
          delBtn +
          '<img src="' + s.src + '" class="w-12 h-12 object-contain" alt="">' +
          '<span class="text-[10px] font-bold text-slate-600 mt-1 truncate max-w-full">' + escapeHtml(s.name) + '</span>' +
          '</div>';
      }).join('');
    }
  }
}

window.selectStickerTheme = function(themeId) {
  if (themeId === 'custom_pack' && (!state.customStickers || state.customStickers.length === 0)) {
    showToast('먼저 아래 [➕ 내 사진 캐릭터 추가]로 이미지를 1장 이상 올려주세요! 🖼️');
    return;
  }
  state.stickerThemeId = themeId;
  localStorage.setItem('cal_sticker_theme', themeId);
  renderStickerUiEverywhere();
  renderCalendar();
  renderTodos();
  renderAllDiaries();
  const found = getActiveStickerTheme();
  if (themeId === 'none') {
    showToast('심플 기본 달력으로 변경했어요 ✨');
  } else {
    showToast('🐿️ [' + found.name + ']로 달력을 꾸몄어요!');
  }
};

window.selectStampSticker = function(id) {
  state.activeStampStickerId = id;
  renderStickerUiEverywhere();
};

window.startStampWithSticker = function(id) {
  selectStickerTheme('custom_pack');
};

window.deleteCustomSticker = function(id, ev) {
  if (ev) ev.stopPropagation();
  state.customStickers = (state.customStickers || []).filter(s => s.id !== id);
  saveCustomStickers();
  if (state.activeStampStickerId === id) state.activeStampStickerId = 'ramjju_happy';
  renderStickerUiEverywhere();
  showToast('커스텀 스티커를 지웠어요.');
};

window.pickDaySheetSticker = function(stickerId) {
  const cur = (state.dayStickers && state.dayStickers[state.selectedDate]) || '';
  const targetObj = getAllAvailableStickers().find(s => s.id === stickerId);
  const isSame = cur === stickerId || (targetObj && cur === targetObj.src);
  if (isSame) {
    setDateSticker(state.selectedDate, null);
    showToast('스티커를 뗐어요.');
  } else {
    setDateSticker(state.selectedDate, stickerId);
    showToast('이 날에 귀여운 스티커를 붙였어요! 🐿️');
  }
};

function applyTheme(themeConfig, isCustom = false) {
  const root = document.documentElement;
  const isDark = !!themeConfig.isDark;
  const defaultText = isDark ? '#F8FAFC' : (themeConfig.text || '#0F172A');
  const activeText = state.customTextColor || defaultText;
  document.body.classList.toggle('theme-dark', isDark);
  document.body.classList.toggle('has-custom-text-color', !!state.customTextColor);
  root.style.setProperty('--theme-primary', themeConfig.primary);
  root.style.setProperty('--theme-secondary', themeConfig.secondary || '#F43F5E');
  root.style.setProperty('--theme-bg', isDark ? '#0F172A' : (themeConfig.bg || '#F8FAFC'));
  root.style.setProperty('--theme-card', isDark ? 'rgba(30, 41, 59, 0.95)' : (themeConfig.card || 'rgba(255, 255, 255, 0.94)'));
  root.style.setProperty('--theme-text', activeText);
  root.style.setProperty('--theme-subtext', state.customTextColor || (isDark ? '#CBD5E1' : '#475569'));

  const metaTheme = document.getElementById('metaThemeColor');
  if (metaTheme) metaTheme.setAttribute('content', themeConfig.primary);

  customColorPicker.value = themeConfig.primary;
  customColorHex.textContent = themeConfig.primary.toUpperCase();
  if (customTextColorPicker) {
    customTextColorPicker.value = /^#[0-9a-fA-F]{6}$/.test(activeText) ? activeText : (isDark ? '#F8FAFC' : '#0F172A');
  }
  const textHexEl = document.getElementById('customTextColorHex');
  if (textHexEl) {
    textHexEl.textContent = state.customTextColor ? state.customTextColor.toUpperCase() : '기본';
  }

  document.querySelectorAll('.theme-preset-btn').forEach(btn => {
    const isSelectedBtn = (btn.dataset.theme === 'dark' && isDark) || (!isCustom && btn.dataset.theme === state.currentThemeId);
    if (isSelectedBtn) {
      btn.classList.add('theme-preset-active');
    } else {
      btn.classList.remove('theme-preset-active');
    }
  });
}

function applyUserBgPhoto() {
  if (state.bgPhoto) {
    userBgLayer.style.backgroundImage = `url("${state.bgPhoto}")`;
    userBgLayer.style.display = 'block';
  } else {
    userBgLayer.style.backgroundImage = 'none';
    userBgLayer.style.display = 'none';
  }
  document.documentElement.style.setProperty('--bg-opacity', (parseInt(state.bgOpacity) / 100).toString());
  document.documentElement.style.setProperty('--bg-blur', `${state.bgBlur}px`);
  rangeBgOpacity.value = state.bgOpacity;
  rangeBgBlur.value = state.bgBlur;
}

function selectPresetTheme(themeId) {
  const theme = THEMES[themeId];
  if (!theme) return;
  if (themeId === 'dark') {
    state.isDarkTheme = true;
    state.currentThemeId = 'dark';
    // 검정 테마 선택 시 사용자가 이미 고른 색이 있으면 그 색을 유지
    const primaryToUse = state.customPrimaryColor || theme.primary;
    localStorage.setItem('cal_theme_id', 'dark');
    localStorage.setItem('cal_is_dark', '1');
    localStorage.setItem('cal_custom_color', primaryToUse);
    applyTheme(Object.assign({}, theme, { primary: primaryToUse, isDark: true }), false);
  } else {
    state.isDarkTheme = false;
    state.currentThemeId = themeId;
    state.customPrimaryColor = theme.primary;
    localStorage.setItem('cal_theme_id', themeId);
    localStorage.setItem('cal_is_dark', '0');
    localStorage.setItem('cal_custom_color', theme.primary);
    applyTheme(theme, false);
  }
  renderLegend();
  updateOwnerButtons();
  renderCalendar();
}

function selectCustomColor(hex) {
  state.customPrimaryColor = hex;
  localStorage.setItem('cal_custom_color', hex);
  if (!state.isDarkTheme) {
    state.currentThemeId = 'custom';
    localStorage.setItem('cal_theme_id', 'custom');
  }

  const customTheme = {
    primary: hex,
    secondary: '#F43F5E',
    bg: state.isDarkTheme ? '#0F172A' : '#F8FAFC',
    card: state.isDarkTheme ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.94)',
    text: state.isDarkTheme ? '#F8FAFC' : '#0F172A',
    isDark: state.isDarkTheme
  };
  applyTheme(customTheme, !state.isDarkTheme);
  renderLegend();
  updateOwnerButtons();
  renderCalendar();
}

function selectCustomTextColor(hex) {
  state.customTextColor = hex || '';
  if (state.customTextColor) {
    localStorage.setItem('cal_custom_text_color', state.customTextColor);
  } else {
    localStorage.removeItem('cal_custom_text_color');
  }
  if (state.isDarkTheme || state.currentThemeId === 'custom' || !THEMES[state.currentThemeId]) {
    selectCustomColor(state.customPrimaryColor);
  } else {
    applyTheme(THEMES[state.currentThemeId], false);
  }
}

// ==============================================================================
// 🚀 앱 초기화
// ==============================================================================
let isAppInitialized = false;

function init() {
  if (isAppInitialized) return;
  if (!document.getElementById('calendarDaysGrid')) return;
  isAppInitialized = true;
  if (state.isDarkTheme || state.currentThemeId === 'custom' || !THEMES[state.currentThemeId]) {
    selectCustomColor(state.customPrimaryColor);
  } else {
    applyTheme(THEMES[state.currentThemeId], false);
  }

  applyUserBgPhoto();
  updateHeaderDate();
  updateDDayBadge();
  renderStickerUiEverywhere();
  renderCalendar();
  renderSelectedDateView();
  renderTodos();
  renderAllDiaries();
  setupEventListeners();

  document.getElementById('inputAnniversary').value = state.anniversaryDate;
  document.getElementById('inputHusbandName').value = state.husbandName;
  document.getElementById('inputWifeName').value = state.wifeName;
  renderLegend();
  updateOwnerButtons();
  renderLastBackup();
  const su = document.getElementById('inputSupabaseUrl');
  const sk = document.getElementById('inputSupabaseKey');
  if (su && sk) { su.value = state.supabaseUrl; sk.value = state.supabaseKey; }
  const savedEmail = localStorage.getItem('cal_last_auth_email') || '';
  const authEmailEl = document.getElementById('inputAuthEmail');
  const gateEmailEl = document.getElementById('gateEmailInput');
  if (authEmailEl && savedEmail) authEmailEl.value = savedEmail;
  if (gateEmailEl && savedEmail) gateEmailEl.value = savedEmail;
  renderAuthUiState();
  if (state.supabaseUrl && state.supabaseKey) {
    initSupabase(state.supabaseUrl, state.supabaseKey, false);
  }
}

function updateHeaderDate() {
  const now = new Date();
  const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  currentHeaderDate.textContent = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${days[now.getDay()]}`;
}

function updateDDayBadge() {
  if (!state.anniversaryDate) return;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const parts = String(state.anniversaryDate).split('-').map(Number);
  const target = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(state.anniversaryDate);
  const diffDays = Math.round((today - target) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    ddayBadge.textContent = '오늘 결혼기념일 D-Day!';
  } else if (diffDays > 0) {
    ddayBadge.textContent = `결혼한 지 +${diffDays}일`;
  } else {
    ddayBadge.textContent = `기념일 D${diffDays}`;
  }
}

// ==============================================================================
// 📅 달력 렌더링 (월간 / 주간 접기 지원 -> 스크롤 대폭 감소!)
// ==============================================================================

function renderCalendar() {
  calendarMonthTitle.textContent = `${state.currentYear}년 ${state.currentMonth + 1}월`;
  calendarDaysGrid.innerHTML = '';

  const todayStr = formatDate(new Date());

  if (state.calendarView === 'week') {
    // [주간 뷰]: 선택된 날짜가 속한 주(일~토 7일)만 1줄로 컴팩트하게 표시!
    const selDateObj = new Date(state.selectedDate);
    const dayOfWeek = selDateObj.getDay();
    const sundayDate = new Date(selDateObj);
    sundayDate.setDate(selDateObj.getDate() - dayOfWeek);

    for (let i = 0; i < 7; i++) {
      const d = new Date(sundayDate);
      d.setDate(sundayDate.getDate() + i);
      const dStr = formatDate(d);
      renderDateCell(d.getDate(), dStr, d.getDay(), dStr === todayStr, dStr === state.selectedDate, false);
    }
  } else {
    // [월간 뷰]: 전체 달력 표시
    const firstDayIndex = new Date(state.currentYear, state.currentMonth, 1).getDay();
    const lastDate = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
    const prevLastDate = new Date(state.currentYear, state.currentMonth, 0).getDate();

    // 지난달 날짜
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayEl = document.createElement('div');
      const dayOfWeek = (firstDayIndex - 1 - i) % 7;
      dayEl.className = 'py-1 flex flex-col items-center justify-center text-slate-300 select-none';
      if (dayOfWeek === 0) dayEl.classList.add('text-rose-200');
      else if (dayOfWeek === 6) dayEl.classList.add('text-blue-200');
      dayEl.innerHTML = `<span class="text-xs">${prevLastDate - i}</span><span class="h-2"></span>`;
      calendarDaysGrid.appendChild(dayEl);
    }

    // 이번 달 날짜
    for (let date = 1; date <= lastDate; date++) {
      const dateObj = new Date(state.currentYear, state.currentMonth, date);
      const dateStr = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
      renderDateCell(date, dateStr, dateObj.getDay(), dateStr === todayStr, dateStr === state.selectedDate, true);
    }
  }
  renderUpcoming();
}

function hexWithAlpha(color, alphaHex) {
  return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color + alphaHex : 'rgba(79, 70, 229, 0.15)';
}

function renderDateCell(dateNum, dateStr, dayOfWeek, isToday, isSelected, isCurrentMonth) {
  const holidayName = getHoliday(dateStr);
  const isRedDay = (dayOfWeek === 0 || holidayName !== null);
  const isSaturday = (dayOfWeek === 6);

  const dayEvents = state.events
    .filter(e => eventMatchesDate(e, dateStr) && eventMatchesOwnerFilter(e))
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const dayDiaries = state.diaries.filter(d => d.date === dateStr);

  const cell = document.createElement('div');
  cell.className = 'relative flex flex-col items-stretch cursor-pointer rounded-lg transition px-0.5 pt-1 pb-1 min-h-[70px] overflow-hidden';

  if (isSelected) {
    cell.classList.add('bg-theme-primary', 'shadow-xs');
  } else if (isToday) {
    cell.classList.add('ring-2', 'ring-theme-primary');
    cell.style.backgroundColor = 'rgba(79, 70, 229, 0.06)';
  } else {
    cell.classList.add('hover:bg-slate-100');
  }

  let numClass = 'text-slate-700 font-medium';
  if (isRedDay) numClass = 'text-rose-600 font-bold';
  else if (isSaturday) numClass = 'text-blue-600 font-semibold';
  if (isSelected) numClass = 'text-white font-extrabold';

  const top = document.createElement('div');
  top.className = 'flex items-center justify-center gap-0.5 leading-none h-4';
  const num = document.createElement('span');
  num.className = 'text-xs ' + numClass;
  num.textContent = dateNum;
  top.appendChild(num);
  if (dayDiaries.length > 0) {
    const moodMark = document.createElement('span');
    moodMark.className = 'text-[9px]';
    moodMark.textContent = dayDiaries[0].mood || '📔';
    top.appendChild(moodMark);
  }
  if (state.anniversaryDate && dateStr.slice(5) === state.anniversaryDate.slice(5) && dateStr >= state.anniversaryDate) {
    const ringMark = document.createElement('span');
    ringMark.className = 'text-[9px]';
    ringMark.textContent = '💍';
    top.appendChild(ringMark);
  }
  cell.appendChild(top);

  if (holidayName) {
    const label = document.createElement('span');
    label.className = 'block text-center text-[8.5px] leading-tight truncate font-bold ' + (isSelected ? 'text-rose-100' : 'text-rose-500');
    label.textContent = holidayName;
    cell.appendChild(label);
  }

  const maxChips = holidayName ? 1 : 2;
  const chipWrap = document.createElement('div');
  chipWrap.className = 'mt-0.5 flex flex-col gap-[2px]';
  dayEvents.slice(0, maxChips).forEach(ev => {
    const color = eventColor(ev);
    const chip = document.createElement('span');
    chip.className = 'block truncate text-[10px] leading-[14px] px-1.5 py-[1px] rounded text-left font-bold tracking-tight';
    if (isSelected) {
      chip.style.backgroundColor = 'rgba(255, 255, 255, 0.25)';
      chip.style.color = '#FFFFFF';
    } else {
      chip.style.backgroundColor = hexWithAlpha(color, '26');
      chip.style.color = color;
    }
    chip.textContent = ev.title;
    chipWrap.appendChild(chip);
  });
  if (dayEvents.length > maxChips) {
    const more = document.createElement('span');
    more.className = 'block text-[9px] leading-[12px] text-left px-1 font-semibold ' + (isSelected ? 'text-white/80' : 'text-slate-400');
    more.textContent = '+' + (dayEvents.length - maxChips);
    chipWrap.appendChild(more);
  }
  cell.appendChild(chipWrap);

  // 🐿️ 캐릭터 스티커 테마 자동 렌더링 (수동 도장이 아니라 테마가 주간·일정에 맞춰 자동 장식)
  const stickerSrc = getAutoThemeStickerForDate(dateStr, dateNum, dayOfWeek, dayEvents, dayDiaries);
  if (stickerSrc) {
    const sizePx = state.stickerSize === 'sm' ? '26px' : (state.stickerSize === 'md' ? '34px' : '42px');
    const stickerWrap = document.createElement('div');
    stickerWrap.className = 'mt-auto pt-0.5 flex items-center justify-center pointer-events-none select-none';
    const stickerImg = document.createElement('img');
    stickerImg.src = stickerSrc;
    stickerImg.alt = '';
    stickerImg.style.width = sizePx;
    stickerImg.style.height = sizePx;
    stickerImg.className = 'object-contain drop-shadow-sm transition-transform';
    stickerWrap.appendChild(stickerImg);
    cell.appendChild(stickerWrap);
  }

  cell.addEventListener('click', () => {
    if (Date.now() - state.lastSwipe < 400) return;
    state.selectedDate = dateStr;
    renderCalendar();
    renderSelectedDateView();
    openDaySheet();
  });

  calendarDaysGrid.appendChild(cell);
}

// 선택된 날짜 상세 뷰 (일정 & 일기 탭)
function renderSelectedDateView() {
  const parts = state.selectedDate.split('-');
  const holidayName = getHoliday(state.selectedDate);
  const holidayText = holidayName ? ` (${holidayName})` : '';
  selectedDateTitle.textContent = `${parseInt(parts[1])}월 ${parseInt(parts[2])}일${holidayText}`;

  const dayEvents = state.events.filter(e => eventMatchesDate(e, state.selectedDate) && eventMatchesOwnerFilter(e));
  const dayDiaries = state.diaries.filter(d => d.date === state.selectedDate);

  const sp = state.selectedDate.split('-').map(Number);
  const weekdayName = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'][new Date(sp[0], sp[1] - 1, sp[2]).getDay()];
  selectedDateSubtitle.textContent = weekdayName + (state.selectedDate === formatDate(new Date()) ? ' · 오늘' : '');
  eventCountBadge.textContent = dayEvents.length;
  diaryCountSubBadge.textContent = dayDiaries.length;

  renderSelectedDateEventsList(dayEvents);
  renderSelectedDateDiaryBox(dayDiaries);
}

function renderSelectedDateEventsList(events) {
  events = events.slice().sort(function(a, b) { return (a.time || '').localeCompare(b.time || ''); });
  if (events.length === 0) {
    const mascot = getActiveThemeMascotSrc();
    const iconHtml = mascot
      ? '<img src="' + mascot + '" class="w-11 h-11 mx-auto mb-1 object-contain drop-shadow-xs" alt="">'
      : '<div class="text-2xl mb-1">📭</div>';
    selectedDateEventsList.innerHTML = '<div class="py-3 text-center text-slate-400 text-sm">' + iconHtml + '<p>아직 약속이 없어요.</p><p class="text-xs mt-0.5">위의 <b class="text-theme-primary">📅 약속</b>을 눌러 넣어 보세요.</p></div>';
    return;
  }
  selectedDateEventsList.innerHTML = events.map(function(ev) {
    const color = eventColor(ev);
    return '<div class="flex items-center justify-between p-1 rounded-xl bg-slate-50/80 border border-slate-100">'
      + '<button type="button" class="edit-event-btn flex items-center gap-2.5 min-w-0 flex-1 text-left p-1.5 rounded-lg hover:bg-white transition" onclick="editEvent(\'' + ev.id + '\')">'
      + '<span class="w-1.5 h-9 rounded-full flex-shrink-0" style="background-color:' + color + '"></span>'
      + '<span class="min-w-0"><span class="block text-sm font-bold text-slate-800 truncate">' + escapeHtml(ev.title) + ' <i class="fa-solid fa-pen text-[10px] text-slate-300"></i></span>'
      + '<span class="block text-xs text-slate-500 font-medium">' + timeLabel(ev.time) + ' · <b style="color:' + color + '">' + escapeHtml(ownerLabel(ev.owner)) + '</b>' + escapeHtml(eventMetaBadge(ev)) + '</span></span>'
      + '</button>'
      + '<button class="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 flex-shrink-0" onclick="deleteEvent(\'' + ev.id + '\')" aria-label="지우기"><i class="fa-solid fa-trash-can"></i></button>'
      + '</div>';
  }).join('');
}

function renderSelectedDateDiaryBox(diaries) {
  if (diaries.length === 0) {
    selectedDateDiaryBox.innerHTML = '<div class="text-xs text-slate-400 bg-rose-50/40 border border-rose-100 rounded-xl p-3 min-h-[46px] flex items-center">기록된 일기가 없습니다. 상단 [일기 쓰기]를 눌러 사진과 소중한 하루를 남겨보세요.</div>';
    return;
  }
  selectedDateDiaryBox.innerHTML = diaries.map(d => diaryRowHtml(d, false)).join('');
}

function diaryPreviewText(d) {
  const text = (d.content || '').split('\n').map(s => s.trim()).filter(Boolean).join(' ');
  if (text) return text;
  return (d.media && d.media.length) ? '사진·동영상 기록' : '내용 없음';
}

function diaryThumbHtml(media) {
  if (!media || media.length === 0) return '';
  const firstImage = media.find(m => m.type === 'image');
  const countBadge = media.length > 1 ? '<span class="absolute bottom-0 right-0 bg-black/60 text-white text-[8px] px-1 rounded-tl">' + media.length + '</span>' : '';
  const inner = firstImage
    ? '<img src="' + firstImage.url + '" class="w-full h-full object-cover">'
    : '<span class="w-full h-full bg-slate-800 text-white flex items-center justify-center text-xs"><i class="fa-solid fa-play"></i></span>';
  return '<span class="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-slate-200 flex">' + inner + countBadge + '</span>';
}

function diaryRowHtml(d, showDate) {
  const dateLine = showDate ? '<span class="block text-[10px] font-bold text-slate-400">' + formatDiaryDate(d.date) + '</span>' : '';
  return '<button type="button" class="w-full flex items-center gap-2.5 p-2.5 rounded-xl bg-white/85 border border-slate-200/70 hover:bg-slate-50 text-left transition" onclick="openDiaryDetail(\'' + d.id + '\')">'
    + '<span class="text-lg w-8 h-8 flex items-center justify-center bg-rose-50 rounded-lg flex-shrink-0">' + (d.mood || '🥰') + '</span>'
    + '<span class="flex-1 min-w-0">' + dateLine
    + '<span class="block text-xs font-medium text-slate-800 truncate">' + escapeHtml(diaryPreviewText(d)) + '</span></span>'
    + diaryThumbHtml(d.media)
    + '<i class="fa-solid fa-chevron-right text-[10px] text-slate-300 flex-shrink-0"></i>'
    + '</button>';
}

function formatDiaryDate(dateStr) {
  const parts = dateStr.split('-').map(Number);
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(parts[0], parts[1] - 1, parts[2]).getDay()];
  return parts[1] + '월 ' + parts[2] + '일 (' + dow + ')';
}

// 전체 다이어리 탭 렌더링 (월별 목록 + 검색, 누르면 상세 보기)
function renderAllDiaries() {
  const query = state.diarySearch.trim().toLowerCase();
  const ym = state.diaryFilterYM;
  const monthLabel = document.getElementById('diaryMonthLabel');
  const allToggle = document.getElementById('btnDiaryAllToggle');
  if (ym) {
    const ymParts = ym.split('-');
    monthLabel.textContent = ymParts[0] + '년 ' + parseInt(ymParts[1]) + '월';
    allToggle.textContent = '전체 보기';
  } else {
    monthLabel.textContent = '전체 기간';
    allToggle.textContent = '월별 보기';
  }

  let list = state.diaries.slice().sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
  if (query) list = list.filter(d => (d.content || '').toLowerCase().includes(query));
  else if (ym) list = list.filter(d => d.date.startsWith(ym));

  diaryCountBadge.textContent = list.length + '개 · 전체 ' + state.diaries.length + '개';

  if (list.length === 0) {
    const mascot = getActiveThemeMascotSrc();
    const iconHtml = mascot
      ? '<img src="' + mascot + '" class="w-12 h-12 mx-auto mb-2 object-contain drop-shadow-xs" alt="">'
      : '<i class="fa-regular fa-heart text-2xl mb-2 text-rose-300"></i>';
    allDiaryContainer.innerHTML = '<div class="py-10 text-center text-slate-400 text-xs">' + iconHtml + '<p>' + (query ? '검색 결과가 없습니다.' : '이 기간에 쓴 일기가 없습니다.') + '</p></div>';
    return;
  }

  const groups = [];
  list.forEach(d => {
    const key = d.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key: key, items: [] };
      groups.push(g);
    }
    g.items.push(d);
  });

  allDiaryContainer.innerHTML = groups.map(g => {
    const gp = g.key.split('-');
    return '<div class="text-[11px] font-bold text-slate-500 pt-2 pb-0.5">' + gp[0] + '년 ' + parseInt(gp[1]) + '월 · ' + g.items.length + '개</div>'
      + g.items.map(d => diaryRowHtml(d, true)).join('');
  }).join('');
}

let openedDiaryId = null;

window.openDiaryDetail = function(id) {
  const d = state.diaries.find(x => x.id === id);
  if (!d) return;
  openedDiaryId = id;
  document.getElementById('diaryDetailMood').textContent = d.mood || '🥰';
  document.getElementById('diaryDetailDate').textContent = d.date.slice(0, 4) + '년 ' + formatDiaryDate(d.date);
  document.getElementById('diaryDetailTime').textContent = formatTimeAgo(d.createdAt);
  document.getElementById('diaryDetailContent').textContent = d.content || '';
  document.getElementById('diaryDetailMedia').innerHTML = renderMediaHtml(d.media, 99);
  const modal = document.getElementById('diaryDetailModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

function closeDiaryDetail() {
  const modal = document.getElementById('diaryDetailModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  document.getElementById('diaryDetailMedia').innerHTML = '';
  openedDiaryId = null;
}

function renderMediaHtml(mediaList, maxCount = 4) {
  if (!mediaList || mediaList.length === 0) return '';
  return `
    <div class="grid grid-cols-2 gap-2 pt-1">
      ${mediaList.slice(0, maxCount).map(m => {
        if (m.type === 'video') {
          return `
            <div class="col-span-2 rounded-xl overflow-hidden bg-black/90 aspect-video flex items-center justify-center">
              <video src="${m.url}" controls class="w-full max-h-52 rounded-xl object-contain"></video>
            </div>
          `;
        } else {
          return `
            <div class="rounded-xl overflow-hidden aspect-square bg-slate-100 border border-slate-200/60 relative group">
              <img src="${m.url}" class="w-full h-full object-cover transition duration-200 group-hover:scale-105 cursor-pointer" onclick="openPhotoViewer(this.src)">
            </div>
          `;
        }
      }).join('')}
    </div>
  `;
}

function todoRowHtml(todo) {
  return '<div class="flex items-center justify-between px-2.5 py-2 rounded-xl bg-slate-50/80 border border-slate-100">'
    + '<label class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">'
    + '<input type="checkbox" ' + (todo.isCompleted ? 'checked' : '') + ' class="w-4 h-4 rounded cursor-pointer flex-shrink-0" style="accent-color: var(--theme-primary)" onchange="toggleTodo(\'' + todo.id + '\')">'
    + '<span class="text-sm truncate ' + (todo.isCompleted ? 'line-through text-slate-400' : 'text-slate-700 font-medium') + '">' + escapeHtml(todo.title) + '</span>'
    + '</label>'
    + '<button class="text-slate-300 hover:text-rose-500 p-1 transition flex-shrink-0" onclick="deleteTodo(\'' + todo.id + '\')"><i class="fa-solid fa-xmark text-xs"></i></button>'
    + '</div>';
}

function renderTodos() {
  const active = state.todos.filter(t => !t.isCompleted);
  const done = state.todos.filter(t => t.isCompleted);
  todoStatsBadge.textContent = '남은 일 ' + active.length + '개';

  todosListContainer.innerHTML = active.length
    ? active.map(todoRowHtml).join('')
    : (function() {
        const mascot = getActiveThemeMascotSrc();
        const iconHtml = mascot
          ? '<img src="' + mascot + '" class="w-11 h-11 mx-auto mb-1.5 object-contain drop-shadow-xs" alt="">'
          : '<i class="fa-regular fa-circle-check text-xl mb-1 text-slate-300"></i>';
        return '<div class="py-6 text-center text-slate-400 text-xs">' + iconHtml + '<p>남은 할 일이 없어요.</p></div>';
      })();

  const toggleBtn = document.getElementById('btnToggleCompletedTodos');
  const doneWrap = document.getElementById('completedTodosContainer');
  if (done.length === 0) {
    toggleBtn.classList.add('hidden');
    doneWrap.classList.add('hidden');
    doneWrap.innerHTML = '';
    return;
  }
  toggleBtn.classList.remove('hidden');
  toggleBtn.textContent = '끝낸 일 ' + done.length + '개 ' + (state.showCompletedTodos ? '숨기기 ▲' : '보기 ▼');
  if (state.showCompletedTodos) {
    doneWrap.classList.remove('hidden');
    doneWrap.innerHTML = done.map(todoRowHtml).join('')
      + '<button class="w-full text-[11px] font-semibold text-rose-500 hover:underline pt-1" onclick="clearCompletedTodos()">끝낸 일 모두 지우기</button>';
  } else {
    doneWrap.classList.add('hidden');
    doneWrap.innerHTML = '';
  }
}

window.clearCompletedTodos = function() {
  const before = state.todos.slice();
  const removedList = state.todos.filter(function(t) { return t.isCompleted; });
  state.todos = state.todos.filter(function(t) { return !t.isCompleted; });
  saveTodos();
  removedList.forEach(function(t) { pushRemoteTodo('delete', t); });
  renderTodos();
  showToast('끝낸 일을 모두 지웠어요', function() {
    state.todos = before;
    saveTodos();
    removedList.forEach(function(t) { pushRemoteTodo('insert', t); });
    renderTodos();
  });
};

// ==============================================================================
// ⚡ 이벤트 리스너 등록
// ==============================================================================

function setupEventListeners() {
  // 되돌리기 / 오늘 / 이 날에 추가 / 이름
  document.getElementById('toastUndo').addEventListener('click', function() {
    const fn = toastUndoFn;
    hideToast();
    if (fn) {
      fn();
      showToast('되돌렸어요 👍');
    }
  });

  document.getElementById('btnGoToday').addEventListener('click', function() {
    goToDate(formatDate(new Date()));
  });

  const btnToggleStamp = document.getElementById('btnToggleStickerStampMode');
  if (btnToggleStamp) {
    btnToggleStamp.addEventListener('click', function() {
      state.stickerStampMode = !state.stickerStampMode;
      renderStickerUiEverywhere();
      if (state.stickerStampMode) {
        showToast('스티커 도장 모드 켜짐! 날짜를 눌러 붙여보세요 🐿️');
      }
    });
  }
  const btnCloseStamp = document.getElementById('btnCloseStickerStampBar');
  if (btnCloseStamp) {
    btnCloseStamp.addEventListener('click', function() {
      state.stickerStampMode = false;
      renderStickerUiEverywhere();
    });
  }
  const btnGoStampSettings = document.getElementById('btnGoStickerStampFromSettings');
  if (btnGoStampSettings) {
    btnGoStampSettings.addEventListener('click', function() {
      state.stickerStampMode = true;
      switchTab('tabCalendar');
      renderStickerUiEverywhere();
      showToast('스티커를 고르고 달력 날짜를 눌러 붙여보세요! 🐿️');
    });
  }
  const btnRemoveDaySt = document.getElementById('btnRemoveDaySticker');
  if (btnRemoveDaySt) {
    btnRemoveDaySt.addEventListener('click', function() {
      setDateSticker(state.selectedDate, null);
      showToast('이 날의 스티커를 뗐어요.');
    });
  }
  document.querySelectorAll('.sticker-size-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      state.stickerSize = btn.dataset.size || 'lg';
      localStorage.setItem('cal_sticker_size', state.stickerSize);
      renderStickerUiEverywhere();
      renderCalendar();
    });
  });
  const inputCustomSt = document.getElementById('inputCustomStickerFile');
  if (inputCustomSt) {
    inputCustomSt.addEventListener('change', async function(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const dataUrl = await compressImage(file, 160, 0.88);
        const newSt = {
          id: 'custom_' + Date.now(),
          name: '내 스티커',
          src: dataUrl
        };
        if (!Array.isArray(state.customStickers)) state.customStickers = [];
        state.customStickers.push(newSt);
        saveCustomStickers();
        state.stickerThemeId = 'custom_pack';
        localStorage.setItem('cal_sticker_theme', 'custom_pack');
        renderStickerUiEverywhere();
        renderCalendar();
        showToast('내 사진 캐릭터 테마가 적용되었어요! 🎉');
      } catch (err) {
        showToast('스티커 이미지를 불러오지 못했어요 😥');
      }
    });
  }

  document.getElementById('btnOpenEventSearch').addEventListener('click', function() {
    openUpcomingSheet();
    setTimeout(function() { document.getElementById('eventSearchInput').focus(); }, 60);
  });
  document.getElementById('eventSearchInput').addEventListener('input', function(e) {
    state.eventSearch = e.target.value;
    renderUpcomingSheet();
  });
  document.querySelectorAll('.repeat-preset-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      state.selectedRepeat = btn.dataset.repeat;
      updateRepeatButtons();
    });
  });
  inputItemDate.addEventListener('change', function() {
    const endEl = document.getElementById('inputItemEndDate');
    if (!endEl.value || endEl.value < inputItemDate.value) endEl.value = inputItemDate.value;
  });
  document.getElementById('btnShowAllUpcoming').addEventListener('click', openUpcomingSheet);
  document.getElementById('btnCloseUpcomingSheet').addEventListener('click', closeUpcomingSheet);
  document.getElementById('upcomingSheet').addEventListener('click', function(e) {
    if (e.target.id === 'upcomingSheet') closeUpcomingSheet();
  });
  document.querySelectorAll('.up-filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      state.upcomingFilter = btn.dataset.upFilter;
      renderUpcomingSheet();
    });
  });
  document.getElementById('btnCloseDaySheet').addEventListener('click', closeDaySheet);
  document.getElementById('daySheet').addEventListener('click', function(e) {
    if (e.target.id === 'daySheet') closeDaySheet();
  });
  document.getElementById('btnSheetPrevDay').addEventListener('click', function() { shiftSelectedDay(-1); });
  document.getElementById('btnSheetNextDay').addEventListener('click', function() { shiftSelectedDay(1); });
  document.querySelectorAll('.quick-add-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { openModalWithMode(btn.dataset.quick); });
  });
  document.getElementById('btnDiaryDetailEdit').addEventListener('click', function() {
    if (openedDiaryId) editDiary(openedDiaryId);
  });

  const btnConn = document.getElementById('btnConnectSupabase');
  if (btnConn) {
    btnConn.addEventListener('click', async function() {
      const u = document.getElementById('inputSupabaseUrl').value.trim();
      const k = document.getElementById('inputSupabaseKey').value.trim();
      if (!u || !k) { showToast('URL과 Key를 모두 적어 주세요 ✏️'); return; }
      if (isForbiddenSecretKey(k)) {
        showToast('service_role 비밀키는 사용할 수 없어요. publishable 키를 넣어 주세요 🔒');
        return;
      }
      localStorage.removeItem('cal_supabase_mode');
      state.supabaseUrl = u; state.supabaseKey = k;
      localStorage.setItem('cal_supabase_url', u);
      localStorage.setItem('cal_supabase_key', k);
      await initSupabase(u, k, true);
    });
  }
  const btnDis = document.getElementById('btnDisconnectSupabase');
  if (btnDis) {
    btnDis.addEventListener('click', function() {
      state.supabaseUrl = ''; state.supabaseKey = '';
      localStorage.setItem('cal_supabase_mode', 'offline');
      localStorage.removeItem('cal_supabase_url');
      localStorage.removeItem('cal_supabase_key');
      document.getElementById('inputSupabaseUrl').value = '';
      document.getElementById('inputSupabaseKey').value = '';
      if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
      supabaseClient = null;
      authState = { status: 'offline', user: null, member: null, lastVerifiedSyncAt: null, errorMessage: '' };
      renderAuthUiState();
      showToast('오프라인 보관 모드로 전환했어요');
    });
  }
  const btnCopyLink = document.getElementById('btnCopyCoupleLink');
  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', async function() {
      const shareUrl = window.location.origin + window.location.pathname;
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('키가 포함되지 않은 공개 앱 주소를 복사했어요! 카톡으로 보내주세요 💌');
      } catch (err) {
        showToast('앱 주소: ' + shareUrl);
      }
    });
  }

  const btnHeaderSync = document.getElementById('btnHeaderSyncStatus');
  if (btnHeaderSync) {
    btnHeaderSync.addEventListener('click', function() {
      switchTab('tabSettings');
    });
  }
  const btnGateSignIn = document.getElementById('btnGateSignIn');
  if (btnGateSignIn) {
    btnGateSignIn.addEventListener('click', signInCoupleAccount);
  }
  const btnGatePasswordReset = document.getElementById('btnGatePasswordReset');
  if (btnGatePasswordReset) {
    btnGatePasswordReset.addEventListener('click', sendAccountPasswordReset);
  }
  const btnFinishInvitePassword = document.getElementById('btnFinishInvitePasswordSetup');
  if (btnFinishInvitePassword) {
    btnFinishInvitePassword.addEventListener('click', finishAccountPasswordSetup);
  }
  const invitePasswordConfirm = document.getElementById('gateInvitePasswordConfirmInput');
  if (invitePasswordConfirm) {
    invitePasswordConfirm.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        finishAccountPasswordSetup();
      }
    });
  }
  const accountPasswordField = document.getElementById('gateAccountPasswordInput');
  if (accountPasswordField) {
    accountPasswordField.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        signInCoupleAccount();
      }
    });
  }
  const btnSendMagic = document.getElementById('btnSendMagicLink');
  if (btnSendMagic) {
    btnSendMagic.addEventListener('click', function() {
      const email = document.getElementById('inputAuthEmail').value;
      sendMagicLink(email);
    });
  }
  const btnChangePw = document.getElementById('btnChangeMyPasscode');
  if (btnChangePw) {
    btnChangePw.addEventListener('click', function() {
      const inp = document.getElementById('inputChangeMyPasscode');
      changeMyCouplePasscode(inp ? inp.value : '');
    });
  }
  const btnResetPartnerPw = document.getElementById('btnResetPartnerPasscode');
  if (btnResetPartnerPw) {
    btnResetPartnerPw.addEventListener('click', resetPartnerPasscodeSlot);
  }
  const btnToggleVis = document.getElementById('btnToggleGatePasscodeVis');
  if (btnToggleVis) {
    btnToggleVis.addEventListener('click', function() {
      const inp = document.getElementById('gatePasscodeInput');
      if (!inp) return;
      const isPw = inp.type === 'password';
      inp.type = isPw ? 'text' : 'password';
      btnToggleVis.textContent = isPw ? '숨김' : '보기';
    });
  }
  const btnGateReset = document.getElementById('btnGateResetLocks');
  if (btnGateReset) {
    btnGateReset.addEventListener('click', forceResetAllPasscodeLocksFromGate);
  }
  const gateForm = document.getElementById('gateLoginForm');
  if (gateForm) {
    gateForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const email = document.getElementById('gateEmailInput').value;
      sendMagicLink(email);
    });
  }
  const copySqlHelper = async function(displayName, role) {
    const sql = buildMemberRegistrationSql(displayName, role);
    try {
      await navigator.clipboard.writeText(sql);
      showToast(displayName + ' 님 등록 SQL을 복사했어요! Supabase SQL Editor에서 실행해 주세요 📋');
    } catch (e) {
      showToast(sql);
    }
  };
  ['btnCopyHusbandSql', 'btnGateCopyHusbandSql'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', function() { copySqlHelper(state.husbandName || '강현우', 'husband'); });
  });
  ['btnCopyWifeSql', 'btnGateCopyWifeSql'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', function() { copySqlHelper(state.wifeName || '김시문', 'wife'); });
  });
  ['btnRecheckMembership', 'btnGateRecheck'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', async function() {
        if (supabaseClient && authState.user) {
          await verifyMemberAndSync(authState.user, true);
        } else {
          await initSupabase(state.supabaseUrl, state.supabaseKey, true);
        }
      });
    }
  });
  ['btnSignOutSupabase', 'btnGateSignOut'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', signOutSupabase);
  });
  const btnGateBackup = document.getElementById('btnGateExportBackup');
  if (btnGateBackup) {
    btnGateBackup.addEventListener('click', exportBackup);
  }
  const btnManualSync = document.getElementById('btnManualSyncNow');
  if (btnManualSync) {
    btnManualSync.addEventListener('click', async function() {
      const ok = await pullRemoteSupabaseData();
      if (ok) showToast('최신 공유 기록으로 새로고침했어요! 🔄');
      else await initSupabase(state.supabaseUrl, state.supabaseKey, true);
    });
  }
  const btnPushReminders = document.getElementById('btnTogglePushReminders');
  if (btnPushReminders) {
    btnPushReminders.addEventListener('click', toggleCurrentDevicePushReminders);
  }
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && isAuthorizedCoupleSession()) renderPushReminderSettings();
  });
  const btnRetrySync = document.getElementById('btnRetryPendingSync');
  if (btnRetrySync) {
    btnRetrySync.addEventListener('click', retryPendingSyncQueue);
  }
  const btnOpenSync = document.getElementById('btnOpenInitialSync');
  if (btnOpenSync) {
    btnOpenSync.addEventListener('click', openInitialSyncModal);
  }
  const btnCloseSync = document.getElementById('btnCloseInitialSync');
  if (btnCloseSync) {
    btnCloseSync.addEventListener('click', closeInitialSyncModal);
  }
  const btnSkipSync = document.getElementById('btnSkipInitialSync');
  if (btnSkipSync) {
    btnSkipSync.addEventListener('click', function() {
      closeInitialSyncModal();
      showToast('로컬 기록을 그대로 두었어요. 언제든 [꾸미기]에서 합칠 수 있어요.');
    });
  }
  const btnConfirmSync = document.getElementById('btnConfirmInitialSync');
  if (btnConfirmSync) {
    btnConfirmSync.addEventListener('click', confirmInitialSyncSelection);
  }
  const chkSeeds = document.getElementById('chkSyncIncludeSeeds');
  if (chkSeeds) {
    chkSeeds.addEventListener('change', renderInitialSyncModalList);
  }
  const btnToggleAllSync = document.getElementById('btnSyncToggleAll');
  if (btnToggleAllSync) {
    btnToggleAllSync.addEventListener('click', function() {
      const boxes = Array.from(document.querySelectorAll('.initial-sync-chk'));
      const allChecked = boxes.length > 0 && boxes.every(b => b.checked);
      boxes.forEach(b => { b.checked = !allChecked; });
    });
  }
  document.getElementById('btnExportBackup').addEventListener('click', exportBackup);
  document.getElementById('inputImportBackup').addEventListener('change', function(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file);
  });
  document.getElementById('btnSaveNames').addEventListener('click', function() {
    const h = document.getElementById('inputHusbandName').value.trim() || '남편';
    const w = document.getElementById('inputWifeName').value.trim() || '아내';
    state.husbandName = h;
    state.wifeName = w;
    localStorage.setItem('cal_name_husband', h);
    localStorage.setItem('cal_name_wife', w);
    renderLegend();
    updateOwnerButtons();
    renderSelectedDateView();
    showToast('이름을 저장했어요! 💑');
  });
  // 할 일 빠른 추가 (Enter로 연속 입력)
  document.getElementById('todoQuickAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('todoQuickInput');
    const title = input.value.trim();
    if (!title) return;
    const newTodo = { id: Date.now().toString(), title: title, isCompleted: false, dueDate: formatDate(new Date()) };
    state.todos.push(newTodo);
    saveTodos();
    pushRemoteTodo('insert', newTodo);
    renderTodos();
    input.value = '';
    input.focus();
  });

  document.getElementById('btnToggleCompletedTodos').addEventListener('click', () => {
    state.showCompletedTodos = !state.showCompletedTodos;
    renderTodos();
  });

  // 다이어리 검색 & 월 이동
  document.getElementById('diarySearchInput').addEventListener('input', (e) => {
    state.diarySearch = e.target.value;
    renderAllDiaries();
  });

  const shiftDiaryMonth = (delta) => {
    const base = state.diaryFilterYM || formatDate(new Date()).slice(0, 7);
    const bp = base.split('-').map(Number);
    const d = new Date(bp[0], bp[1] - 1 + delta, 1);
    state.diaryFilterYM = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    renderAllDiaries();
  };
  document.getElementById('btnDiaryPrevMonth').addEventListener('click', () => shiftDiaryMonth(-1));
  document.getElementById('btnDiaryNextMonth').addEventListener('click', () => shiftDiaryMonth(1));
  document.getElementById('btnDiaryAllToggle').addEventListener('click', () => {
    state.diaryFilterYM = state.diaryFilterYM ? null : formatDate(new Date()).slice(0, 7);
    renderAllDiaries();
  });

  // 일기 상세 보기 닫기 / 삭제
  document.getElementById('btnDiaryDetailClose').addEventListener('click', closeDiaryDetail);
  document.getElementById('diaryDetailModal').addEventListener('click', (e) => {
    if (e.target.id === 'diaryDetailModal') closeDiaryDetail();
  });
  document.getElementById('btnDiaryDetailDelete').addEventListener('click', () => {
    if (!openedDiaryId) return;
    const id = openedDiaryId;
    closeDiaryDetail();
    deleteDiary(id);
  });
  // 달력 앞뒤로 넘기기 (이번 주만 볼 때는 한 주씩)
  const moveCalendar = function(delta) {
    if (state.calendarView === 'week') {
      const p = state.selectedDate.split('-').map(Number);
      const d = new Date(p[0], p[1] - 1, p[2] + delta * 7);
      state.selectedDate = formatDate(d);
      state.currentYear = d.getFullYear();
      state.currentMonth = d.getMonth();
      renderSelectedDateView();
    } else {
      const d = new Date(state.currentYear, state.currentMonth + delta, 1);
      state.currentYear = d.getFullYear();
      state.currentMonth = d.getMonth();
    }
    renderCalendar();
  };
  document.getElementById('btnPrevMonth').addEventListener('click', function() { moveCalendar(-1); });
  document.getElementById('btnNextMonth').addEventListener('click', function() { moveCalendar(1); });
  // 달력을 옆으로 밀어서 달 바꾸기
  let touchX = 0;
  let touchY = 0;
  calendarDaysGrid.addEventListener('touchstart', function(e) {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  calendarDaysGrid.addEventListener('touchend', function(e) {
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      state.lastSwipe = Date.now();
      moveCalendar(dx < 0 ? 1 : -1);
    }
  });

  // 이번 주만 보기 / 한 달 다 보기
  btnToggleCalendarView.addEventListener('click', function() {
    if (state.calendarView === 'month') {
      state.calendarView = 'week';
      const p = state.selectedDate.split('-').map(Number);
      state.currentYear = p[0];
      state.currentMonth = p[1] - 1;
      toggleViewIcon.className = 'fa-solid fa-expand text-[10px]';
      toggleViewText.textContent = '한 달 보기';
    } else {
      state.calendarView = 'month';
      toggleViewIcon.className = 'fa-solid fa-compress text-[10px]';
      toggleViewText.textContent = '이번 주만';
    }
    renderCalendar();
  });


  inputBgPhoto.addEventListener('change', async function(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    state.bgPhoto = await compressImage(file, 1600, 0.8);
    applyUserBgPhoto();
    try {
      localStorage.setItem('cal_bg_photo', state.bgPhoto);
      showToast('배경 사진을 바꿨어요! 🖼️');
    } catch (err) {
      showToast('사진이 너무 커서 저장하지 못했어요 😥');
    }
  });

  btnRemoveBgPhoto.addEventListener('click', () => {
    state.bgPhoto = null;
    localStorage.removeItem('cal_bg_photo');
    applyUserBgPhoto();
    showToast('원래 배경으로 돌아왔어요');
  });

  rangeBgOpacity.addEventListener('input', (e) => {
    state.bgOpacity = e.target.value;
    localStorage.setItem('cal_bg_opacity', state.bgOpacity);
    document.documentElement.style.setProperty('--bg-opacity', (parseInt(state.bgOpacity) / 100).toString());
  });

  rangeBgBlur.addEventListener('input', (e) => {
    state.bgBlur = e.target.value;
    localStorage.setItem('cal_bg_blur', state.bgBlur);
    document.documentElement.style.setProperty('--bg-blur', `${state.bgBlur}px`);
  });

  document.getElementById('btnQuickTheme').addEventListener('click', () => {
    switchTab('tabSettings');
  });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.target);
    });
  });

  document.getElementById('btnOpenDayDiary').addEventListener('click', () => {
    openModalWithMode('diary');
  });

  document.querySelectorAll('.theme-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectPresetTheme(btn.dataset.theme);
    });
  });

  customColorPicker.addEventListener('input', (e) => {
    selectCustomColor(e.target.value);
  });
  if (customTextColorPicker) {
    customTextColorPicker.addEventListener('input', (e) => {
      selectCustomTextColor(e.target.value);
    });
  }
  if (btnResetTextColor) {
    btnResetTextColor.addEventListener('click', () => {
      selectCustomTextColor('');
      showToast('기본 글자 색으로 되돌렸어요 🎨');
    });
  }
  document.querySelectorAll('.quick-accent-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectCustomColor(btn.dataset.color);
    });
  });
  document.querySelectorAll('.quick-text-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectCustomTextColor(btn.dataset.textColor);
    });
  });

  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('ring-2', 'ring-indigo-500'));
      btn.classList.add('ring-2', 'ring-indigo-500');
      state.selectedMood = btn.dataset.mood;
    });
  });

  inputMediaFiles.addEventListener('change', async function(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    mediaCountText.textContent = '사진 준비 중...';
    let skipped = 0;
    for (const file of files) {
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      if (file.type.startsWith('video')) {
        if (file.size > 3 * 1024 * 1024) { skipped++; continue; }
        state.tempMediaFiles.push({ id: id, type: 'video', name: file.name, url: await readFileAsDataURL(file) });
      } else {
        state.tempMediaFiles.push({ id: id, type: 'image', name: file.name, url: await compressImage(file, 1280, 0.82) });
      }
    }
    renderMediaPreviews();
    if (skipped) showToast('동영상은 3MB 이하만 넣을 수 있어요 (' + skipped + '개 뺐어요)');
  });

  btnOpenAddModal.addEventListener('click', openChooser);
  document.getElementById('btnCloseChooser').addEventListener('click', closeChooser);
  document.getElementById('chooserModal').addEventListener('click', function(e) {
    if (e.target.id === 'chooserModal') closeChooser();
  });
  document.querySelectorAll('.choose-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      closeChooser();
      openModalWithMode(btn.dataset.choose);
    });
  });

  btnCloseAddModal.addEventListener('click', closeAddModal);
  document.getElementById('btnBackToChooser').addEventListener('click', function() {
    closeAddModal();
    openChooser();
  });

  document.querySelectorAll('.owner-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      state.selectedOwner = btn.dataset.owner;
      updateOwnerButtons();
    });
  });

  document.querySelectorAll('.time-preset-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      state.selectedTime = btn.dataset.time;
      updateTimeButtons();
    });
  });

  btnSubmitItem.addEventListener('click', function() {
    const textVal = inputItemTitle.value.trim();
    const mode = state.modalType;
    if (!textVal && (mode !== 'diary' || state.tempMediaFiles.length === 0)) {
      inputItemTitle.focus();
      showToast('내용을 먼저 적어 주세요 ✏️');
      return;
    }
    const dateVal = inputItemDate.value || state.selectedDate;
    const editing = state.editingId;

    if (mode === 'event') {
      let timeVal = state.selectedTime;
      if (timeVal === 'allday') timeVal = '';
      else if (timeVal === 'custom') timeVal = inputItemTime.value || '';
      const rawEnd = document.getElementById('inputItemEndDate').value || dateVal;
      const endDateVal = rawEnd >= dateVal ? rawEnd : dateVal;
      const data = { title: textVal, date: dateVal, endDate: endDateVal, time: timeVal, owner: state.selectedOwner, repeat: state.selectedRepeat || 'none', color: OWNER_COLORS[state.selectedOwner] };
      const existing = editing ? state.events.find(function(e) { return e.id === editing; }) : null;
      if (existing) Object.assign(existing, data);
      else state.events.push(Object.assign({ id: Date.now().toString() }, data));
      saveEvents();
      pushRemoteEvent(existing ? 'update' : 'insert', existing || state.events[state.events.length - 1]);
      closeAddModal();
      switchTab('tabCalendar');
      goToDate(dateVal);
      openDaySheet();
      showToast(existing ? '약속을 고쳤어요! ✏️' : '약속을 저장했어요! 🎉');
    } else if (mode === 'todo') {
      state.todos.push({ id: Date.now().toString(), title: textVal, isCompleted: false, dueDate: dateVal });
      saveTodos();
      pushRemoteTodo('insert', state.todos[state.todos.length - 1]);
      closeAddModal();
      closeDaySheet();
      renderTodos();
      switchTab('tabTodos');
      showToast('할 일을 넣었어요! ✅');
    } else {
      const prevDiaries = state.diaries.map(function(x) { return Object.assign({}, x); });
      const data = { date: dateVal, mood: state.selectedMood, content: textVal, media: state.tempMediaFiles.slice() };
      const existing = editing ? state.diaries.find(function(d) { return d.id === editing; }) : null;
      if (existing) Object.assign(existing, data);
      else state.diaries.push(Object.assign({ id: Date.now().toString(), createdAt: new Date().toISOString() }, data));
      if (!saveDiaries()) {
        state.diaries = prevDiaries;
        return;
      }
      pushRemoteDiary(existing ? 'update' : 'insert', existing || state.diaries[state.diaries.length - 1]);
      closeAddModal();
      renderAllDiaries();
      switchTab('tabCalendar');
      goToDate(dateVal);
      openDaySheet();
      showToast(existing ? '일기를 고쳤어요! ✏️' : '일기를 저장했어요! 📖');
    }
  });

  document.getElementById('btnSaveAnniversary').addEventListener('click', () => {
    const anniv = document.getElementById('inputAnniversary').value;
    if (anniv) {
      state.anniversaryDate = anniv;
      localStorage.setItem('cal_anniversary', anniv);
      updateDDayBadge();
      showToast('기념일을 저장했어요! 💍');
    }
  });
}

function renderMediaPreviews() {
  mediaPreviewGrid.innerHTML = '';
  mediaCountText.textContent = state.tempMediaFiles.length ? state.tempMediaFiles.length + '개 골랐어요' : '아직 없어요';

  state.tempMediaFiles.forEach((m, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'w-14 h-14 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0 relative border border-slate-200';
    if (m.type === 'video') {
      wrap.innerHTML = `
        <div class="w-full h-full bg-slate-800 flex items-center justify-center text-white text-xs">
          <i class="fa-solid fa-video"></i>
        </div>
      `;
    } else {
      wrap.innerHTML = `<img src="${m.url}" class="w-full h-full object-cover">`;
    }
    const delBtn = document.createElement('button');
    delBtn.className = 'absolute top-0 right-0 bg-black/60 text-white w-4 h-4 rounded-bl flex items-center justify-center text-[10px]';
    delBtn.innerHTML = '×';
    delBtn.onclick = () => {
      state.tempMediaFiles.splice(idx, 1);
      renderMediaPreviews();
    };
    wrap.appendChild(delBtn);
    mediaPreviewGrid.appendChild(wrap);
  });
}

function switchTab(targetId) {
  tabBtns.forEach(b => {
    if (b.dataset.target === targetId) {
      b.classList.remove('text-slate-400');
      b.classList.add('text-theme-primary');
    } else {
      b.classList.remove('text-theme-primary');
      b.classList.add('text-slate-400');
    }
  });

  Object.values(tabs).forEach(t => t.classList.add('hidden'));
  tabs[targetId].classList.remove('hidden');
  btnOpenAddModal.classList.toggle('hidden', targetId === 'tabSettings');
}

function openModalWithMode(mode) {
  state.editingId = null;
  inputItemDate.value = state.selectedDate;
  document.getElementById('inputItemEndDate').value = state.selectedDate;
  state.selectedRepeat = 'none';
  updateRepeatButtons();
  inputItemTitle.value = '';
  state.tempMediaFiles = [];
  state.selectedOwner = 'both';
  state.selectedTime = '19:00';
  inputItemTime.value = '19:00';
  renderMediaPreviews();
  setModalMode(mode);
  updateOwnerButtons();
  updateTimeButtons();
  btnSubmitItem.textContent = '저장하기';
  document.getElementById('btnBackToChooser').classList.remove('hidden');
  addModal.classList.remove('hidden');
  addModal.classList.add('flex');
  setTimeout(function() { inputItemTitle.focus(); }, 50);
}

function setModalMode(mode) {
  state.modalType = mode;
  const conf = {
    event: { title: '📅 약속 넣기', label: '무슨 약속이에요?', ph: '예: 저녁 외식, 영화 보기' },
    todo: { title: '✅ 할 일 넣기', label: '해야 할 일이 뭐예요?', ph: '예: 우유 사기, 분리수거' },
    diary: { title: '📖 일기 쓰기', label: '오늘 어떤 일이 있었나요?', ph: '자유롭게 적어 보세요. 사진도 넣을 수 있어요.' }
  }[mode];
  document.getElementById('addModalTitle').textContent = conf.title;
  inputItemLabel.textContent = conf.label;
  inputItemTitle.placeholder = conf.ph;
  inputItemTitle.rows = mode === 'diary' ? 4 : 2;
  document.getElementById('ownerSelectorWrap').classList.toggle('hidden', mode !== 'event');
  document.getElementById('dateFieldWrap').classList.toggle('hidden', mode === 'todo');
  document.getElementById('endDateWrap').classList.toggle('hidden', mode !== 'event');
  document.getElementById('repeatFieldWrap').classList.toggle('hidden', mode !== 'event');
  timeFieldWrap.classList.toggle('hidden', mode !== 'event');
  moodSelectorWrap.classList.toggle('hidden', mode !== 'diary');
  mediaUploadWrap.classList.toggle('hidden', mode !== 'diary');
}

window.deleteEvent = function(id) {
  const idx = state.events.findIndex(function(e) { return e.id === id; });
  if (idx < 0) return;
  const removed = state.events.splice(idx, 1)[0];
  saveEvents();
  pushRemoteEvent('delete', removed);
  renderCalendar();
  renderSelectedDateView();
  showToast('약속을 지웠어요', function() {
    restoreAt(state.events, idx, removed);
    saveEvents();
    pushRemoteEvent('insert', removed);
    renderCalendar();
    renderSelectedDateView();
  });
};

window.toggleTodo = function(id) {
  const todo = state.todos.find(function(t) { return t.id === id; });
  if (!todo) return;
  todo.isCompleted = !todo.isCompleted;
  saveTodos();
  pushRemoteTodo('update', todo);
  renderTodos();
  if (todo.isCompleted) showToast('잘했어요! ✅');
};

window.deleteTodo = function(id) {
  const idx = state.todos.findIndex(function(t) { return t.id === id; });
  if (idx < 0) return;
  const removed = state.todos.splice(idx, 1)[0];
  saveTodos();
  pushRemoteTodo('delete', removed);
  renderTodos();
  showToast('할 일을 지웠어요', function() {
    restoreAt(state.todos, idx, removed);
    saveTodos();
    pushRemoteTodo('insert', removed);
    renderTodos();
  });
};

window.deleteDiary = function(id) {
  const idx = state.diaries.findIndex(function(d) { return d.id === id; });
  if (idx < 0) return;
  const removed = state.diaries.splice(idx, 1)[0];
  saveDiaries();
  pushRemoteDiary('delete', removed);
  renderCalendar();
  renderSelectedDateView();
  renderAllDiaries();
  showToast('일기를 지웠어요', function() {
    restoreAt(state.diaries, idx, removed);
    saveDiaries();
    pushRemoteDiary('insert', removed);
    renderCalendar();
    renderSelectedDateView();
    renderAllDiaries();
  });
};

function saveEvents() {
  localStorage.setItem('cal_events', JSON.stringify(state.events));
}

function saveTodos() {
  localStorage.setItem('cal_todos', JSON.stringify(state.todos));
}

function saveDiaries() {
  try {
    localStorage.setItem('cal_diaries', JSON.stringify(state.diaries));
    return true;
  } catch (err) {
    showToast('저장 공간이 꽉 찼어요. 사진이나 동영상을 몇 개 빼고 다시 저장해 주세요 😥');
    return false;
  }
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTimeAgo(isoStr) {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return '방금 전';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

init();
document.addEventListener('DOMContentLoaded', init);

