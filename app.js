// ë¶€ë¶€ ì „ìš© ì›í´ë¦­ ì—°ê²° íŒŒë¼ë¯¸í„° ì²˜ë¦¬ (ìµœì´ˆ 1íšŒ ë§í¬ ì ‘ì† ì‹œ í°ì— ì˜êµ¬ ì €ìž¥ í›„ ì£¼ì†Œì°½ì—ì„œ ìˆ¨ê¹€)
(function bootstrapCoupleSecretFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const u = params.get('sb_url');
    const k = params.get('sb_key');
    if (u && k) {
      localStorage.setItem('cal_supabase_url', u.trim());
      localStorage.setItem('cal_supabase_key', k.trim());
      const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  } catch (e) {}
})();

// ==============================================================================
// ðŸŒ Supabase ë¶€ë¶€ ê¸°ê¸° ì‹¤ì‹œê°„ ë™ê¸°í™” ëª¨ë“ˆ
// ==============================================================================
let supabaseClient = null;
let realtimeChannel = null;
let isRemoteUpdating = false;

function updateSupabaseBadge(status, text, colorClass) {
  const badge = document.getElementById('supabaseStatusBadge');
  if (!badge) return;
  badge.className = 'text-xs px-2.5 py-1 rounded-full font-bold ' + colorClass;
  badge.textContent = text;
}

async function initSupabase(url, key, isManual = false) {
  if (!url || !key || !window.supabase) {
    updateSupabaseBadge('offline', 'âšª ë¡œì»¬ ì €ìž¥ ëª¨ë“œ', 'bg-slate-100 text-slate-500');
    return false;
  }
  try {
    supabaseClient = window.supabase.createClient(url, key);
    updateSupabaseBadge('online', 'ðŸŸ¢ ì‹¤ì‹œê°„ ì—°ê²°ë¨', 'bg-emerald-50 text-emerald-600 border border-emerald-200');
    
    // ì›ê²© ë°ì´í„° ì´ˆê¸° ê°€ì ¸ì˜¤ê¸° ë° ì‹¤ì‹œê°„ ì±„ë„ êµ¬ë…
    await pullRemoteSupabaseData();
    setupSupabaseRealtime();
    
    if (isManual) showToast('ë¶€ë¶€ í° ì‹¤ì‹œê°„ ì—°ê²° ì„±ê³µ! ðŸ’‘');
    return true;
  } catch (err) {
    console.error('Supabase init error:', err);
    updateSupabaseBadge('error', 'ðŸ”´ ì—°ê²° ì‹¤íŒ¨', 'bg-rose-50 text-rose-600 border border-rose-200');
    if (isManual) showToast('ì—°ê²° ì‹¤íŒ¨: URL ë˜ëŠ” Keyë¥¼ í™•ì¸í•´ ì£¼ì„¸ìš” ðŸ˜¥');
    return false;
  }
}

async function pullRemoteSupabaseData() {
  if (!supabaseClient) return;
  try {
    const { data: remoteEvents, error: errEv } = await supabaseClient.from('events').select('*');
    if (!errEv && remoteEvents && remoteEvents.length > 0) {
      isRemoteUpdating = true;
      const localMap = new Map(state.events.map(e => [e.id, e]));
      remoteEvents.forEach(re => {
        localMap.set(re.id, parseRemoteEvent(re));
      });
      state.events = Array.from(localMap.values());
      saveEvents();
      isRemoteUpdating = false;
    }

    const { data: remoteTodos, error: errTd } = await supabaseClient.from('todos').select('*');
    if (!errTd && remoteTodos && remoteTodos.length > 0) {
      isRemoteUpdating = true;
      const localMap = new Map(state.todos.map(t => [t.id, t]));
      remoteTodos.forEach(rt => {
        localMap.set(rt.id, {
          id: rt.id,
          title: rt.title,
          isCompleted: rt.is_completed ?? rt.isCompleted ?? false,
          dueDate: rt.due_date || rt.dueDate || ''
        });
      });
      state.todos = Array.from(localMap.values());
      saveTodos();
      isRemoteUpdating = false;
    }

    const { data: remoteDiaries, error: errDi } = await supabaseClient.from('diaries').select('*');
    if (!errDi && remoteDiaries && remoteDiaries.length > 0) {
      isRemoteUpdating = true;
      const localMap = new Map(state.diaries.map(d => [d.id, d]));
      remoteDiaries.forEach(rd => {
        localMap.set(rd.id, {
          id: rd.id,
          date: rd.date,
          mood: rd.mood || 'ðŸ¥°',
          content: rd.content || '',
          media: rd.media || [],
          createdAt: rd.created_at || rd.createdAt || new Date().toISOString()
        });
      });
      state.diaries = Array.from(localMap.values());
      saveDiaries();
      isRemoteUpdating = false;
    }

    renderCalendar();
    renderSelectedDateView();
    renderTodos();
    renderAllDiaries();
  } catch (e) {
    console.warn('pullRemoteSupabaseData error:', e);
  }
}

function setupSupabaseRealtime() {
  if (!supabaseClient) return;
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
  }

  realtimeChannel = supabaseClient.channel('couple_sync_channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, payload => {
      if (isRemoteUpdating) return;
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const mapped = parseRemoteEvent(payload.new);
        const idx = state.events.findIndex(e => e.id === mapped.id);
        if (idx >= 0) state.events[idx] = mapped;
        else state.events.push(mapped);
      } else if (payload.eventType === 'DELETE') {
        state.events = state.events.filter(e => e.id !== payload.old.id);
      }
      saveEvents();
      renderCalendar();
      renderSelectedDateView();
      showToast('ìƒëŒ€ë°©ì´ ì•½ì†ì„ ë³€ê²½í–ˆì–´ìš”! ðŸ”„');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, payload => {
      if (isRemoteUpdating) return;
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const item = payload.new;
        const mapped = {
          id: item.id,
          title: item.title,
          isCompleted: item.is_completed ?? item.isCompleted ?? false,
          dueDate: item.due_date || item.dueDate || ''
        };
        const idx = state.todos.findIndex(t => t.id === mapped.id);
        if (idx >= 0) state.todos[idx] = mapped;
        else state.todos.push(mapped);
      } else if (payload.eventType === 'DELETE') {
        state.todos = state.todos.filter(t => t.id !== payload.old.id);
      }
      saveTodos();
      renderTodos();
      showToast('ìƒëŒ€ë°©ì´ í•  ì¼ì„ ë³€ê²½í–ˆì–´ìš”! ðŸ”„');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'diaries' }, payload => {
      if (isRemoteUpdating) return;
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const item = payload.new;
        const mapped = {
          id: item.id,
          date: item.date,
          mood: item.mood || 'ðŸ¥°',
          content: item.content || '',
          media: item.media || [],
          createdAt: item.created_at || item.createdAt || new Date().toISOString()
        };
        const idx = state.diaries.findIndex(d => d.id === mapped.id);
        if (idx >= 0) state.diaries[idx] = mapped;
        else state.diaries.push(mapped);
      } else if (payload.eventType === 'DELETE') {
        state.diaries = state.diaries.filter(d => d.id !== payload.old.id);
      }
      saveDiaries();
      renderCalendar();
      renderSelectedDateView();
      renderAllDiaries();
      showToast('ìƒëŒ€ë°©ì´ ì¼ê¸°ë¥¼ ë“±ë¡í–ˆì–´ìš”! ðŸ“–');
    })
    .subscribe();
}

async function pushRemoteEvent(action, item) {
  if (!supabaseClient || isRemoteUpdating) return;
  try {
    if (action === 'delete') {
      await supabaseClient.from('events').delete().eq('id', item.id);
    } else {
      const payload = {
        id: item.id,
        title: item.title,
        date: item.date,
        time: item.time || '',
        owner: (item.owner || 'both') + (item.repeat && item.repeat !== 'none' ? '|' + item.repeat : ''),
        color: item.color,
        start_time: item.date + (item.time ? 'T' + item.time + ':00' : 'T00:00:00'),
        end_time: (item.endDate && item.endDate >= item.date ? item.endDate : item.date) + 'T23:59:59'
      };
      await supabaseClient.from('events').upsert(payload);
    }
  } catch (e) {
    console.warn('pushRemoteEvent failed:', e);
  }
}

async function pushRemoteTodo(action, item) {
  if (!supabaseClient || isRemoteUpdating) return;
  try {
    if (action === 'delete') {
      await supabaseClient.from('todos').delete().eq('id', item.id);
    } else {
      const payload = {
        id: item.id,
        title: item.title,
        is_completed: item.isCompleted,
        due_date: item.dueDate || null
      };
      await supabaseClient.from('todos').upsert(payload);
    }
  } catch (e) {
    console.warn('pushRemoteTodo failed:', e);
  }
}

async function pushRemoteDiary(action, item) {
  if (!supabaseClient || isRemoteUpdating) return;
  try {
    if (action === 'delete') {
      await supabaseClient.from('diaries').delete().eq('id', item.id);
    } else {
      const payload = {
        id: item.id,
        date: item.date,
        mood: item.mood,
        content: item.content,
        media: item.media || [],
        created_at: item.createdAt
      };
      await supabaseClient.from('diaries').upsert(payload);
    }
  } catch (e) {
    console.warn('pushRemoteDiary failed:', e);
  }
}


// ==============================================================================
// ðŸ“… ìš°ë¦¬ì˜ ìº˜ë¦°ë” - ì£¼ê°„/ì›”ê°„ ì ‘ê¸°, ì„¸ê·¸ë¨¼íŠ¸ íƒ­, ë”ë³´ê¸° ê¸°ëŠ¥ í†µí•© ìŠ¤í¬ë¦½íŠ¸
// ==============================================================================

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// 1. ëŒ€í•œë¯¼êµ­ ë²•ì • ê³µíœ´ì¼ ë°ì´í„°
const FIXED_HOLIDAYS = {
  '01-01': 'ì‹ ì •',
  '03-01': 'ì‚¼ì¼ì ˆ',
  '05-05': 'ì–´ë¦°ì´ë‚ ',
  '06-06': 'í˜„ì¶©ì¼',
  '08-15': 'ê´‘ë³µì ˆ',
  '10-03': 'ê°œì²œì ˆ',
  '10-09': 'í•œê¸€ë‚ ',
  '12-25': 'ì„±íƒ„ì ˆ'
};

const SPECIAL_HOLIDAYS = {
  '2024-02-09': 'ì„¤ì—°íœ´', '2024-02-10': 'ì„¤ë‚ ', '2024-02-11': 'ì„¤ì—°íœ´', '2024-02-12': 'ëŒ€ì²´ê³µíœ´ì¼',
  '2024-04-10': 'ì´ì„ ', '2024-05-06': 'ëŒ€ì²´ê³µíœ´ì¼', '2024-05-15': 'ì„ê°€íƒ„ì‹ ì¼',
  '2024-09-16': 'ì¶”ì„ì—°íœ´', '2024-09-17': 'ì¶”ì„', '2024-09-18': 'ì¶”ì„ì—°íœ´',
  '2025-01-28': 'ì„¤ì—°íœ´', '2025-01-29': 'ì„¤ë‚ ', '2025-01-30': 'ì„¤ì—°íœ´',
  '2025-03-03': 'ëŒ€ì²´ê³µíœ´ì¼', '2025-05-06': 'ì„ê°€íƒ„ì‹ ì¼',
  '2025-10-05': 'ì¶”ì„ì—°íœ´', '2025-10-06': 'ì¶”ì„', '2025-10-07': 'ì¶”ì„ì—°íœ´', '2025-10-08': 'ëŒ€ì²´ê³µíœ´ì¼',
  '2026-02-16': 'ì„¤ì—°íœ´', '2026-02-17': 'ì„¤ë‚ ', '2026-02-18': 'ì„¤ì—°íœ´',
  '2026-03-02': 'ëŒ€ì²´ê³µíœ´ì¼',
  '2026-05-24': 'ì„ê°€íƒ„ì‹ ì¼', '2026-05-25': 'ëŒ€ì²´ê³µíœ´ì¼',
  '2026-08-17': 'ëŒ€ì²´ê³µíœ´ì¼',
  '2026-09-24': 'ì¶”ì„ì—°íœ´', '2026-09-25': 'ì¶”ì„', '2026-09-26': 'ì¶”ì„ì—°íœ´',
  '2026-10-05': 'ëŒ€ì²´ê³µíœ´ì¼',
  '2027-02-06': 'ì„¤ì—°íœ´', '2027-02-07': 'ì„¤ë‚ ', '2027-02-08': 'ì„¤ì—°íœ´', '2027-02-09': 'ëŒ€ì²´ê³µíœ´ì¼',
  '2027-05-13': 'ì„ê°€íƒ„ì‹ ì¼',
  '2027-09-14': 'ì¶”ì„ì—°íœ´', '2027-09-15': 'ì¶”ì„', '2027-09-16': 'ì¶”ì„ì—°íœ´'
};

function getHoliday(dateStr) {
  if (SPECIAL_HOLIDAYS[dateStr]) return SPECIAL_HOLIDAYS[dateStr];
  const mmdd = dateStr.substring(5);
  if (FIXED_HOLIDAYS[mmdd]) return FIXED_HOLIDAYS[mmdd];
  return null;
}

// 2. í…Œë§ˆ í”„ë¦¬ì…‹
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
  if (ev.repeat === 'monthly') badges.push('ðŸ” ë§¤ë‹¬');
  else if (ev.repeat === 'yearly') badges.push('ðŸŽ‚ ë§¤ë…„');
  if (ev.endDate && ev.endDate > ev.date) {
    const s = ev.date.split('-').map(Number);
    const e = ev.endDate.split('-').map(Number);
    badges.push(s[1] + '/' + s[2] + '~' + e[1] + '/' + e[2]);
  }
  return badges.length ? ' Â· ' + badges.join(' Â· ') : '';
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

// ëˆ„êµ¬ ì•½ì†ì¸ì§€ ìƒ‰ê¹”
const OWNER_COLORS = { husband: '#3B82F6', wife: '#EC4899', both: '#8B5CF6' };

function ownerLabel(owner) {
  if (owner === 'husband') return state.husbandName;
  if (owner === 'wife') return state.wifeName;
  return 'ìš°ë¦¬ ë‘˜';
}

function eventColor(ev) {
  if (ev.owner && OWNER_COLORS[ev.owner]) return OWNER_COLORS[ev.owner];
  return ev.color || state.customPrimaryColor;
}

function timeLabel(t) {
  if (!t) return 'í•˜ë£¨ ì¢…ì¼';
  const hm = t.split(':').map(Number);
  const ampm = hm[0] < 12 ? 'ì˜¤ì „' : 'ì˜¤í›„';
  const h12 = hm[0] % 12 === 0 ? 12 : hm[0] % 12;
  return ampm + ' ' + h12 + ':' + String(hm[1]).padStart(2, '0');
}

// ì•„ëž˜ìª½ ì•Œë¦¼ + ë˜ëŒë¦¬ê¸°
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

// ì„ íƒí•œ ë‚ ì§œë¡œ ì´ë™
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
  const items = [['all', 'ì „ì²´', null], ['husband', state.husbandName, OWNER_COLORS.husband], ['wife', state.wifeName, OWNER_COLORS.wife], ['both', 'ìš°ë¦¬ ë‘˜', OWNER_COLORS.both]];
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
  document.getElementById('chooserDateText').textContent = parseInt(p[1]) + 'ì›” ' + parseInt(p[2]) + 'ì¼ì— ë„£ì–´ìš”';
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

// ë‚ ì§œë¥¼ ëˆ„ë¥´ë©´ ëœ¨ëŠ” ì°½
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
  if (diff === 0) return 'ì˜¤ëŠ˜';
  if (diff === 1) return 'ë‚´ì¼';
  if (diff === 2) return 'ëª¨ë ˆ';
  return p[1] + '/' + p[2] + ' (' + ['ì¼', 'ì›”', 'í™”', 'ìˆ˜', 'ëª©', 'ê¸ˆ', 'í† '][new Date(p[0], p[1] - 1, p[2]).getDay()] + ')';
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
    + '<span class="block text-xs text-slate-500">' + timeLabel(ev.time) + ' Â· ' + escapeHtml(ownerLabel(ev.owner)) + escapeHtml(eventMetaBadge(ev)) + '</span></span>'
    + '<i class="fa-solid fa-chevron-right text-[10px] text-slate-300"></i>'
    + '</button>';
}

// ì²« í™”ë©´ì—ëŠ” 3ê°œë§Œ, ë‚˜ë¨¸ì§€ëŠ” "ë” ë³´ê¸°" ì°½ì—ì„œ
function renderUpcoming() {
  const box = document.getElementById('upcomingList');
  if (!box) return;
  const all = upcomingEvents();
  const btn = document.getElementById('btnShowAllUpcoming');
  document.getElementById('upcomingCount').textContent = all.length ? all.length + 'ê°œ' : '';
  if (all.length === 0) {
    box.innerHTML = '<div class="py-4 text-center text-sm text-slate-400">ë‹¤ê°€ì˜¤ëŠ” ì•½ì†ì´ ì—†ì–´ìš”.<br>ë‹¬ë ¥ì—ì„œ ë‚ ì§œë¥¼ ëˆŒëŸ¬ ë„£ì–´ ë³´ì„¸ìš”.</div>';
    btn.classList.add('hidden');
  } else {
    box.innerHTML = all.slice(0, 3).map(upcomingRowHtml).join('');
    btn.classList.toggle('hidden', all.length <= 3);
    btn.textContent = 'ë‚˜ë¨¸ì§€ ' + (all.length - 3) + 'ê°œ ë” ë³´ê¸° â€º';
  }
  if (!document.getElementById('upcomingSheet').classList.contains('hidden')) renderUpcomingSheet();
}

function upcomingGroupLabel(dateStr) {
  const p = dateStr.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((new Date(p[0], p[1] - 1, p[2]) - today) / 86400000);
  if (diff < 0) return 'ì§€ë‚œ ì•½ì†';
  const daysToSaturday = 6 - today.getDay();
  if (diff <= daysToSaturday) return 'ì´ë²ˆ ì£¼';
  if (diff <= daysToSaturday + 7) return 'ë‹¤ìŒ ì£¼';
  return p[0] === today.getFullYear() ? p[1] + 'ì›”' : p[0] + 'ë…„ ' + p[1] + 'ì›”';
}

function renderUpcomingSheet() {
  const f = state.upcomingFilter;
  const q = (state.eventSearch || '').trim().toLowerCase();
  const names = { all: 'ì „ì²´', husband: state.husbandName, wife: state.wifeName, both: 'ìš°ë¦¬ ë‘˜' };
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
    box.innerHTML = '<div class="py-8 text-center text-sm text-slate-400">' + (q ? 'ì°¾ìœ¼ì‹œëŠ” ì•½ì†ì´ ì—†ì–´ìš”.' : 'í•´ë‹¹í•˜ëŠ” ì•½ì†ì´ ì—†ì–´ìš”.') + '</div>';
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
    return '<div class="text-xs font-extrabold text-slate-500 pt-2 pb-0.5">' + g.label + ' Â· ' + g.items.length + 'ê°œ</div>'
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
  btnSubmitItem.textContent = 'ê³ ì¹œ ë‚´ìš© ì €ìž¥';
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
  setEditUi('ðŸ“… ì•½ì† ê³ ì¹˜ê¸°');
};

window.editDiary = function(id) {
  const d = state.diaries.find(function(x) { return x.id === id; });
  if (!d) return;
  closeDiaryDetail();
  openModalWithMode('diary');
  state.editingId = id;
  inputItemTitle.value = d.content || '';
  inputItemDate.value = d.date;
  state.selectedMood = d.mood || 'ðŸ¥°';
  document.querySelectorAll('.mood-btn').forEach(function(b) {
    const on = b.dataset.mood === state.selectedMood;
    b.classList.toggle('ring-2', on);
    b.classList.toggle('ring-indigo-500', on);
  });
  state.tempMediaFiles = (d.media || []).slice();
  renderMediaPreviews();
  setEditUi('ðŸ“– ì¼ê¸° ê³ ì¹˜ê¸°');
};

// ì‚¬ì§„ ì¤„ì´ê¸° (íœ´ëŒ€í° ì‚¬ì§„ì€ 3~5MBë¼ ê·¸ëŒ€ë¡œ ë„£ìœ¼ë©´ ê¸ˆë°© ê½‰ ì°¸)
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

// ë°±ì—…
const BACKUP_KEYS = ['cal_events', 'cal_todos', 'cal_diaries', 'cal_anniversary', 'cal_theme_id', 'cal_custom_color', 'cal_bg_photo', 'cal_bg_opacity', 'cal_bg_blur', 'cal_name_husband', 'cal_name_wife'];

function renderLastBackup() {
  const t = localStorage.getItem('cal_last_backup');
  document.getElementById('lastBackupText').textContent = t ? 'ë§ˆì§€ë§‰ ë°±ì—…: ' + t : 'ì•„ì§ ë°±ì—…í•œ ì ì´ ì—†ì–´ìš”.';
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
  a.download = 'ìš°ë¦¬ìº˜ë¦°ë”-ë°±ì—…-' + formatDate(new Date()) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 2000);
  localStorage.setItem('cal_last_backup', formatDate(new Date()));
  renderLastBackup();
  showToast('ë°±ì—… íŒŒì¼ì„ ì €ìž¥í–ˆì–´ìš”! ðŸ’¾');
}

function importBackup(file) {
  file.text().then(function(txt) {
    let data;
    try { data = JSON.parse(txt); } catch (e) { data = null; }
    if (!data || data.app !== 'our-calendar' || !data.items) {
      showToast('ìš°ë¦¬ ìº˜ë¦°ë” ë°±ì—… íŒŒì¼ì´ ì•„ë‹ˆì—ìš” ðŸ¤”');
      return;
    }
    if (!confirm('ë°±ì—… íŒŒì¼ë¡œ ë°”ê¾¸ë©´ ì§€ê¸ˆ ê¸°ë¡ì´ ë°±ì—… ë‚´ìš©ìœ¼ë¡œ ë°”ë€Œì–´ìš”. ê³„ì†í• ê¹Œìš”?')) return;
    try {
      BACKUP_KEYS.forEach(function(k) {
        if (k in data.items) localStorage.setItem(k, data.items[k]);
        else localStorage.removeItem(k);
      });
      localStorage.setItem('cal_seeded', '1');
      location.reload();
    } catch (e) {
      showToast('ë°±ì—…ì„ ë¶ˆëŸ¬ì˜¤ì§€ ëª»í–ˆì–´ìš” ðŸ˜¥');
    }
  });
}

// 3. ìƒíƒœ ê´€ë¦¬
let state = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  selectedDate: formatDate(new Date()),
  calendarView: 'month', // 'month' (ì›”ê°„) or 'week' (ì£¼ê°„ ì ‘ê¸°)
  currentSubTab: 'events', // 'events' or 'diary' (ì„ íƒ ë‚ ì§œ ì¹´ë“œ ì„œë¸Œíƒ­)
  anniversaryDate: localStorage.getItem('cal_anniversary') || '2024-05-18',
  currentThemeId: localStorage.getItem('cal_theme_id') || 'indigo',
  customPrimaryColor: localStorage.getItem('cal_custom_color') || '#4F46E5',
  bgPhoto: localStorage.getItem('cal_bg_photo') || null,
  bgOpacity: localStorage.getItem('cal_bg_opacity') || '18',
  bgBlur: localStorage.getItem('cal_bg_blur') || '16',
  events: JSON.parse(localStorage.getItem('cal_events') || '[]'),
  todos: JSON.parse(localStorage.getItem('cal_todos') || '[]'),
  diaries: JSON.parse(localStorage.getItem('cal_diaries') || '[]'),
  modalType: 'event',
  selectedMood: 'ðŸ¥°',
  tempMediaFiles: [],
  diaryFilterYM: formatDate(new Date()).slice(0, 7),
  diarySearch: '',
  showCompletedTodos: false,
  supabaseUrl: localStorage.getItem('cal_supabase_url') || '',
  supabaseKey: localStorage.getItem('cal_supabase_key') || '',
  husbandName: localStorage.getItem('cal_name_husband') || 'ê°•í˜„ìš°',
  wifeName: localStorage.getItem('cal_name_wife') || 'ê¹€ì‹œë¬¸',
  selectedOwner: 'both',
  selectedTime: '19:00',
  lastSwipe: 0,
  editingId: null,
  upcomingFilter: 'all',
  calendarOwnerFilter: 'all',
  selectedRepeat: 'none',
  eventSearch: ''
};

// ìƒ˜í”Œ ë°ì´í„°
if (!localStorage.getItem('cal_seeded') && state.events.length === 0) {
  const todayStr = formatDate(new Date());
  state.events = [
    { id: '1', title: 'ë¶€ë¶€ ì €ë… ì™¸ì‹', date: todayStr, time: '19:00', owner: 'both', color: '#8B5CF6' },
    { id: '2', title: 'ì£¼ë§ ë“œë¼ì´ë¸Œ ê³„íš', date: todayStr, time: '21:00', owner: 'husband', color: '#3B82F6' }
  ];
  saveEvents();
}

if (!localStorage.getItem('cal_seeded') && state.todos.length === 0) {
  const todayStr = formatDate(new Date());
  state.todos = [
    { id: '1', title: 'ì£¼ë§ ì‹ìž¬ë£Œ ìž¥ë³´ê¸°', isCompleted: false, dueDate: todayStr },
    { id: '2', title: 'ì•„íŒŒíŠ¸ ê´€ë¦¬ë¹„ í™•ì¸', isCompleted: true, dueDate: todayStr }
  ];
  saveTodos();
}

if (!localStorage.getItem('cal_seeded') && state.diaries.length === 0) {
  const todayStr = formatDate(new Date());
  state.diaries = [
    {
      id: '1',
      date: todayStr,
      mood: 'ðŸ¥°',
      content: 'ì˜¤ëŠ˜ í•¨ê»˜ í‡´ê·¼í•˜ê³  ì‚°ì±…í•˜ë©´ì„œ ë‚˜ëˆˆ ëŒ€í™”ê°€ ì •ë§ ì¢‹ì•˜ë‹¤. ë‹¤ìŒ ì£¼ë§ì—ëŠ” ë°”ë‹¤ ë³´ëŸ¬ ê°€ê¸°ë¡œ ì•½ì†!',
      media: [],
      createdAt: new Date().toISOString()
    }
  ];
  saveDiaries();
}
localStorage.setItem('cal_seeded', '1');

// DOM ì—˜ë¦¬ë¨¼íŠ¸
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
const subTabEventsView = document.getElementById('subTabEß^»¶‰žËkºwµçEåÙ•¹ÑÌ€ôÍÑ…Ñ”¹•Ù•¹ÑÌ(€€€€¹™¥±Ñ•È¡”€ôø•Ù•¹Ñ5…Ñ¡•Í…Ñ”¡”°‘…Ñ•MÑÈ¤€˜˜•Ù•¹Ñ5…Ñ¡•Í=Ý¹•É¥±Ñ•È¡”¤¤(€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø€¡„¹Ñ¥µ”ñð€œœ¤¹±½…±•½µÁ…É”¡ˆ¹Ñ¥µ”ñð€œœ¤¤ì(€½¹ÍÐ‘…å¥…É¥•Ì€ôÍÑ…Ñ”¹‘¥…É¥•Ì¹™¥±Ñ•È¡€ôø¹‘…Ñ”€ôôô‘…Ñ•MÑÈ¤ì((€½¹ÍÐ•±°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€•±°¹±…ÍÍ9…µ”€ô€É•±…Ñ¥Ù”™±•à™±•àµ½°¥Ñ•µÌµÍÑÉ•Ñ ÕÉÍ½ÈµÁ½¥¹Ñ•ÈÉ½Õ¹‘•µ±œÑÉ…¹Í¥Ñ¥½¸Áà´À¸ÔÁÐ´ÄÁˆ´Äµ¥¸µ µlÜÁÁát½Ù•É™±½Üµ¡¥‘‘•¸œì((€¥˜€¡¥ÍM•±•Ñ•¤ì(€€€•±°¹±…ÍÍ1¥ÍÐ¹…‘ ‰œµÑ¡•µ”µÁÉ¥µ…Éäœ°€Í¡…‘½ÜµáÌœ¤ì(€ô•±Í”¥˜€¡¥ÍQ½‘…ä¤ì(€€€•±°¹±…ÍÍ1¥ÍÐ¹…‘ É¥¹œ´Èœ°€É¥¹œµÑ¡•µ”µÁÉ¥µ…Éäœ¤ì(€€€•±°¹ÍÑå±”¹‰…­É½Õ¹‘½±½È€ô€É‰„ Üä°€ÜÀ°€ÈÈä°€À¸ÀØ¤œì(€ô•±Í”ì(€€€•±°¹±…ÍÍ1¥ÍÐ¹…‘ ¡½Ù•Èé‰œµÍ±…Ñ”´ÄÀÀœ¤ì(€ô((€±•Ð¹Õµ±…ÍÌ€ô€Ñ•áÐµÍ±…Ñ”´ÜÀÀ™½¹Ðµµ•‘¥Õ´œì(€¥˜€¡¥ÍI•‘…ä¤¹Õµ±…ÍÌ€ô€Ñ•áÐµÉ½Í”´ØÀÀ™½¹Ðµ‰½±œì(€•±Í”¥˜€¡¥ÍM…ÑÕÉ‘…ä¤¹Õµ±…ÍÌ€ô€Ñ•áÐµ‰±Õ”´ØÀÀ™½¹ÐµÍ•µ¥‰½±œì(€¥˜€¡¥ÍM•±•Ñ•¤¹Õµ±…ÍÌ€ô€Ñ•áÐµÝ¡¥Ñ”™½¹Ðµ•áÑÉ…‰½±œì((€½¹ÍÐÑ½À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€Ñ½À¹±…ÍÍ9…µ”€ô€™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È…À´À¸Ô±•…‘¥¹œµ¹½¹” ´Ðœì(€½¹ÍÐ¹Õ´€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì(€¹Õ´¹±…ÍÍ9…µ”€ô€Ñ•áÐµáÌ€œ€¬¹Õµ±…ÍÌì(€¹Õ´¹Ñ•áÑ½¹Ñ•¹Ð€ô‘…Ñ•9Õ´ì(€Ñ½À¹…ÁÁ•¹‘¡¥±¡¹Õ´¤ì(€¥˜€¡‘…å¥…É¥•Ì¹±•¹Ñ €ø€À¤ì(€€€½¹ÍÐµ½½‘5…É¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì(€€€µ½½‘5…É¬¹±…ÍÍ9…µ”€ô€Ñ•áÐµlåÁátœì(€€€µ½½‘5…É¬¹Ñ•áÑ½¹Ñ•¹Ð€ô‘…å¥…É¥•ÍlÁt¹µ½½ñð€ŸÂ~NPœì(€€€Ñ½À¹…ÁÁ•¹‘¡¥±¡µ½½‘5…É¬¤ì(€ô(€¥˜€¡ÍÑ…Ñ”¹…¹¹¥Ù•ÉÍ…Éå…Ñ”€˜˜‘…Ñ•MÑÈ¹Í±¥” Ô¤€ôôôÍÑ…Ñ”¹…¹¹¥Ù•ÉÍ…Éå…Ñ”¹Í±¥” Ô¤€˜˜‘…Ñ•MÑÈ€øôÍÑ…Ñ”¹…¹¹¥Ù•ÉÍ…Éå…Ñ”¤ì(€€€½¹ÍÐÉ¥¹5…É¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì(€€€É¥¹5…É¬¹±…ÍÍ9…µ”€ô€Ñ•áÐµlåÁátœì(€€€É¥¹5…É¬¹Ñ•áÑ½¹Ñ•¹Ð€ô€ŸÂ~J4œì(€€€Ñ½À¹…ÁÁ•¹‘¡¥±¡É¥¹5…É¬¤ì(€ô(€•±°¹…ÁÁ•¹‘¡¥±¡Ñ½À¤ì((€¥˜€¡¡½±¥‘…å9…µ”¤ì(€€€½¹ÍÐ±…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì(€€€±…‰•°¹±…ÍÍ9…µ”€ô€‰±½¬Ñ•áÐµ•¹Ñ•ÈÑ•áÐµlà¸ÕÁát±•…‘¥¹œµÑ¥¡ÐÑÉÕ¹…Ñ”™½¹Ðµ‰½±€œ€¬€¡¥ÍM•±•Ñ•€ü€Ñ•áÐµÉ½Í”´ÄÀÀœ€è€Ñ•áÐµÉ½Í”´ÔÀÀœ¤ì(€€€±…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô¡½±¥‘…å9…µ”ì(€€€•±°¹…ÁÁ•¹‘¡¥±¡±…‰•°¤ì(€ô((€½¹ÍÐµ…á¡¥ÁÌ€ô¡½±¥‘…å9…µ”€ü€Ä€è€Èì(€½¹ÍÐ¡¥Á]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€¡¥Á]É…À¹±…ÍÍ9…µ”€ô€µÐ´À¸Ô™±•à™±•àµ½°…ÀµlÉÁátœì(€‘…åÙ•¹ÑÌ¹Í±¥” À°µ…á¡¥ÁÌ¤¹™½É… ¡•Ø€ôøì(€€€½¹ÍÐ½±½È€ô•Ù•¹Ñ½±½È¡•Ø¤ì(€€€½¹ÍÐ¡¥À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì(€€€¡¥À¹±…ÍÍ9…µ”€ô€‰±½¬ÑÉÕ¹…Ñ”Ñ•áÐµlÄÁÁát±•…‘¥¹œµlÄÑÁátÁà´Ä¸ÔÁäµlÅÁátÉ½Õ¹‘•Ñ•áÐµ±•™Ð™½¹Ðµ‰½±ÑÉ…­¥¹œµÑ¥¡Ðœì(€€€¥˜€¡¥ÍM•±•Ñ•¤ì(€€€€€¡¥À¹ÍÑå±”¹‰…­É½Õ¹‘½±½È€ô€É‰„ ÈÔÔ°€ÈÔÔ°€ÈÔÔ°€À¸ÈÔ¤œì(€€€€€¡¥À¹ÍÑå±”¹½±½È€ô€œœì(€€€ô•±Í”ì(€€€€€¡¥À¹ÍÑå±”¹‰…­É½Õ¹‘½±½È€ô¡•á]¥Ñ¡±Á¡„¡½±½È°€œÈØœ¤ì(€€€€€¡¥À¹ÍÑå±”¹½±½È€ô½±½Èì(€€€ô(€€€¡¥À¹Ñ•áÑ½¹Ñ•¹Ð€ô•Ø¹Ñ¥Ñ±”ì(€€€¡¥Á]É…À¹…ÁÁ•¹‘¡¥±¡¡¥À¤ì(€ô¤ì(€¥˜€¡‘…åÙ•¹ÑÌ¹±•¹Ñ €øµ…á¡¥ÁÌ¤ì(€€€½¹ÍÐµ½É”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì(€€€µ½É”¹±…ÍÍ9…µ”€ô€‰±½¬Ñ•áÐµlåÁát±•…‘¥¹œµlÄÉÁátÑ•áÐµ±•™ÐÁà´Ä™½¹ÐµÍ•µ¥‰½±€œ€¬€¡¥ÍM•±•Ñ•€ü€Ñ•áÐµÝ¡¥Ñ”¼àÀœ€è€Ñ•áÐµÍ±…Ñ”´ÐÀÀœ¤ì(€€€µ½É”¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬œ€¬€¡‘…åÙ•¹ÑÌ¹±•¹Ñ €´µ…á¡¥ÁÌ¤ì(€€€¡¥Á]É…À¹…ÁÁ•¹‘¡¥±¡µ½É”¤ì(€ô(€•±°¹…ÁÁ•¹‘¡¥±¡¡¥Á]É…À¤ì((€•±°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€¥˜€¡…Ñ”¹¹½Ü ¤€´ÍÑ…Ñ”¹±…ÍÑMÝ¥Á”€ð€ÐÀÀ¤É•ÑÕÉ¸ì(€€€ÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”€ô‘…Ñ•MÑÈì(€€€É•¹‘•É…±•¹‘…È ¤ì(€€€É•¹‘•ÉM•±•Ñ•‘…Ñ•Y¥•Ü ¤ì(€€€½Á•¹…åM¡••Ð ¤ì(€ô¤ì((€…±•¹‘…É…åÍÉ¥¹…ÁÁ•¹‘¡¥±¡•±°¤ì)ô((¼¼ƒ²ƒ¶w®Bpƒ®
ƒ²žpƒ²²àƒ®ÞÀ€£²vó²‚T€˜ƒ²vóªâÀƒ¶´¤)™Õ¹Ñ¥½¸É•¹‘•ÉM•±•Ñ•‘…Ñ•Y¥•Ü ¤ì(€½¹ÍÐÁ…ÉÑÌ€ôÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”¹ÍÁ±¥Ð œ´œ¤ì(€½¹ÍÐ¡½±¥‘…å9…µ”€ô•Ñ!½±¥‘…ä¡ÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”¤ì(€½¹ÍÐ¡½±¥‘…åQ•áÐ€ô¡½±¥‘…å9…µ”€ü€€ ‘í¡½±¥‘…å9…µ•ô¥€€è€œœì(€Í•±•Ñ•‘…Ñ•Q¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘íÁ…ÉÍ•%¹Ð¡Á…ÉÑÍlÅt¥÷²nP€‘íÁ…ÉÍ•%¹Ð¡Á…ÉÑÍlÉt¥÷²vð‘í¡½±¥‘…åQ•áÑõ€ì((€½¹ÍÐ‘…åÙ•¹ÑÌ€ôÍÑ…Ñ”¹•Ù•¹ÑÌ¹™¥±Ñ•È¡”€ôø•Ù•¹Ñ5…Ñ¡•Í…Ñ”¡”°ÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”¤€˜˜•Ù•¹Ñ5…Ñ¡•Í=Ý¹•É¥±Ñ•È¡”¤¤ì(€½¹ÍÐ‘…å¥…É¥•Ì€ôÍÑ…Ñ”¹‘¥…É¥•Ì¹™¥±Ñ•È¡€ôø¹‘…Ñ”€ôôôÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”¤ì((€½¹ÍÐÍÀ€ôÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”¹ÍÁ±¥Ð œ´œ¤¹µ…À¡9Õµ‰•È¤ì(€½¹ÍÐÝ••­‘…å9…µ”€ôlŸ²vó²jS²vðœ°€Ÿ²nS²jS²vðœ°€Ÿ¶fS²jS²vðœ°€Ÿ²"c²jS²vðœ°€Ÿ®ª§²jS²vðœ°€Ÿªâ#²jS²vðœ°€Ÿ¶ƒ²jS²vðum¹•Ü…Ñ”¡ÍÁlÁt°ÍÁlÅt€´€Ä°ÍÁlÉt¤¹•Ñ…ä ¥tì(€Í•±•Ñ•‘…Ñ•MÕ‰Ñ¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ôÝ••­‘…å9…µ”€¬€¡ÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”€ôôô™½Éµ…Ñ…Ñ”¡¹•Ü…Ñ” ¤¤€ü€œƒ
Üƒ²b“®*`œ€è€œœ¤ì(€•Ù•¹Ñ½Õ¹Ñ	…‘”¹Ñ•áÑ½¹Ñ•¹Ð€ô‘…åÙ•¹ÑÌ¹±•¹Ñ ì(€‘¥…Éå½Õ¹ÑMÕ‰	…‘”¹Ñ•áÑ½¹Ñ•¹Ð€ô‘…å¥…É¥•Ì¹±•¹Ñ ì((€É•¹‘•ÉM•±•Ñ•‘…Ñ•Ù•¹ÑÍ1¥ÍÐ¡‘…åÙ•¹ÑÌ¤ì(€É•¹‘•ÉM•±•Ñ•‘…Ñ•¥…Éå	½à¡‘…å¥…É¥•Ì¤ì)ô()™Õ¹Ñ¥½¸É•¹‘•ÉM•±•Ñ•‘…Ñ•Ù•¹ÑÍ1¥ÍÐ¡•Ù•¹ÑÌ¤ì(€•Ù•¹ÑÌ€ô•Ù•¹ÑÌ¹Í±¥” ¤¹Í½ÉÐ¡™Õ¹Ñ¥½¸¡„°ˆ¤ìÉ•ÑÕÉ¸€¡„¹Ñ¥µ”ñð€œœ¤¹±½…±•½µÁ…É”¡ˆ¹Ñ¥µ”ñð€œœ¤ìô¤ì(€¥˜€¡•Ù•¹ÑÌ¹±•¹Ñ €ôôô€À¤ì(€€€Í•±•Ñ•‘…Ñ•Ù•¹ÑÍ1¥ÍÐ¹¥¹¹•É!Q50€ô€œñ‘¥Ø±…ÍÌô‰Áä´ÌÑ•áÐµ•¹Ñ•ÈÑ•áÐµÍ±…Ñ”´ÐÀÀÑ•áÐµÍ´ˆøñ‘¥Ø±…ÍÌô‰Ñ•áÐ´Éá°µˆ´ÄˆûÂ~N´ð½‘¥ØøñÀû²V²žƒ²V÷²7²vÐƒ²^²ZÓ²jP¸ð½ÀøñÀ±…ÍÌô‰Ñ•áÐµáÌµÐ´À¸Ôˆû²r²v`€ñˆ±…ÍÌô‰Ñ•áÐµÑ¡•µ”µÁÉ¥µ…ÉäˆûÂ~Nƒ²V÷²4ð½ˆû²vƒ®"3®~°ƒ®²ZÐƒ®ÎÓ²ã²jP¸ð½Àøð½‘¥Øøœì(€€€É•ÑÕÉ¸ì(€ô(€Í•±•Ñ•‘…Ñ•Ù•¹ÑÍ1¥ÍÐ¹¥¹¹•É!Q50€ô•Ù•¹ÑÌ¹µ…À¡™Õ¹Ñ¥½¸¡•Ø¤ì(€€€½¹ÍÐ½±½È€ô•Ù•¹Ñ½±½È¡•Ø¤ì(€€€É•ÑÕÉ¸€œñ‘¥Ø±…ÍÌô‰™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ‰•ÑÝ••¸À´ÄÉ½Õ¹‘•µá°‰œµÍ±…Ñ”´ÔÀ¼àÀ‰½É‘•È‰½É‘•ÈµÍ±…Ñ”´ÄÀÀˆøœ(€€€€€€¬€œñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÌô‰•‘¥Ðµ•Ù•¹Ðµ‰Ñ¸™±•à¥Ñ•µÌµ•¹Ñ•È…À´È¸Ôµ¥¸µÜ´À™±•à´ÄÑ•áÐµ±•™ÐÀ´Ä¸ÔÉ½Õ¹‘•µ±œ¡½Ù•Èé‰œµÝ¡¥Ñ”ÑÉ…¹Í¥Ñ¥½¸ˆ½¹±¥¬ô‰•‘¥ÑÙ•¹Ð¡pœœ€¬•Ø¹¥€¬€pœ¤ˆøœ(€€€€€€¬€œñÍÁ…¸±…ÍÌô‰Ü´Ä¸Ô ´äÉ½Õ¹‘•µ™Õ±°™±•àµÍ¡É¥¹¬´ÀˆÍÑå±”ô‰‰…­É½Õ¹µ½±½Èèœ€¬½±½È€¬€œˆøð½ÍÁ…¸øœ(€€€€€€¬€œñÍÁ…¸±…ÍÌô‰µ¥¸µÜ´ÀˆøñÍÁ…¸±…ÍÌô‰‰±½¬Ñ•áÐµÍ´™½¹Ðµ‰½±Ñ•áÐµÍ±…Ñ”´àÀÀÑÉÕ¹…Ñ”ˆøœ€¬•Í…Á•!Ñµ°¡•Ø¹Ñ¥Ñ±”¤€¬€œ€ñ¤±…ÍÌô‰™„µÍ½±¥™„µÁ•¸Ñ•áÐµlÄÁÁátÑ•áÐµÍ±…Ñ”´ÌÀÀˆøð½¤øð½ÍÁ…¸øœ(€€€€€€¬€œñÍÁ…¸±…ÍÌô‰‰±½¬Ñ•áÐµáÌÑ•áÐµÍ±…Ñ”´ÔÀÀ™½¹Ðµµ•‘¥Õ´ˆøœ€¬Ñ¥µ•1…‰•°¡•Ø¹Ñ¥µ”¤€¬€œƒ
Ü€ñˆÍÑå±”ô‰½±½Èèœ€¬½±½È€¬€œˆøœ€¬•Í…Á•!Ñµ°¡½Ý¹•É1…‰•°¡•Ø¹½Ý¹•È¤¤€¬€œð½ˆøœ€¬•Í…Á•!Ñµ°¡•Ù•¹Ñ5•Ñ…	…‘”¡•Ø¤¤€¬€œð½ÍÁ…¸øð½ÍÁ…¸øœ(€€€€€€¬€œð½‰ÕÑÑ½¸øœ(€€€€€€¬€œñ‰ÕÑÑ½¸±…ÍÌô‰Ü´ÄÀ ´ÄÀ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÉ½Õ¹‘•µ±œÑ•áÐµÍ±…Ñ”´ÐÀÀ¡½Ù•ÈéÑ•áÐµÉ½Í”´ÔÀÀ¡½Ù•Èé‰œµÉ½Í”´ÔÀ™±•àµÍ¡É¥¹¬´Àˆ½¹±¥¬ô‰‘•±•Ñ•Ù•¹Ð¡pœœ€¬•Ø¹¥€¬€pœ¤ˆ…É¥„µ±…‰•°ô‹²ž²jÃªâÀˆøñ¤±…ÍÌô‰™„µÍ½±¥™„µÑÉ…Í µ…¸ˆøð½¤øð½‰ÕÑÑ½¸øœ(€€€€€€¬€œð½‘¥Øøœì(€ô¤¹©½¥¸ œœ¤ì)ô()™Õ¹Ñ¥½¸É•¹‘•ÉM•±•Ñ•‘…Ñ•¥…Éå	½à¡‘¥…É¥•Ì¤ì(€¥˜€¡‘¥…É¥•Ì¹±•¹Ñ €ôôô€À¤ì(€€€Í•±•Ñ•‘…Ñ•¥…Éå	½à¹¥¹¹•É!Q50€ô€œñ‘¥Ø±…ÍÌô‰Ñ•áÐµáÌÑ•áÐµÍ±…Ñ”´ÐÀÀ‰œµÉ½Í”´ÔÀ¼ÐÀ‰½É‘•È‰½É‘•ÈµÉ½Í”´ÄÀÀÉ½Õ¹‘•µá°À´Ìµ¥¸µ µlÐÙÁát™±•à¥Ñ•µÌµ•¹Ñ•ÈˆûªâÃ®†w®Bpƒ²vóªâÃªÂ ƒ²^²*×®.#®.¸ƒ²®. o²vóªâÀƒ²NÃªâÁw®–ðƒ®"3®~°ƒ²
³²žªÎðƒ²3²’G¶Vpƒ¶Vc®Ž£®–ðƒ®
£ªÊ£®ÎÓ²ã²jP¸ð½‘¥Øøœì(€€€É•ÑÕÉ¸ì(€ô(€Í•±•Ñ•‘…Ñ•¥…Éå	½à¹¥¹¹•É!Q50€ô‘¥…É¥•Ì¹µ…À¡€ôø‘¥…ÉåI½Ý!Ñµ°¡°™…±Í”¤¤¹©½¥¸ œœ¤ì)ô()™Õ¹Ñ¥½¸‘¥…ÉåAÉ•Ù¥•ÝQ•áÐ¡¤ì(€½¹ÍÐÑ•áÐ€ô€¡¹½¹Ñ•¹Ðñð€œœ¤¹ÍÁ±¥Ð q¸œ¤¹µ…À¡Ì€ôøÌ¹ÑÉ¥´ ¤¤¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€œ¤ì(€¥˜€¡Ñ•áÐ¤É•ÑÕÉ¸Ñ•áÐì(€É•ÑÕÉ¸€¡¹µ•‘¥„€˜˜¹µ•‘¥„¹±•¹Ñ ¤€ü€Ÿ²
³²ž
ß®>g²b²ƒªâÃ®†tœ€è€Ÿ®
Ó²j¤ƒ²^²v0œì)ô()™Õ¹Ñ¥½¸‘¥…ÉåQ¡Õµ‰!Ñµ°¡µ•‘¥„¤ì(€¥˜€ …µ•‘¥„ñðµ•‘¥„¹±•¹Ñ €ôôô€À¤É•ÑÕÉ¸€œœì(€½¹ÍÐ™¥ÉÍÑ%µ…”€ôµ•‘¥„¹™¥¹¡´€ôø´¹ÑåÁ”€ôôô€¥µ…”œ¤ì(€½¹ÍÐ½Õ¹Ñ	…‘”€ôµ•‘¥„¹±•¹Ñ €ø€Ä€ü€œñÍÁ…¸±…ÍÌô‰…‰Í½±ÕÑ”‰½ÑÑ½´´ÀÉ¥¡Ð´À‰œµ‰±…¬¼ØÀÑ•áÐµÝ¡¥Ñ”Ñ•áÐµláÁátÁà´ÄÉ½Õ¹‘•µÑ°ˆøœ€¬µ•‘¥„¹±•¹Ñ €¬€œð½ÍÁ…¸øœ€è€œœì(€½¹ÍÐ¥¹¹•È€ô™¥ÉÍÑ%µ…”(€€€€ü€œñ¥µœÍÉŒôˆœ€¬™¥ÉÍÑ%µ…”¹ÕÉ°€¬€œˆ±…ÍÌô‰Üµ™Õ±° µ™Õ±°½‰©•Ðµ½Ù•Èˆøœ(€€€€è€œñÍÁ…¸±…ÍÌô‰Üµ™Õ±° µ™Õ±°‰œµÍ±…Ñ”´àÀÀÑ•áÐµÝ¡¥Ñ”™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑ•áÐµáÌˆøñ¤±…ÍÌô‰™„µÍ½±¥™„µÁ±…äˆøð½¤øð½ÍÁ…¸øœì(€É•ÑÕÉ¸€œñÍÁ…¸±…ÍÌô‰É•±…Ñ¥Ù”Ü´ÄÀ ´ÄÀÉ½Õ¹‘•µ±œ½Ù•É™±½Üµ¡¥‘‘•¸™±•àµÍ¡É¥¹¬´À‰½É‘•È‰½É‘•ÈµÍ±…Ñ”´ÈÀÀ™±•àˆøœ€¬¥¹¹•È€¬½Õ¹Ñ	…‘”€¬€œð½ÍÁ…¸øœì)ô()™Õ¹Ñ¥½¸‘¥…ÉåI½Ý!Ñµ°¡°Í¡½Ý…Ñ”¤ì(€½¹ÍÐ‘…Ñ•1¥¹”€ôÍ¡½Ý…Ñ”€ü€œñÍÁ…¸±…ÍÌô‰‰±½¬Ñ•áÐµlÄÁÁát™½¹Ðµ‰½±Ñ•áÐµÍ±…Ñ”´ÐÀÀˆøœ€¬™½Éµ…Ñ¥…Éå…Ñ”¡¹‘…Ñ”¤€¬€œð½ÍÁ…¸øœ€è€œœì(€É•ÑÕÉ¸€œñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÌô‰Üµ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È…À´È¸ÔÀ´È¸ÔÉ½Õ¹‘•µá°‰œµÝ¡¥Ñ”¼àÔ‰½É‘•È‰½É‘•ÈµÍ±…Ñ”´ÈÀÀ¼ÜÀ¡½Ù•Èé‰œµÍ±…Ñ”´ÔÀÑ•áÐµ±•™ÐÑÉ…¹Í¥Ñ¥½¸ˆ½¹±¥¬ô‰½Á•¹¥…Éå•Ñ…¥°¡pœœ€¬¹¥€¬€pœ¤ˆøœ(€€€€¬€œñÍÁ…¸±…ÍÌô‰Ñ•áÐµ±œÜ´à ´à™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È‰œµÉ½Í”´ÔÀÉ½Õ¹‘•µ±œ™±•àµÍ¡É¥¹¬´Àˆøœ€¬€¡¹µ½½ñð€ŸÂ~–Àœ¤€¬€œð½ÍÁ…¸øœ(€€€€¬€œñÍÁ…¸±…ÍÌô‰™±•à´Äµ¥¸µÜ´Àˆøœ€¬‘…Ñ•1¥¹”(€€€€¬€œñÍÁ…¸±…ÍÌô‰‰±½¬Ñ•áÐµáÌ™½¹Ðµµ•‘¥Õ´Ñ•áÐµÍ±…Ñ”´àÀÀÑÉÕ¹…Ñ”ˆøœ€¬•Í…Á•!Ñµ°¡‘¥…ÉåAÉ•Ù¥•ÝQ•áÐ¡¤¤€¬€œð½ÍÁ…¸øð½ÍÁ…¸øœ(€€€€¬‘¥…ÉåQ¡Õµ‰!Ñµ°¡¹µ•‘¥„¤(€€€€¬€œñ¤±…ÍÌô‰™„µÍ½±¥™„µ¡•ÙÉ½¸µÉ¥¡ÐÑ•áÐµlÄÁÁátÑ•áÐµÍ±…Ñ”´ÌÀÀ™±•àµÍ¡É¥¹¬´Àˆøð½¤øœ(€€€€¬€œð½‰ÕÑÑ½¸øœì)ô()™Õ¹Ñ¥½¸™½Éµ…Ñ¥…Éå…Ñ”¡‘…Ñ•MÑÈ¤ì(€½¹ÍÐÁ…ÉÑÌ€ô‘…Ñ•MÑÈ¹ÍÁ±¥Ð œ´œ¤¹µ…À¡9Õµ‰•È¤ì(€½¹ÍÐ‘½Ü€ôlŸ²vðœ°€Ÿ²nPœ°€Ÿ¶fPœ°€Ÿ²"`œ°€Ÿ®ª¤œ°€Ÿªâ œ°€Ÿ¶€um¹•Ü…Ñ”¡Á…ÉÑÍlÁt°Á…ÉÑÍlÅt€´€Ä°Á…ÉÑÍlÉt¤¹•Ñ…ä ¥tì(€É•ÑÕÉ¸Á…ÉÑÍlÅt€¬€Ÿ²nP€œ€¬Á…ÉÑÍlÉt€¬€Ÿ²vð€ œ€¬‘½Ü€¬€œ¤œì)ô((¼¼ƒ²‚²ÊÐƒ®.“²vÓ²ZÓ®š°ƒ¶´ƒ®‚3®6S®ž€£²nS®Îƒ®ª§®†t€¬ƒªÊ²$°ƒ®"®–Ó®¦Ðƒ²²àƒ®ÎÓªâÀ¤)™Õ¹Ñ¥½¸É•¹‘•É±±¥…É¥•Ì ¤ì(€½¹ÍÐÅÕ•Éä€ôÍÑ…Ñ”¹‘¥…ÉåM•…É ¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€½¹ÍÐå´€ôÍÑ…Ñ”¹‘¥…Éå¥±Ñ•Ée4ì(€½¹ÍÐµ½¹Ñ¡1…‰•°€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…Éå5½¹Ñ¡1…‰•°œ¤ì(€½¹ÍÐ…±±Q½±”€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹¥…Éå±±Q½±”œ¤ì(€¥˜€¡å´¤ì(€€€½¹ÍÐåµA…ÉÑÌ€ôå´¹ÍÁ±¥Ð œ´œ¤ì(€€€µ½¹Ñ¡1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ôåµA…ÉÑÍlÁt€¬€Ÿ®€œ€¬Á…ÉÍ•%¹Ð¡åµA…ÉÑÍlÅt¤€¬€Ÿ²nPœì(€€€…±±Q½±”¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ²‚²ÊÐƒ®ÎÓªâÀœì(€ô•±Í”ì(€€€µ½¹Ñ¡1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ²‚²ÊÐƒªâÃªÂœì(€€€…±±Q½±”¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ²nS®Îƒ®ÎÓªâÀœì(€ô((€±•Ð±¥ÍÐ€ôÍÑ…Ñ”¹‘¥…É¥•Ì¹Í±¥” ¤¹Í½ÉÐ ¡„°ˆ¤€ôø€¡ˆ¹‘…Ñ”€¬€¡ˆ¹É•…Ñ•‘Ðñð€œœ¤¤¹±½…±•½µÁ…É”¡„¹‘…Ñ”€¬€¡„¹É•…Ñ•‘Ðñð€œœ¤¤¤ì(€¥˜€¡ÅÕ•Éä¤±¥ÍÐ€ô±¥ÍÐ¹™¥±Ñ•È¡€ôø€¡¹½¹Ñ•¹Ðñð€œœ¤¹Ñ½1½Ý•É…Í” ¤¹¥¹±Õ‘•Ì¡ÅÕ•Éä¤¤ì(€•±Í”¥˜€¡å´¤±¥ÍÐ€ô±¥ÍÐ¹™¥±Ñ•È¡€ôø¹‘…Ñ”¹ÍÑ…ÉÑÍ]¥Ñ ¡å´¤¤ì((€‘¥…Éå½Õ¹Ñ	…‘”¹Ñ•áÑ½¹Ñ•¹Ð€ô±¥ÍÐ¹±•¹Ñ €¬€ŸªÂpƒ
Üƒ²‚²ÊÐ€œ€¬ÍÑ…Ñ”¹‘¥…É¥•Ì¹±•¹Ñ €¬€ŸªÂpœì((€¥˜€¡±¥ÍÐ¹±•¹Ñ €ôôô€À¤ì(€€€…±±¥…Éå½¹Ñ…¥¹•È¹¥¹¹•É!Q50€ô€œñ‘¥Ø±…ÍÌô‰Áä´ÄÀÑ•áÐµ•¹Ñ•ÈÑ•áÐµÍ±…Ñ”´ÐÀÀÑ•áÐµáÌˆøñ¤±…ÍÌô‰™„µÉ•Õ±…È™„µ¡•…ÉÐÑ•áÐ´Éá°µˆ´ÈÑ•áÐµÉ½Í”´ÌÀÀˆøð½¤øñÀøœ€¬€¡ÅÕ•Éä€ü€ŸªÊ²$ƒªÊÃªÎóªÂ ƒ²^²*×®.#®.¸œ€è€Ÿ²vÐƒªâÃªÂ²^@ƒ²NÐƒ²vóªâÃªÂ ƒ²^²*×®.#®.¸œ¤€¬€œð½Àøð½‘¥Øøœì(€€€É•ÑÕÉ¸ì(€ô((€½¹ÍÐÉ½ÕÁÌ€ômtì(€±¥ÍÐ¹™½É… ¡€ôøì(€€€½¹ÍÐ­•ä€ô¹‘…Ñ”¹Í±¥” À°€Ü¤ì(€€€±•Ðœ€ôÉ½ÕÁÍmÉ½ÕÁÌ¹±•¹Ñ €´€Åtì(€€€¥˜€ …œñðœ¹­•ä€„ôô­•ä¤ì(€€€€€œ€ôì­•äè­•ä°¥Ñ•µÌèmtôì(€€€€€É½ÕÁÌ¹ÁÕÍ ¡œ¤ì(€€€ô(€€€œ¹¥Ñ•µÌ¹ÁÕÍ ¡¤ì(€ô¤ì((€…±±¥…Éå½¹Ñ…¥¹•È¹¥¹¹•É!Q50€ôÉ½ÕÁÌ¹µ…À¡œ€ôøì(€€€½¹ÍÐÀ€ôœ¹­•ä¹ÍÁ±¥Ð œ´œ¤ì(€€€É•ÑÕÉ¸€œñ‘¥Ø±…ÍÌô‰Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±Ñ•áÐµÍ±…Ñ”´ÔÀÀÁÐ´ÈÁˆ´À¸Ôˆøœ€¬ÁlÁt€¬€Ÿ®€œ€¬Á…ÉÍ•%¹Ð¡ÁlÅt¤€¬€Ÿ²nPƒ
Ü€œ€¬œ¹¥Ñ•µÌ¹±•¹Ñ €¬€ŸªÂpð½‘¥Øøœ(€€€€€€¬œ¹¥Ñ•µÌ¹µ…À¡€ôø‘¥…ÉåI½Ý!Ñµ°¡°ÑÉÕ”¤¤¹©½¥¸ œœ¤ì(€ô¤¹©½¥¸ œœ¤ì)ô()±•Ð½Á•¹•‘¥…Éå%€ô¹Õ±°ì()Ý¥¹‘½Ü¹½Á•¹¥…Éå•Ñ…¥°€ô™Õ¹Ñ¥½¸¡¥¤ì(€½¹ÍÐ€ôÍÑ…Ñ”¹‘¥…É¥•Ì¹™¥¹¡à€ôøà¹¥€ôôô¥¤ì(€¥˜€ …¤É•ÑÕÉ¸ì(€½Á•¹•‘¥…Éå%€ô¥ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…Éå•Ñ…¥±5½½œ¤¹Ñ•áÑ½¹Ñ•¹Ð€ô¹µ½½ñð€ŸÂ~–Àœì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…Éå•Ñ…¥±…Ñ”œ¤¹Ñ•áÑ½¹Ñ•¹Ð€ô¹‘…Ñ”¹Í±¥” À°€Ð¤€¬€Ÿ®€œ€¬™½Éµ…Ñ¥…Éå…Ñ”¡¹‘…Ñ”¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…Éå•Ñ…¥±Q¥µ”œ¤¹Ñ•áÑ½¹Ñ•¹Ð€ô™½Éµ…ÑQ¥µ•¼¡¹É•…Ñ•‘Ð¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…Éå•Ñ…¥±½¹Ñ•¹Ðœ¤¹Ñ•áÑ½¹Ñ•¹Ð€ô¹½¹Ñ•¹Ðñð€œœì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…Éå•Ñ…¥±5•‘¥„œ¤¹¥¹¹•É!Q50€ôÉ•¹‘•É5•‘¥…!Ñµ°¡¹µ•‘¥„°€ää¤ì(€½¹ÍÐµ½‘…°€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…Éå•Ñ…¥±5½‘…°œ¤ì(€µ½‘…°¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ¡¥‘‘•¸œ¤ì(€µ½‘…°¹±…ÍÍ1¥ÍÐ¹…‘ ™±•àœ¤ì)ôì()™Õ¹Ñ¥½¸±½Í•¥…Éå•Ñ…¥° ¤ì(€½¹ÍÐµ½‘…°€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…Éå•Ñ…¥±5½‘…°œ¤ì(€µ½‘…°¹±…ÍÍ1¥ÍÐ¹…‘ ¡¥‘‘•¸œ¤ì(€µ½‘…°¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ™±•àœ¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…Éå•Ñ…¥±5•‘¥„œ¤¹¥¹¹•É!Q50€ô€œœì(€½Á•¹•‘¥…Éå%€ô¹Õ±°ì)ô()™Õ¹Ñ¥½¸É•¹‘•É5•‘¥…!Ñµ°¡µ•‘¥…1¥ÍÐ°µ…á½Õ¹Ð€ô€Ð¤ì(€¥˜€ …µ•‘¥…1¥ÍÐñðµ•‘¥…1¥ÍÐ¹±•¹Ñ €ôôô€À¤É•ÑÕÉ¸€œœì(€É•ÑÕÉ¸€(€€€€ñ‘¥Ø±…ÍÌô‰É¥É¥µ½±Ì´È…À´ÈÁÐ´Äˆø(€€€€€€‘íµ•‘¥…1¥ÍÐ¹Í±¥” À°µ…á½Õ¹Ð¤¹µ…À¡´€ôøì(€€€€€€€¥˜€¡´¹ÑåÁ”€ôôô€Ù¥‘•¼œ¤ì(€€€€€€€€€É•ÑÕÉ¸€(€€€€€€€€€€€€ñ‘¥Ø±…ÍÌô‰½°µÍÁ…¸´ÈÉ½Õ¹‘•µá°½Ù•É™±½Üµ¡¥‘‘•¸‰œµ‰±…¬¼äÀ…ÍÁ•ÐµÙ¥‘•¼™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•Èˆø(€€€€€€€€€€€€€€ñÙ¥‘•¼ÍÉŒôˆ‘í´¹ÕÉ±ôˆ½¹ÑÉ½±Ì±…ÍÌô‰Üµ™Õ±°µ…àµ ´ÔÈÉ½Õ¹‘•µá°½‰©•Ðµ½¹Ñ…¥¸ˆøð½Ù¥‘•¼ø(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ì(€€€€€€€ô•±Í”ì(€€€€€€€€€É•ÑÕÉ¸€(€€€€€€€€€€€€ñ‘¥Ø±…ÍÌô‰É½Õ¹‘•µá°½Ù•É™±½Üµ¡¥‘‘•¸…ÍÁ•ÐµÍÅÕ…É”‰œµÍ±…Ñ”´ÄÀÀ‰½É‘•È‰½É‘•ÈµÍ±…Ñ”´ÈÀÀ¼ØÀÉ•±…Ñ¥Ù”É½ÕÀˆø(€€€€€€€€€€€€€€ñ¥µœÍÉŒôˆ‘í´¹ÕÉ±ôˆ±…ÍÌô‰Üµ™Õ±° µ™Õ±°½‰©•Ðµ½Ù•ÈÑÉ…¹Í¥Ñ¥½¸‘ÕÉ…Ñ¥½¸´ÈÀÀÉ½ÕÀµ¡½Ù•ÈéÍ…±”´ÄÀÔÕÉÍ½ÈµÁ½¥¹Ñ•Èˆ½¹±¥¬ô‰½Á•¹A¡½Ñ½Y¥•Ý•È¡Ñ¡¥Ì¹ÍÉŒ¤ˆø(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ì(€€€€€€€ô(€€€€€ô¤¹©½¥¸ œœ¥ô(€€€€ð½‘¥Øø(€€ì)ô()™Õ¹Ñ¥½¸Ñ½‘½I½Ý!Ñµ°¡Ñ½‘¼¤ì(€É•ÑÕÉ¸€œñ‘¥Ø±…ÍÌô‰™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ‰•ÑÝ••¸Áà´È¸ÔÁä´ÈÉ½Õ¹‘•µá°‰œµÍ±…Ñ”´ÔÀ¼àÀ‰½É‘•È‰½É‘•ÈµÍ±…Ñ”´ÄÀÀˆøœ(€€€€¬€œñ±…‰•°±…ÍÌô‰™±•à¥Ñ•µÌµ•¹Ñ•È…À´È¸Ô™±•à´Äµ¥¸µÜ´ÀÕÉÍ½ÈµÁ½¥¹Ñ•Èˆøœ(€€€€¬€œñ¥¹ÁÕÐÑåÁ”ô‰¡•­‰½àˆ€œ€¬€¡Ñ½‘¼¹¥Í½µÁ±•Ñ•€ü€¡•­•œ€è€œœ¤€¬€œ±…ÍÌô‰Ü´Ð ´ÐÉ½Õ¹‘•ÕÉÍ½ÈµÁ½¥¹Ñ•È™±•àµÍ¡É¥¹¬´ÀˆÍÑå±”ô‰…•¹Ðµ½±½ÈèÙ…È ´µÑ¡•µ”µÁÉ¥µ…Éä¤ˆ½¹¡…¹”ô‰Ñ½±•Q½‘¼¡pœœ€¬Ñ½‘¼¹¥€¬€pœ¤ˆøœ(€€€€¬€œñÍÁ…¸±…ÍÌô‰Ñ•áÐµÍ´ÑÉÕ¹…Ñ”€œ€¬€¡Ñ½‘¼¹¥Í½µÁ±•Ñ•€ü€±¥¹”µÑ¡É½Õ Ñ•áÐµÍ±…Ñ”´ÐÀÀœ€è€Ñ•áÐµÍ±…Ñ”´ÜÀÀ™½¹Ðµµ•‘¥Õ´œ¤€¬€œˆøœ€¬•Í…Á•!Ñµ°¡Ñ½‘¼¹Ñ¥Ñ±”¤€¬€œð½ÍÁ…¸øœ(€€€€¬€œð½±…‰•°øœ(€€€€¬€œñ‰ÕÑÑ½¸±…ÍÌô‰Ñ•áÐµÍ±…Ñ”´ÌÀÀ¡½Ù•ÈéÑ•áÐµÉ½Í”´ÔÀÀÀ´ÄÑÉ…¹Í¥Ñ¥½¸™±•àµÍ¡É¥¹¬´Àˆ½¹±¥¬ô‰‘•±•Ñ•Q½‘¼¡pœœ€¬Ñ½‘¼¹¥€¬€pœ¤ˆøñ¤±…ÍÌô‰™„µÍ½±¥™„µáµ…É¬Ñ•áÐµáÌˆøð½¤øð½‰ÕÑÑ½¸øœ(€€€€¬€œð½‘¥Øøœì)ô()™Õ¹Ñ¥½¸É•¹‘•ÉQ½‘½Ì ¤ì(€½¹ÍÐ…Ñ¥Ù”€ôÍÑ…Ñ”¹Ñ½‘½Ì¹™¥±Ñ•È¡Ð€ôø€…Ð¹¥Í½µÁ±•Ñ•¤ì(€½¹ÍÐ‘½¹”€ôÍÑ…Ñ”¹Ñ½‘½Ì¹™¥±Ñ•È¡Ð€ôøÐ¹¥Í½µÁ±•Ñ•¤ì(€Ñ½‘½MÑ…ÑÍ	…‘”¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ®
£²v ƒ²vð€œ€¬…Ñ¥Ù”¹±•¹Ñ €¬€ŸªÂpœì((€Ñ½‘½Í1¥ÍÑ½¹Ñ…¥¹•È¹¥¹¹•É!Q50€ô…Ñ¥Ù”¹±•¹Ñ (€€€€ü…Ñ¥Ù”¹µ…À¡Ñ½‘½I½Ý!Ñµ°¤¹©½¥¸ œœ¤(€€€€è€œñ‘¥Ø±…ÍÌô‰Áä´ØÑ•áÐµ•¹Ñ•ÈÑ•áÐµÍ±…Ñ”´ÐÀÀÑ•áÐµáÌˆøñ¤±…ÍÌô‰™„µÉ•Õ±…È™„µ¥É±”µ¡•¬Ñ•áÐµá°µˆ´ÄÑ•áÐµÍ±…Ñ”´ÌÀÀˆøð½¤øñÀû®
£²v ƒ¶V€ƒ²vó²vÐƒ²^²ZÓ²jP¸ð½Àøð½‘¥Øøœì((€½¹ÍÐÑ½±•	Ñ¸€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹Q½±•½µÁ±•Ñ•‘Q½‘½Ìœ¤ì(€½¹ÍÐ‘½¹•]É…À€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ½µÁ±•Ñ•‘Q½‘½Í½¹Ñ…¥¹•Èœ¤ì(€¥˜€¡‘½¹”¹±•¹Ñ €ôôô€À¤ì(€€€Ñ½±•	Ñ¸¹±…ÍÍ1¥ÍÐ¹…‘ ¡¥‘‘•¸œ¤ì(€€€‘½¹•]É…À¹±…ÍÍ1¥ÍÐ¹…‘ ¡¥‘‘•¸œ¤ì(€€€‘½¹•]É…À¹¥¹¹•É!Q50€ô€œœì(€€€É•ÑÕÉ¸ì(€ô(€Ñ½±•	Ñ¸¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ¡¥‘‘•¸œ¤ì(€Ñ½±•	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ®w®
àƒ²vð€œ€¬‘½¹”¹±•¹Ñ €¬€ŸªÂp€œ€¬€¡ÍÑ…Ñ”¹Í¡½Ý½µÁ±•Ñ•‘Q½‘½Ì€ü€Ÿ²"£ªâÃªâÀƒŠZÈœ€è€Ÿ®ÎÓªâÀƒŠZðœ¤ì(€¥˜€¡ÍÑ…Ñ”¹Í¡½Ý½µÁ±•Ñ•‘Q½‘½Ì¤ì(€€€‘½¹•]É…À¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ¡¥‘‘•¸œ¤ì(€€€‘½¹•]É…À¹¥¹¹•É!Q50€ô‘½¹”¹µ…À¡Ñ½‘½I½Ý!Ñµ°¤¹©½¥¸ œœ¤(€€€€€€¬€œñ‰ÕÑÑ½¸±…ÍÌô‰Üµ™Õ±°Ñ•áÐµlÄÅÁát™½¹ÐµÍ•µ¥‰½±Ñ•áÐµÉ½Í”´ÔÀÀ¡½Ù•ÈéÕ¹‘•É±¥¹”ÁÐ´Äˆ½¹±¥¬ô‰±•…É½µÁ±•Ñ•‘Q½‘½Ì ¤ˆû®w®
àƒ²vðƒ®ª£®F@ƒ²ž²jÃªâÀð½‰ÕÑÑ½¸øœì(€ô•±Í”ì(€€€‘½¹•]É…À¹±…ÍÍ1¥ÍÐ¹…‘ ¡¥‘‘•¸œ¤ì(€€€‘½¹•]É…À¹¥¹¹•É!Q50€ô€œœì(€ô)ô()Ý¥¹‘½Ü¹±•…É½µÁ±•Ñ•‘Q½‘½Ì€ô™Õ¹Ñ¥½¸ ¤ì(€½¹ÍÐ‰•™½É”€ôÍÑ…Ñ”¹Ñ½‘½Ì¹Í±¥” ¤ì(€½¹ÍÐÉ•µ½Ù•‘1¥ÍÐ€ôÍÑ…Ñ”¹Ñ½‘½Ì¹™¥±Ñ•È¡™Õ¹Ñ¥½¸¡Ð¤ìÉ•ÑÕÉ¸Ð¹¥Í½µÁ±•Ñ•ìô¤ì(€ÍÑ…Ñ”¹Ñ½‘½Ì€ôÍÑ…Ñ”¹Ñ½‘½Ì¹™¥±Ñ•È¡™Õ¹Ñ¥½¸¡Ð¤ìÉ•ÑÕÉ¸€…Ð¹¥Í½µÁ±•Ñ•ìô¤ì(€Í…Ù•Q½‘½Ì ¤ì(€É•µ½Ù•‘1¥ÍÐ¹™½É… ¡™Õ¹Ñ¥½¸¡Ð¤ìÁÕÍ¡I•µ½Ñ•Q½‘¼ ‘•±•Ñ”œ°Ð¤ìô¤ì(€É•¹‘•ÉQ½‘½Ì ¤ì(€Í¡½ÝQ½…ÍÐ Ÿ®w®
àƒ²vó²vƒ®ª£®F@ƒ²ž²nƒ²ZÓ²jPœ°™Õ¹Ñ¥½¸ ¤ì(€€€ÍÑ…Ñ”¹Ñ½‘½Ì€ô‰•™½É”ì(€€€Í…Ù•Q½‘½Ì ¤ì(€€€É•µ½Ù•‘1¥ÍÐ¹™½É… ¡™Õ¹Ñ¥½¸¡Ð¤ìÁÕÍ¡I•µ½Ñ•Q½‘¼ ¥¹Í•ÉÐœ°Ð¤ìô¤ì(€€€É•¹‘•ÉQ½‘½Ì ¤ì(€ô¤ì)ôì((¼¼€ôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôô(¼¼ƒŠj„ƒ²vÓ®Ê“¶*àƒ®š³²*“® ƒ®NÇ®†t(¼¼€ôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôôô()™Õ¹Ñ¥½¸Í•ÑÕÁÙ•¹Ñ1¥ÍÑ•¹•ÉÌ ¤ì(€€¼¼ƒ®Bc®>3®š³ªâÀ€¼ƒ²b“®*`€¼ƒ²vÐƒ®
ƒ²^@ƒ²ÚSªÂ €¼ƒ²vÓ®š(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% Ñ½…ÍÑU¹‘¼œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€½¹ÍÐ™¸€ôÑ½…ÍÑU¹‘½¸ì(€€€¡¥‘•Q½…ÍÐ ¤ì(€€€¥˜€¡™¸¤ì(€€€€€™¸ ¤ì(€€€€€Í¡½ÝQ½…ÍÐ Ÿ®Bc®>3®‚ã²ZÓ²jPƒÂ~F4œ¤ì(€€€ô(€ô¤ì((€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹½Q½‘…äœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€½Q½…Ñ”¡™½Éµ…Ñ…Ñ”¡¹•Ü…Ñ” ¤¤¤ì(€ô¤ì((€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹=Á•¹Ù•¹ÑM•…É œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€½Á•¹UÁ½µ¥¹M¡••Ð ¤ì(€€€Í•ÑQ¥µ•½ÕÐ¡™Õ¹Ñ¥½¸ ¤ì‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% •Ù•¹ÑM•…É¡%¹ÁÕÐœ¤¹™½ÕÌ ¤ìô°€ØÀ¤ì(€ô¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% •Ù•¹ÑM•…É¡%¹ÁÕÐœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¥¹ÁÕÐœ°™Õ¹Ñ¥½¸¡”¤ì(€€€ÍÑ…Ñ”¹•Ù•¹ÑM•…É €ô”¹Ñ…É•Ð¹Ù…±Õ”ì(€€€É•¹‘•ÉUÁ½µ¥¹M¡••Ð ¤ì(€ô¤ì(€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹É•Á•…ÐµÁÉ•Í•Ðµ‰Ñ¸œ¤¹™½É… ¡™Õ¹Ñ¥½¸¡‰Ñ¸¤ì(€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€€€ÍÑ…Ñ”¹Í•±•Ñ•‘I•Á•…Ð€ô‰Ñ¸¹‘…Ñ…Í•Ð¹É•Á•…Ðì(€€€€€ÕÁ‘…Ñ•I•Á•…Ñ	ÕÑÑ½¹Ì ¤ì(€€€ô¤ì(€ô¤ì(€¥¹ÁÕÑ%Ñ•µ…Ñ”¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°™Õ¹Ñ¥½¸ ¤ì(€€€½¹ÍÐ•¹‘°€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑ%Ñ•µ¹‘…Ñ”œ¤ì(€€€¥˜€ …•¹‘°¹Ù…±Õ”ñð•¹‘°¹Ù…±Õ”€ð¥¹ÁÕÑ%Ñ•µ…Ñ”¹Ù…±Õ”¤•¹‘°¹Ù…±Õ”€ô¥¹ÁÕÑ%Ñ•µ…Ñ”¹Ù…±Õ”ì(€ô¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹M¡½Ý±±UÁ½µ¥¹œœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°½Á•¹UÁ½µ¥¹M¡••Ð¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹±½Í•UÁ½µ¥¹M¡••Ðœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°±½Í•UÁ½µ¥¹M¡••Ð¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ÕÁ½µ¥¹M¡••Ðœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸¡”¤ì(€€€¥˜€¡”¹Ñ…É•Ð¹¥€ôôô€ÕÁ½µ¥¹M¡••Ðœ¤±½Í•UÁ½µ¥¹M¡••Ð ¤ì(€ô¤ì(€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹ÕÀµ™¥±Ñ•Èµ‰Ñ¸œ¤¹™½É… ¡™Õ¹Ñ¥½¸¡‰Ñ¸¤ì(€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€€€ÍÑ…Ñ”¹ÕÁ½µ¥¹¥±Ñ•È€ô‰Ñ¸¹‘…Ñ…Í•Ð¹ÕÁ¥±Ñ•Èì(€€€€€É•¹‘•ÉUÁ½µ¥¹M¡••Ð ¤ì(€€€ô¤ì(€ô¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹±½Í•…åM¡••Ðœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°±½Í•…åM¡••Ð¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘…åM¡••Ðœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸¡”¤ì(€€€¥˜€¡”¹Ñ…É•Ð¹¥€ôôô€‘…åM¡••Ðœ¤±½Í•…åM¡••Ð ¤ì(€ô¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹M¡••ÑAÉ•Ù…äœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ìÍ¡¥™ÑM•±•Ñ•‘…ä ´Ä¤ìô¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹M¡••Ñ9•áÑ…äœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ìÍ¡¥™ÑM•±•Ñ•‘…ä Ä¤ìô¤ì(€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹ÅÕ¥¬µ…‘µ‰Ñ¸œ¤¹™½É… ¡™Õ¹Ñ¥½¸¡‰Ñ¸¤ì(€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì½Á•¹5½‘…±]¥Ñ¡5½‘”¡‰Ñ¸¹‘…Ñ…Í•Ð¹ÅÕ¥¬¤ìô¤ì(€ô¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹¥…Éå•Ñ…¥±‘¥Ðœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€¥˜€¡½Á•¹•‘¥…Éå%¤•‘¥Ñ¥…Éä¡½Á•¹•‘¥…Éå%¤ì(€ô¤ì((€½¹ÍÐ‰Ñ¹½¹¸€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹½¹¹•ÑMÕÁ…‰…Í”œ¤ì(€¥˜€¡‰Ñ¹½¹¸¤ì(€€€‰Ñ¹½¹¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ™Õ¹Ñ¥½¸ ¤ì(€€€€€½¹ÍÐÔ€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑMÕÁ…‰…Í•UÉ°œ¤¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€½¹ÍÐ¬€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑMÕÁ…‰…Í•-•äœ¤¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€¥˜€ …Ôñð€…¬¤ìÍ¡½ÝQ½…ÍÐ UI3ªÎð-•ç®–ðƒ®ª£®F@ƒ²‚²ZÐƒ²Žó²ã²jPƒŠr?¾â<œ¤ìÉ•ÑÕÉ¸ìô(€€€€€ÍÑ…Ñ”¹ÍÕÁ…‰…Í•UÉ°€ôÔìÍÑ…Ñ”¹ÍÕÁ…‰…Í•-•ä€ô¬ì(€€€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}ÍÕÁ…‰…Í•}ÕÉ°œ°Ô¤ì(€€€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}ÍÕÁ…‰…Í•}­•äœ°¬¤ì(€€€€€…Ý…¥Ð¥¹¥ÑMÕÁ…‰…Í”¡Ô°¬°ÑÉÕ”¤ì(€€€ô¤ì(€ô(€½¹ÍÐ‰Ñ¹¥Ì€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹¥Í½¹¹•ÑMÕÁ…‰…Í”œ¤ì(€¥˜€¡‰Ñ¹¥Ì¤ì(€€€‰Ñ¹¥Ì¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€€€ÍÑ…Ñ”¹ÍÕÁ…‰…Í•UÉ°€ô€œœìÍÑ…Ñ”¹ÍÕÁ…‰…Í•-•ä€ô€œœì(€€€€€±½…±MÑ½É…”¹É•µ½Ù•%Ñ•´ …±}ÍÕÁ…‰…Í•}ÕÉ°œ¤ì(€€€€€±½…±MÑ½É…”¹É•µ½Ù•%Ñ•´ …±}ÍÕÁ…‰…Í•}­•äœ¤ì(€€€€€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑMÕÁ…‰…Í•UÉ°œ¤¹Ù…±Õ”€ô€œœì(€€€€€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑMÕÁ…‰…Í•-•äœ¤¹Ù…±Õ”€ô€œœì(€€€€€¥˜€¡É•…±Ñ¥µ•¡…¹¹•°¤ìÉ•…±Ñ¥µ•¡…¹¹•°¹Õ¹ÍÕ‰ÍÉ¥‰” ¤ìÉ•…±Ñ¥µ•¡…¹¹•°€ô¹Õ±°ìô(€€€€€ÍÕÁ…‰…Í•±¥•¹Ð€ô¹Õ±°ì(€€€€€ÕÁ‘…Ñ•MÕÁ…‰…Í•	…‘” ½™™±¥¹”œ°€ŸŠj¨ƒ®†s²î°ƒ²‚²z”ƒ®ª£®Npœ°€‰œµÍ±…Ñ”´ÄÀÀÑ•áÐµÍ±…Ñ”´ÔÀÀœ¤ì(€€€€€Í¡½ÝQ½…ÍÐ Ÿ².“².sªÂƒ²^ÃªÊÃ²vƒ¶VÓ²‚s¶Z#²ZÓ²jPœ¤ì(€€€ô¤ì(€ô(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹áÁ½ÉÑ	…­ÕÀœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°•áÁ½ÉÑ	…­ÕÀ¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑ%µÁ½ÉÑ	…­ÕÀœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°™Õ¹Ñ¥½¸¡”¤ì(€€€½¹ÍÐ™¥±”€ô”¹Ñ…É•Ð¹™¥±•Ì€˜˜”¹Ñ…É•Ð¹™¥±•ÍlÁtì(€€€”¹Ñ…É•Ð¹Ù…±Õ”€ô€œœì(€€€¥˜€¡™¥±”¤¥µÁ½ÉÑ	…­ÕÀ¡™¥±”¤ì(€ô¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹M…Ù•9…µ•Ìœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€½¹ÍÐ €ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑ!ÕÍ‰…¹‘9…µ”œ¤¹Ù…±Õ”¹ÑÉ¥´ ¤ñð€Ÿ®
£¶:àœì(€€€½¹ÍÐÜ€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑ]¥™•9…µ”œ¤¹Ù…±Õ”¹ÑÉ¥´ ¤ñð€Ÿ²V®
Ðœì(€€€ÍÑ…Ñ”¹¡ÕÍ‰…¹‘9…µ”€ô ì(€€€ÍÑ…Ñ”¹Ý¥™•9…µ”€ôÜì(€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}¹…µ•}¡ÕÍ‰…¹œ° ¤ì(€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}¹…µ•}Ý¥™”œ°Ü¤ì(€€€É•¹‘•É1••¹ ¤ì(€€€ÕÁ‘…Ñ•=Ý¹•É	ÕÑÑ½¹Ì ¤ì(€€€É•¹‘•ÉM•±•Ñ•‘…Ñ•Y¥•Ü ¤ì(€€€Í¡½ÝQ½…ÍÐ Ÿ²vÓ®š²vƒ²‚²z—¶Z#²ZÓ²jP„ƒÂ~JDœ¤ì(€ô¤ì(€€¼¼ƒ¶V€ƒ²vðƒ®æƒ®–àƒ²ÚSªÂ €¡¹Ñ•Ë®†pƒ²^Ã²4ƒ²z®‚”¤(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% Ñ½‘½EÕ¥­‘‘½É´œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ÍÕ‰µ¥Ðœ°€¡”¤€ôøì(€€€”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€½¹ÍÐ¥¹ÁÕÐ€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% Ñ½‘½EÕ¥­%¹ÁÕÐœ¤ì(€€€½¹ÍÐÑ¥Ñ±”€ô¥¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€¥˜€ …Ñ¥Ñ±”¤É•ÑÕÉ¸ì(€€€½¹ÍÐ¹•ÝQ½‘¼€ôì¥è…Ñ”¹¹½Ü ¤¹Ñ½MÑÉ¥¹œ ¤°Ñ¥Ñ±”èÑ¥Ñ±”°¥Í½µÁ±•Ñ•è™…±Í”°‘Õ•…Ñ”è™½Éµ…Ñ…Ñ”¡¹•Ü…Ñ” ¤¤ôì(€€€ÍÑ…Ñ”¹Ñ½‘½Ì¹ÁÕÍ ¡¹•ÝQ½‘¼¤ì(€€€Í…Ù•Q½‘½Ì ¤ì(€€€ÁÕÍ¡I•µ½Ñ•Q½‘¼ ¥¹Í•ÉÐœ°¹•ÝQ½‘¼¤ì(€€€É•¹‘•ÉQ½‘½Ì ¤ì(€€€¥¹ÁÕÐ¹Ù…±Õ”€ô€œœì(€€€¥¹ÁÕÐ¹™½ÕÌ ¤ì(€ô¤ì((€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹Q½±•½µÁ±•Ñ•‘Q½‘½Ìœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€ÍÑ…Ñ”¹Í¡½Ý½µÁ±•Ñ•‘Q½‘½Ì€ô€…ÍÑ…Ñ”¹Í¡½Ý½µÁ±•Ñ•‘Q½‘½Ìì(€€€É•¹‘•ÉQ½‘½Ì ¤ì(€ô¤ì((€€¼¼ƒ®.“²vÓ²ZÓ®š°ƒªÊ²$€˜ƒ²nPƒ²vÓ®>d(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…ÉåM•…É¡%¹ÁÕÐœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¥¹ÁÕÐœ°€¡”¤€ôøì(€€€ÍÑ…Ñ”¹‘¥…ÉåM•…É €ô”¹Ñ…É•Ð¹Ù…±Õ”ì(€€€É•¹‘•É±±¥…É¥•Ì ¤ì(€ô¤ì((€½¹ÍÐÍ¡¥™Ñ¥…Éå5½¹Ñ €ô€¡‘•±Ñ„¤€ôøì(€€€½¹ÍÐ‰…Í”€ôÍÑ…Ñ”¹‘¥…Éå¥±Ñ•Ée4ñð™½Éµ…Ñ…Ñ”¡¹•Ü…Ñ” ¤¤¹Í±¥” À°€Ü¤ì(€€€½¹ÍÐ‰À€ô‰…Í”¹ÍÁ±¥Ð œ´œ¤¹µ…À¡9Õµ‰•È¤ì(€€€½¹ÍÐ€ô¹•Ü…Ñ”¡‰ÁlÁt°‰ÁlÅt€´€Ä€¬‘•±Ñ„°€Ä¤ì(€€€ÍÑ…Ñ”¹‘¥…Éå¥±Ñ•Ée4€ô¹•ÑÕ±±e•…È ¤€¬€œ´œ€¬MÑÉ¥¹œ¡¹•Ñ5½¹Ñ  ¤€¬€Ä¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€É•¹‘•É±±¥…É¥•Ì ¤ì(€ôì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹¥…ÉåAÉ•Ù5½¹Ñ œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡¥™Ñ¥…Éå5½¹Ñ  ´Ä¤¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹¥…Éå9•áÑ5½¹Ñ œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡¥™Ñ¥…Éå5½¹Ñ  Ä¤¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹¥…Éå±±Q½±”œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€ÍÑ…Ñ”¹‘¥…Éå¥±Ñ•Ée4€ôÍÑ…Ñ”¹‘¥…Éå¥±Ñ•Ée4€ü¹Õ±°€è™½Éµ…Ñ…Ñ”¡¹•Ü…Ñ” ¤¤¹Í±¥” À°€Ü¤ì(€€€É•¹‘•É±±¥…É¥•Ì ¤ì(€ô¤ì((€€¼¼ƒ²vóªâÀƒ²²àƒ®ÎÓªâÀƒ®.¯ªâÀ€¼ƒ²
·²‚p(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹¥…Éå•Ñ…¥±±½Í”œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°±½Í•¥…Éå•Ñ…¥°¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘¥…Éå•Ñ…¥±5½‘…°œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€¡”¤€ôøì(€€€¥˜€¡”¹Ñ…É•Ð¹¥€ôôô€‘¥…Éå•Ñ…¥±5½‘…°œ¤±½Í•¥…Éå•Ñ…¥° ¤ì(€ô¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹¥…Éå•Ñ…¥±•±•Ñ”œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€¥˜€ …½Á•¹•‘¥…Éå%¤É•ÑÕÉ¸ì(€€€½¹ÍÐ¥€ô½Á•¹•‘¥…Éå%ì(€€€±½Í•¥…Éå•Ñ…¥° ¤ì(€€€‘•±•Ñ•¥…Éä¡¥¤ì(€ô¤ì(€€¼¼ƒ®.³®‚”ƒ²V{®J“®†pƒ®cªâÃªâÀ€£²vÓ®Ê ƒ²Žó®ž0ƒ®Îðƒ®V3®*Pƒ¶Vpƒ²Žó²R¤¤(€½¹ÍÐµ½Ù•…±•¹‘…È€ô™Õ¹Ñ¥½¸¡‘•±Ñ„¤ì(€€€¥˜€¡ÍÑ…Ñ”¹…±•¹‘…ÉY¥•Ü€ôôô€Ý••¬œ¤ì(€€€€€½¹ÍÐÀ€ôÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”¹ÍÁ±¥Ð œ´œ¤¹µ…À¡9Õµ‰•È¤ì(€€€€€½¹ÍÐ€ô¹•Ü…Ñ”¡ÁlÁt°ÁlÅt€´€Ä°ÁlÉt€¬‘•±Ñ„€¨€Ü¤ì(€€€€€ÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”€ô™½Éµ…Ñ…Ñ”¡¤ì(€€€€€ÍÑ…Ñ”¹ÕÉÉ•¹Ñe•…È€ô¹•ÑÕ±±e•…È ¤ì(€€€€€ÍÑ…Ñ”¹ÕÉÉ•¹Ñ5½¹Ñ €ô¹•Ñ5½¹Ñ  ¤ì(€€€€€É•¹‘•ÉM•±•Ñ•‘…Ñ•Y¥•Ü ¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐ€ô¹•Ü…Ñ”¡ÍÑ…Ñ”¹ÕÉÉ•¹Ñe•…È°ÍÑ…Ñ”¹ÕÉÉ•¹Ñ5½¹Ñ €¬‘•±Ñ„°€Ä¤ì(€€€€€ÍÑ…Ñ”¹ÕÉÉ•¹Ñe•…È€ô¹•ÑÕ±±e•…È ¤ì(€€€€€ÍÑ…Ñ”¹ÕÉÉ•¹Ñ5½¹Ñ €ô¹•Ñ5½¹Ñ  ¤ì(€€€ô(€€€É•¹‘•É…±•¹‘…È ¤ì(€ôì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹AÉ•Ù5½¹Ñ œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ìµ½Ù•…±•¹‘…È ´Ä¤ìô¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹9•áÑ5½¹Ñ œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ìµ½Ù•…±•¹‘…È Ä¤ìô¤ì(€€¼¼ƒ®.³®‚—²vƒ²b²ró®†pƒ®Â²ZÓ²pƒ®.°ƒ®ÂSªúãªâÀ(€±•ÐÑ½Õ¡`€ô€Àì(€±•ÐÑ½Õ¡d€ô€Àì(€…±•¹‘…É…åÍÉ¥¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Ñ½Õ¡ÍÑ…ÉÐœ°™Õ¹Ñ¥½¸¡”¤ì(€€€Ñ½Õ¡`€ô”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`ì(€€€Ñ½Õ¡d€ô”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñdì(€ô°ìÁ…ÍÍ¥Ù”èÑÉÕ”ô¤ì(€…±•¹‘…É…åÍÉ¥¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Ñ½Õ¡•¹œ°™Õ¹Ñ¥½¸¡”¤ì(€€€½¹ÍÐ‘à€ô”¹¡…¹•‘Q½Õ¡•ÍlÁt¹±¥•¹Ñ`€´Ñ½Õ¡`ì(€€€½¹ÍÐ‘ä€ô”¹¡…¹•‘Q½Õ¡•ÍlÁt¹±¥•¹Ñd€´Ñ½Õ¡dì(€€€¥˜€¡5…Ñ ¹…‰Ì¡‘à¤€ø€ÔÀ€˜˜5…Ñ ¹…‰Ì¡‘à¤€ø5…Ñ ¹…‰Ì¡‘ä¤€¨€Ä¸Ô¤ì(€€€€€ÍÑ…Ñ”¹±…ÍÑMÝ¥Á”€ô…Ñ”¹¹½Ü ¤ì(€€€€€µ½Ù•…±•¹‘…È¡‘à€ð€À€ü€Ä€è€´Ä¤ì(€€€ô(€ô¤ì((€€¼¼ƒ²vÓ®Ê ƒ²Žó®ž0ƒ®ÎÓªâÀ€¼ƒ¶Vpƒ®.°ƒ®.ƒ®ÎÓªâÀ(€‰Ñ¹Q½±•…±•¹‘…ÉY¥•Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€¥˜€¡ÍÑ…Ñ”¹…±•¹‘…ÉY¥•Ü€ôôô€µ½¹Ñ œ¤ì(€€€€€ÍÑ…Ñ”¹…±•¹‘…ÉY¥•Ü€ô€Ý••¬œì(€€€€€½¹ÍÐÀ€ôÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”¹ÍÁ±¥Ð œ´œ¤¹µ…À¡9Õµ‰•È¤ì(€€€€€ÍÑ…Ñ”¹ÕÉÉ•¹Ñe•…È€ôÁlÁtì(€€€€€ÍÑ…Ñ”¹ÕÉÉ•¹Ñ5½¹Ñ €ôÁlÅt€´€Äì(€€€€€Ñ½±•Y¥•Ý%½¸¹±…ÍÍ9…µ”€ô€™„µÍ½±¥™„µ•áÁ…¹Ñ•áÐµlÄÁÁátœì(€€€€€Ñ½±•Y¥•ÝQ•áÐ¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ¶Vpƒ®.°ƒ®ÎÓªâÀœì(€€€ô•±Í”ì(€€€€€ÍÑ…Ñ”¹…±•¹‘…ÉY¥•Ü€ô€µ½¹Ñ œì(€€€€€Ñ½±•Y¥•Ý%½¸¹±…ÍÍ9…µ”€ô€™„µÍ½±¥™„µ½µÁÉ•ÍÌÑ•áÐµlÄÁÁátœì(€€€€€Ñ½±•Y¥•ÝQ•áÐ¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ²vÓ®Ê ƒ²Žó®ž0œì(€€€ô(€€€É•¹‘•É…±•¹‘…È ¤ì(€ô¤ì(((€¥¹ÁÕÑ	A¡½Ñ¼¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°…Íå¹Œ™Õ¹Ñ¥½¸¡”¤ì(€€€½¹ÍÐ™¥±”€ô”¹Ñ…É•Ð¹™¥±•Ì€˜˜”¹Ñ…É•Ð¹™¥±•ÍlÁtì(€€€”¹Ñ…É•Ð¹Ù…±Õ”€ô€œœì(€€€¥˜€ …™¥±”¤É•ÑÕÉ¸ì(€€€ÍÑ…Ñ”¹‰A¡½Ñ¼€ô…Ý…¥Ð½µÁÉ•ÍÍ%µ…”¡™¥±”°€ÄØÀÀ°€À¸à¤ì(€€€…ÁÁ±åUÍ•É	A¡½Ñ¼ ¤ì(€€€ÑÉäì(€€€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}‰}Á¡½Ñ¼œ°ÍÑ…Ñ”¹‰A¡½Ñ¼¤ì(€€€€€Í¡½ÝQ½…ÍÐ Ÿ®ÂÃªÊôƒ²
³²ž²vƒ®ÂSªþ£²ZÓ²jP„ƒÂ~Zó¾â<œ¤ì(€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€Í¡½ÝQ½…ÍÐ Ÿ²
³²ž²vÐƒ®#®²Ðƒ²î“²pƒ²‚²z—¶Vc²ž ƒ®ªï¶Z#²ZÓ²jPƒÂ~b”œ¤ì(€€€ô(€ô¤ì((€‰Ñ¹I•µ½Ù•	A¡½Ñ¼¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€ÍÑ…Ñ”¹‰A¡½Ñ¼€ô¹Õ±°ì(€€€±½…±MÑ½É…”¹É•µ½Ù•%Ñ•´ …±}‰}Á¡½Ñ¼œ¤ì(€€€…ÁÁ±åUÍ•É	A¡½Ñ¼ ¤ì(€€€Í¡½ÝQ½…ÍÐ Ÿ²nC®z`ƒ®ÂÃªÊ÷²ró®†pƒ®>3²V²fS²ZÓ²jPœ¤ì(€ô¤ì((€É…¹•	=Á…¥Ñä¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¥¹ÁÕÐœ°€¡”¤€ôøì(€€€ÍÑ…Ñ”¹‰=Á…¥Ñä€ô”¹Ñ…É•Ð¹Ù…±Õ”ì(€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}‰}½Á…¥Ñäœ°ÍÑ…Ñ”¹‰=Á…¥Ñä¤ì(€€€‘½Õµ•¹Ð¹‘½Õµ•¹Ñ±•µ•¹Ð¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä œ´µ‰œµ½Á…¥Ñäœ°€¡Á…ÉÍ•%¹Ð¡ÍÑ…Ñ”¹‰=Á…¥Ñä¤€¼€ÄÀÀ¤¹Ñ½MÑÉ¥¹œ ¤¤ì(€ô¤ì((€É…¹•		±ÕÈ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¥¹ÁÕÐœ°€¡”¤€ôøì(€€€ÍÑ…Ñ”¹‰	±ÕÈ€ô”¹Ñ…É•Ð¹Ù…±Õ”ì(€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}‰}‰±ÕÈœ°ÍÑ…Ñ”¹‰	±ÕÈ¤ì(€€€‘½Õµ•¹Ð¹‘½Õµ•¹Ñ±•µ•¹Ð¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä œ´µ‰œµ‰±ÕÈœ°€‘íÍÑ…Ñ”¹‰	±ÕÉõÁá€¤ì(€ô¤ì((€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹EÕ¥­Q¡•µ”œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€ÍÝ¥Ñ¡Q…ˆ Ñ…‰M•ÑÑ¥¹Ìœ¤ì(€ô¤ì((€Ñ…‰	Ñ¹Ì¹™½É… ¡‰Ñ¸€ôøì(€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€ÍÝ¥Ñ¡Q…ˆ¡‰Ñ¸¹‘…Ñ…Í•Ð¹Ñ…É•Ð¤ì(€€€ô¤ì(€ô¤ì((€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹=Á•¹…å¥…Éäœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€½Á•¹5½‘…±]¥Ñ¡5½‘” ‘¥…Éäœ¤ì(€ô¤ì((€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹Ñ¡•µ”µÁÉ•Í•Ðµ‰Ñ¸œ¤¹™½É… ¡‰Ñ¸€ôøì(€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€Í•±•ÑAÉ•Í•ÑQ¡•µ”¡‰Ñ¸¹‘…Ñ…Í•Ð¹Ñ¡•µ”¤ì(€€€ô¤ì(€ô¤ì((€ÕÍÑ½µ½±½ÉA¥­•È¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¥¹ÁÕÐœ°€¡”¤€ôøì(€€€Í•±•ÑÕÍÑ½µ½±½È¡”¹Ñ…É•Ð¹Ù…±Õ”¤ì(€ô¤ì((€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹µ½½µ‰Ñ¸œ¤¹™½É… ¡‰Ñ¸€ôøì(€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹µ½½µ‰Ñ¸œ¤¹™½É… ¡ˆ€ôøˆ¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” É¥¹œ´Èœ°€É¥¹œµ¥¹‘¥¼´ÔÀÀœ¤¤ì(€€€€€‰Ñ¸¹±…ÍÍ1¥ÍÐ¹…‘ É¥¹œ´Èœ°€É¥¹œµ¥¹‘¥¼´ÔÀÀœ¤ì(€€€€€ÍÑ…Ñ”¹Í•±•Ñ•‘5½½€ô‰Ñ¸¹‘…Ñ…Í•Ð¹µ½½ì(€€€ô¤ì(€ô¤ì((€¥¹ÁÕÑ5•‘¥…¥±•Ì¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°…Íå¹Œ™Õ¹Ñ¥½¸¡”¤ì(€€€½¹ÍÐ™¥±•Ì€ôÉÉ…ä¹™É½´¡”¹Ñ…É•Ð¹™¥±•Ìñðmt¤ì(€€€”¹Ñ…É•Ð¹Ù…±Õ”€ô€œœì(€€€¥˜€ …™¥±•Ì¹±•¹Ñ ¤É•ÑÕÉ¸ì(€€€µ•‘¥…½Õ¹ÑQ•áÐ¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ²
³²žƒ²’®æƒ²’D¸¸¸œì(€€€±•ÐÍ­¥ÁÁ•€ô€Àì(€€€™½È€¡½¹ÍÐ™¥±”½˜™¥±•Ì¤ì(€€€€€½¹ÍÐ¥€ô…Ñ”¹¹½Ü ¤¹Ñ½MÑÉ¥¹œ ¤€¬5…Ñ ¹É…¹‘½´ ¤¹Ñ½MÑÉ¥¹œ ÌØ¤¹Í±¥” È°€Ø¤ì(€€€€€¥˜€¡™¥±”¹ÑåÁ”¹ÍÑ…ÉÑÍ]¥Ñ  Ù¥‘•¼œ¤¤ì(€€€€€€€¥˜€¡™¥±”¹Í¥é”€ø€Ì€¨€ÄÀÈÐ€¨€ÄÀÈÐ¤ìÍ­¥ÁÁ•¬¬ì½¹Ñ¥¹Õ”ìô(€€€€€€€ÍÑ…Ñ”¹Ñ•µÁ5•‘¥…¥±•Ì¹ÁÕÍ ¡ì¥è¥°ÑåÁ”è€Ù¥‘•¼œ°¹…µ”è™¥±”¹¹…µ”°ÕÉ°è…Ý…¥ÐÉ•…‘¥±•Í…Ñ…UI0¡™¥±”¤ô¤ì(€€€€€ô•±Í”ì(€€€€€€€ÍÑ…Ñ”¹Ñ•µÁ5•‘¥…¥±•Ì¹ÁÕÍ ¡ì¥è¥°ÑåÁ”è€¥µ…”œ°¹…µ”è™¥±”¹¹…µ”°ÕÉ°è…Ý…¥Ð½µÁÉ•ÍÍ%µ…”¡™¥±”°€ÄÈàÀ°€À¸àÈ¤ô¤ì(€€€€€ô(€€€ô(€€€É•¹‘•É5•‘¥…AÉ•Ù¥•ÝÌ ¤ì(€€€¥˜€¡Í­¥ÁÁ•¤Í¡½ÝQ½…ÍÐ Ÿ®>g²b²²v €Í5ƒ²vÓ¶Vc®ž0ƒ®²vƒ²"`ƒ²z#²ZÓ²jP€ œ€¬Í­¥ÁÁ•€¬€ŸªÂpƒ®êC²ZÓ²jP¤œ¤ì(€ô¤ì((€‰Ñ¹=Á•¹‘‘5½‘…°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°½Á•¹¡½½Í•È¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹±½Í•¡½½Í•Èœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°±½Í•¡½½Í•È¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¡½½Í•É5½‘…°œ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸¡”¤ì(€€€¥˜€¡”¹Ñ…É•Ð¹¥€ôôô€¡½½Í•É5½‘…°œ¤±½Í•¡½½Í•È ¤ì(€ô¤ì(€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹¡½½Í”µ‰Ñ¸œ¤¹™½É… ¡™Õ¹Ñ¥½¸¡‰Ñ¸¤ì(€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€€€±½Í•¡½½Í•È ¤ì(€€€€€½Á•¹5½‘…±]¥Ñ¡5½‘”¡‰Ñ¸¹‘…Ñ…Í•Ð¹¡½½Í”¤ì(€€€ô¤ì(€ô¤ì((€‰Ñ¹±½Í•‘‘5½‘…°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°±½Í•‘‘5½‘…°¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹	…­Q½¡½½Í•Èœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€±½Í•‘‘5½‘…° ¤ì(€€€½Á•¹¡½½Í•È ¤ì(€ô¤ì((€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹½Ý¹•Èµ‰Ñ¸œ¤¹™½É… ¡™Õ¹Ñ¥½¸¡‰Ñ¸¤ì(€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€€€ÍÑ…Ñ”¹Í•±•Ñ•‘=Ý¹•È€ô‰Ñ¸¹‘…Ñ…Í•Ð¹½Ý¹•Èì(€€€€€ÕÁ‘…Ñ•=Ý¹•É	ÕÑÑ½¹Ì ¤ì(€€€ô¤ì(€ô¤ì((€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹Ñ¥µ”µÁÉ•Í•Ðµ‰Ñ¸œ¤¹™½É… ¡™Õ¹Ñ¥½¸¡‰Ñ¸¤ì(€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€€€ÍÑ…Ñ”¹Í•±•Ñ•‘Q¥µ”€ô‰Ñ¸¹‘…Ñ…Í•Ð¹Ñ¥µ”ì(€€€€€ÕÁ‘…Ñ•Q¥µ•	ÕÑÑ½¹Ì ¤ì(€€€ô¤ì(€ô¤ì((€‰Ñ¹MÕ‰µ¥Ñ%Ñ•´¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°™Õ¹Ñ¥½¸ ¤ì(€€€½¹ÍÐÑ•áÑY…°€ô¥¹ÁÕÑ%Ñ•µQ¥Ñ±”¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€½¹ÍÐµ½‘”€ôÍÑ…Ñ”¹µ½‘…±QåÁ”ì(€€€¥˜€ …Ñ•áÑY…°€˜˜€¡µ½‘”€„ôô€‘¥…ÉäœñðÍÑ…Ñ”¹Ñ•µÁ5•‘¥…¥±•Ì¹±•¹Ñ €ôôô€À¤¤ì(€€€€€¥¹ÁÕÑ%Ñ•µQ¥Ñ±”¹™½ÕÌ ¤ì(€€€€€Í¡½ÝQ½…ÍÐ Ÿ®
Ó²j§²vƒ®¢ó²‚ ƒ²‚²ZÐƒ²Žó²ã²jPƒŠr?¾â<œ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍÐ‘…Ñ•Y…°€ô¥¹ÁÕÑ%Ñ•µ…Ñ”¹Ù…±Õ”ñðÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”ì(€€€½¹ÍÐ•‘¥Ñ¥¹œ€ôÍÑ…Ñ”¹•‘¥Ñ¥¹%ì((€€€¥˜€¡µ½‘”€ôôô€•Ù•¹Ðœ¤ì(€€€€€±•ÐÑ¥µ•Y…°€ôÍÑ…Ñ”¹Í•±•Ñ•‘Q¥µ”ì(€€€€€¥˜€¡Ñ¥µ•Y…°€ôôô€…±±‘…äœ¤Ñ¥µ•Y…°€ô€œœì(€€€€€•±Í”¥˜€¡Ñ¥µ•Y…°€ôôô€ÕÍÑ½´œ¤Ñ¥µ•Y…°€ô¥¹ÁÕÑ%Ñ•µQ¥µ”¹Ù…±Õ”ñð€œœì(€€€€€½¹ÍÐÉ…Ý¹€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑ%Ñ•µ¹‘…Ñ”œ¤¹Ù…±Õ”ñð‘…Ñ•Y…°ì(€€€€€½¹ÍÐ•¹‘…Ñ•Y…°€ôÉ…Ý¹€øô‘…Ñ•Y…°€üÉ…Ý¹€è‘…Ñ•Y…°ì(€€€€€½¹ÍÐ‘…Ñ„€ôìÑ¥Ñ±”èÑ•áÑY…°°‘…Ñ”è‘…Ñ•Y…°°•¹‘…Ñ”è•¹‘…Ñ•Y…°°Ñ¥µ”èÑ¥µ•Y…°°½Ý¹•ÈèÍÑ…Ñ”¹Í•±•Ñ•‘=Ý¹•È°É•Á•…ÐèÍÑ…Ñ”¹Í•±•Ñ•‘I•Á•…Ðñð€¹½¹”œ°½±½Èè=]9I}=1=IMmÍÑ…Ñ”¹Í•±•Ñ•‘=Ý¹•Étôì(€€€€€½¹ÍÐ•á¥ÍÑ¥¹œ€ô•‘¥Ñ¥¹œ€üÍÑ…Ñ”¹•Ù•¹ÑÌ¹™¥¹¡™Õ¹Ñ¥½¸¡”¤ìÉ•ÑÕÉ¸”¹¥€ôôô•‘¥Ñ¥¹œìô¤€è¹Õ±°ì(€€€€€¥˜€¡•á¥ÍÑ¥¹œ¤=‰©•Ð¹…ÍÍ¥¸¡•á¥ÍÑ¥¹œ°‘…Ñ„¤ì(€€€€€•±Í”ÍÑ…Ñ”¹•Ù•¹ÑÌ¹ÁÕÍ ¡=‰©•Ð¹…ÍÍ¥¸¡ì¥è…Ñ”¹¹½Ü ¤¹Ñ½MÑÉ¥¹œ ¤ô°‘…Ñ„¤¤ì(€€€€€Í…Ù•Ù•¹ÑÌ ¤ì(€€€€€ÁÕÍ¡I•µ½Ñ•Ù•¹Ð¡•á¥ÍÑ¥¹œ€ü€ÕÁ‘…Ñ”œ€è€¥¹Í•ÉÐœ°•á¥ÍÑ¥¹œñðÍÑ…Ñ”¹•Ù•¹ÑÍmÍÑ…Ñ”¹•Ù•¹ÑÌ¹±•¹Ñ €´€Åt¤ì(€€€€€±½Í•‘‘5½‘…° ¤ì(€€€€€ÍÝ¥Ñ¡Q…ˆ Ñ…‰…±•¹‘…Èœ¤ì(€€€€€½Q½…Ñ”¡‘…Ñ•Y…°¤ì(€€€€€½Á•¹…åM¡••Ð ¤ì(€€€€€Í¡½ÝQ½…ÍÐ¡•á¥ÍÑ¥¹œ€ü€Ÿ²V÷²7²vƒªÎƒ²Î“²ZÓ²jP„ƒŠr?¾â<œ€è€Ÿ²V÷²7²vƒ²‚²z—¶Z#²ZÓ²jP„ƒÂ~:$œ¤ì(€€€ô•±Í”¥˜€¡µ½‘”€ôôô€Ñ½‘¼œ¤ì(€€€€€ÍÑ…Ñ”¹Ñ½‘½Ì¹ÁÕÍ ¡ì¥è…Ñ”¹¹½Ü ¤¹Ñ½MÑÉ¥¹œ ¤°Ñ¥Ñ±”èÑ•áÑY…°°¥Í½µÁ±•Ñ•è™…±Í”°‘Õ•…Ñ”è‘…Ñ•Y…°ô¤ì(€€€€€Í…Ù•Q½‘½Ì ¤ì(€€€€€ÁÕÍ¡I•µ½Ñ•Q½‘¼ ¥¹Í•ÉÐœ°ÍÑ…Ñ”¹Ñ½‘½ÍmÍÑ…Ñ”¹Ñ½‘½Ì¹±•¹Ñ €´€Åt¤ì(€€€€€±½Í•‘‘5½‘…° ¤ì(€€€€€±½Í•…åM¡••Ð ¤ì(€€€€€É•¹‘•ÉQ½‘½Ì ¤ì(€€€€€ÍÝ¥Ñ¡Q…ˆ Ñ…‰Q½‘½Ìœ¤ì(€€€€€Í¡½ÝQ½…ÍÐ Ÿ¶V€ƒ²vó²vƒ®²^#²ZÓ²jP„ƒŠrœ¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÁÉ•Ù¥…É¥•Ì€ôÍÑ…Ñ”¹‘¥…É¥•Ì¹µ…À¡™Õ¹Ñ¥½¸¡à¤ìÉ•ÑÕÉ¸=‰©•Ð¹…ÍÍ¥¸¡íô°à¤ìô¤ì(€€€€€½¹ÍÐ‘…Ñ„€ôì‘…Ñ”è‘…Ñ•Y…°°µ½½èÍÑ…Ñ”¹Í•±•Ñ•‘5½½°½¹Ñ•¹ÐèÑ•áÑY…°°µ•‘¥„èÍÑ…Ñ”¹Ñ•µÁ5•‘¥…¥±•Ì¹Í±¥” ¤ôì(€€€€€½¹ÍÐ•á¥ÍÑ¥¹œ€ô•‘¥Ñ¥¹œ€üÍÑ…Ñ”¹‘¥…É¥•Ì¹™¥¹¡™Õ¹Ñ¥½¸¡¤ìÉ•ÑÕÉ¸¹¥€ôôô•‘¥Ñ¥¹œìô¤€è¹Õ±°ì(€€€€€¥˜€¡•á¥ÍÑ¥¹œ¤=‰©•Ð¹…ÍÍ¥¸¡•á¥ÍÑ¥¹œ°‘…Ñ„¤ì(€€€€€•±Í”ÍÑ…Ñ”¹‘¥…É¥•Ì¹ÁÕÍ ¡=‰©•Ð¹…ÍÍ¥¸¡ì¥è…Ñ”¹¹½Ü ¤¹Ñ½MÑÉ¥¹œ ¤°É•…Ñ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ô°‘…Ñ„¤¤ì(€€€€€¥˜€ …Í…Ù•¥…É¥•Ì ¤¤ì(€€€€€€€ÍÑ…Ñ”¹‘¥…É¥•Ì€ôÁÉ•Ù¥…É¥•Ìì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€ÁÕÍ¡I•µ½Ñ•¥…Éä¡•á¥ÍÑ¥¹œ€ü€ÕÁ‘…Ñ”œ€è€¥¹Í•ÉÐœ°•á¥ÍÑ¥¹œñðÍÑ…Ñ”¹‘¥…É¥•ÍmÍÑ…Ñ”¹‘¥…É¥•Ì¹±•¹Ñ €´€Åt¤ì(€€€€€±½Í•‘‘5½‘…° ¤ì(€€€€€É•¹‘•É±±¥…É¥•Ì ¤ì(€€€€€ÍÝ¥Ñ¡Q…ˆ Ñ…‰…±•¹‘…Èœ¤ì(€€€€€½Q½…Ñ”¡‘…Ñ•Y…°¤ì(€€€€€½Á•¹…åM¡••Ð ¤ì(€€€€€Í¡½ÝQ½…ÍÐ¡•á¥ÍÑ¥¹œ€ü€Ÿ²vóªâÃ®–ðƒªÎƒ²Î“²ZÓ²jP„ƒŠr?¾â<œ€è€Ÿ²vóªâÃ®–ðƒ²‚²z—¶Z#²ZÓ²jP„ƒÂ~NXœ¤ì(€€€ô(€ô¤ì((€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹M…Ù•¹¹¥Ù•ÉÍ…Éäœ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€½¹ÍÐ…¹¹¥Ø€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑ¹¹¥Ù•ÉÍ…Éäœ¤¹Ù…±Õ”ì(€€€¥˜€¡…¹¹¥Ø¤ì(€€€€€ÍÑ…Ñ”¹…¹¹¥Ù•ÉÍ…Éå…Ñ”€ô…¹¹¥Øì(€€€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}…¹¹¥Ù•ÉÍ…Éäœ°…¹¹¥Ø¤ì(€€€€€ÕÁ‘…Ñ•…å	…‘” ¤ì(€€€€€Í¡½ÝQ½…ÍÐ ŸªâÃ®C²vó²vƒ²‚²z—¶Z#²ZÓ²jP„ƒÂ~J4œ¤ì(€€€ô(€ô¤ì)ô()™Õ¹Ñ¥½¸É•¹‘•É5•‘¥…AÉ•Ù¥•ÝÌ ¤ì(€µ•‘¥…AÉ•Ù¥•ÝÉ¥¹¥¹¹•É!Q50€ô€œœì(€µ•‘¥…½Õ¹ÑQ•áÐ¹Ñ•áÑ½¹Ñ•¹Ð€ôÍÑ…Ñ”¹Ñ•µÁ5•‘¥…¥±•Ì¹±•¹Ñ €üÍÑ…Ñ”¹Ñ•µÁ5•‘¥…¥±•Ì¹±•¹Ñ €¬€ŸªÂpƒªÎ£®zC²ZÓ²jPœ€è€Ÿ²V²žƒ²^²ZÓ²jPœì((€ÍÑ…Ñ”¹Ñ•µÁ5•‘¥…¥±•Ì¹™½É…  ¡´°¥‘à¤€ôøì(€€€½¹ÍÐÝÉ…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€ÝÉ…À¹±…ÍÍ9…µ”€ô€Ü´ÄÐ ´ÄÐÉ½Õ¹‘•µ±œ½Ù•É™±½Üµ¡¥‘‘•¸‰œµÍ±…Ñ”´ÄÀÀ™±•àµÍ¡É¥¹¬´ÀÉ•±…Ñ¥Ù”‰½É‘•È‰½É‘•ÈµÍ±…Ñ”´ÈÀÀœì(€€€¥˜€¡´¹ÑåÁ”€ôôô€Ù¥‘•¼œ¤ì(€€€€€ÝÉ…À¹¥¹¹•É!Q50€ô€(€€€€€€€€ñ‘¥Ø±…ÍÌô‰Üµ™Õ±° µ™Õ±°‰œµÍ±…Ñ”´àÀÀ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑ•áÐµÝ¡¥Ñ”Ñ•áÐµáÌˆø(€€€€€€€€€€ñ¤±…ÍÌô‰™„µÍ½±¥™„µÙ¥‘•¼ˆøð½¤ø(€€€€€€€€ð½‘¥Øø(€€€€€€ì(€€€ô•±Í”ì(€€€€€ÝÉ…À¹¥¹¹•É!Q50€ô€ñ¥µœÍÉŒôˆ‘í´¹ÕÉ±ôˆ±…ÍÌô‰Üµ™Õ±° µ™Õ±°½‰©•Ðµ½Ù•Èˆù€ì(€€€ô(€€€½¹ÍÐ‘•±	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€‘•±	Ñ¸¹±…ÍÍ9…µ”€ô€…‰Í½±ÕÑ”Ñ½À´ÀÉ¥¡Ð´À‰œµ‰±…¬¼ØÀÑ•áÐµÝ¡¥Ñ”Ü´Ð ´ÐÉ½Õ¹‘•µ‰°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑ•áÐµlÄÁÁátœì(€€€‘•±	Ñ¸¹¥¹¹•É!Q50€ô€Ÿ\œì(€€€‘•±	Ñ¸¹½¹±¥¬€ô€ ¤€ôøì(€€€€€ÍÑ…Ñ”¹Ñ•µÁ5•‘¥…¥±•Ì¹ÍÁ±¥”¡¥‘à°€Ä¤ì(€€€€€É•¹‘•É5•‘¥…AÉ•Ù¥•ÝÌ ¤ì(€€€ôì(€€€ÝÉ…À¹…ÁÁ•¹‘¡¥±¡‘•±	Ñ¸¤ì(€€€µ•‘¥…AÉ•Ù¥•ÝÉ¥¹…ÁÁ•¹‘¡¥±¡ÝÉ…À¤ì(€ô¤ì)ô()™Õ¹Ñ¥½¸ÍÝ¥Ñ¡Q…ˆ¡Ñ…É•Ñ%¤ì(€Ñ…‰	Ñ¹Ì¹™½É… ¡ˆ€ôøì(€€€¥˜€¡ˆ¹‘…Ñ…Í•Ð¹Ñ…É•Ð€ôôôÑ…É•Ñ%¤ì(€€€€€ˆ¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” Ñ•áÐµÍ±…Ñ”´ÐÀÀœ¤ì(€€€€€ˆ¹±…ÍÍ1¥ÍÐ¹…‘ Ñ•áÐµÑ¡•µ”µÁÉ¥µ…Éäœ¤ì(€€€ô•±Í”ì(€€€€€ˆ¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” Ñ•áÐµÑ¡•µ”µÁÉ¥µ…Éäœ¤ì(€€€€€ˆ¹±…ÍÍ1¥ÍÐ¹…‘ Ñ•áÐµÍ±…Ñ”´ÐÀÀœ¤ì(€€€ô(€ô¤ì((€=‰©•Ð¹Ù…±Õ•Ì¡Ñ…‰Ì¤¹™½É… ¡Ð€ôøÐ¹±…ÍÍ1¥ÍÐ¹…‘ ¡¥‘‘•¸œ¤¤ì(€Ñ…‰ÍmÑ…É•Ñ%‘t¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ¡¥‘‘•¸œ¤ì(€‰Ñ¹=Á•¹‘‘5½‘…°¹±…ÍÍ1¥ÍÐ¹Ñ½±” ¡¥‘‘•¸œ°Ñ…É•Ñ%€ôôô€Ñ…‰M•ÑÑ¥¹Ìœ¤ì)ô()™Õ¹Ñ¥½¸½Á•¹5½‘…±]¥Ñ¡5½‘”¡µ½‘”¤ì(€ÍÑ…Ñ”¹•‘¥Ñ¥¹%€ô¹Õ±°ì(€¥¹ÁÕÑ%Ñ•µ…Ñ”¹Ù…±Õ”€ôÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ¥¹ÁÕÑ%Ñ•µ¹‘…Ñ”œ¤¹Ù…±Õ”€ôÍÑ…Ñ”¹Í•±•Ñ•‘…Ñ”ì(€ÍÑ…Ñ”¹Í•±•Ñ•‘I•Á•…Ð€ô€¹½¹”œì(€ÕÁ‘…Ñ•I•Á•…Ñ	ÕÑÑ½¹Ì ¤ì(€¥¹ÁÕÑ%Ñ•µQ¥Ñ±”¹Ù…±Õ”€ô€œœì(€ÍÑ…Ñ”¹Ñ•µÁ5•‘¥…¥±•Ì€ômtì(€ÍÑ…Ñ”¹Í•±•Ñ•‘=Ý¹•È€ô€‰½Ñ œì(€ÍÑ…Ñ”¹Í•±•Ñ•‘Q¥µ”€ô€œÄäèÀÀœì(€¥¹ÁÕÑ%Ñ•µQ¥µ”¹Ù…±Õ”€ô€œÄäèÀÀœì(€É•¹‘•É5•‘¥…AÉ•Ù¥•ÝÌ ¤ì(€Í•Ñ5½‘…±5½‘”¡µ½‘”¤ì(€ÕÁ‘…Ñ•=Ý¹•É	ÕÑÑ½¹Ì ¤ì(€ÕÁ‘…Ñ•Q¥µ•	ÕÑÑ½¹Ì ¤ì(€‰Ñ¹MÕ‰µ¥Ñ%Ñ•´¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ²‚²z—¶VcªâÀœì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰Ñ¹	…­Q½¡½½Í•Èœ¤¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ¡¥‘‘•¸œ¤ì(€…‘‘5½‘…°¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ¡¥‘‘•¸œ¤ì(€…‘‘5½‘…°¹±…ÍÍ1¥ÍÐ¹…‘ ™±•àœ¤ì(€Í•ÑQ¥µ•½ÕÐ¡™Õ¹Ñ¥½¸ ¤ì¥¹ÁÕÑ%Ñ•µQ¥Ñ±”¹™½ÕÌ ¤ìô°€ÔÀ¤ì)ô()™Õ¹Ñ¥½¸Í•Ñ5½‘…±5½‘”¡µ½‘”¤ì(€ÍÑ…Ñ”¹µ½‘…±QåÁ”€ôµ½‘”ì(€½¹ÍÐ½¹˜€ôì(€€€•Ù•¹ÐèìÑ¥Ñ±”è€ŸÂ~Nƒ²V÷²4ƒ®ªâÀœ°±…‰•°è€Ÿ®²Ó²* ƒ²V÷²7²vÓ²^C²jPüœ°Á è€Ÿ²b èƒ²‚®ƒ²fã².t°ƒ²b¶fPƒ®ÎÓªâÀœô°(€€€Ñ½‘¼èìÑ¥Ñ±”è€ŸŠrƒ¶V€ƒ²vðƒ®ªâÀœ°±…‰•°è€Ÿ¶VÓ²Vðƒ¶V€ƒ²vó²vÐƒ®¶C²b#²jPüœ°Á è€Ÿ²b èƒ²jÃ²r€ƒ²
³ªâÀ°ƒ®Ú®š³²"cªÆÀœô°(€€€‘¥…ÉäèìÑ¥Ñ±”è€ŸÂ~NXƒ²vóªâÀƒ²NÃªâÀœ°±…‰•°è€Ÿ²b“®*`ƒ²ZÓ®Zƒ²vó²vÐƒ²z#²^#®
c²jPüœ°Á è€Ÿ²zC²rƒ®†·ªÊ0ƒ²‚²ZÐƒ®ÎÓ²ã²jP¸ƒ²
³²ž®>ƒ®²vƒ²"`ƒ²z#²ZÓ²jP¸œô(€õmµ½‘•tì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% …‘‘5½‘…±Q¥Ñ±”œ¤¹Ñ•áÑ½¹Ñ•¹Ð€ô½¹˜¹Ñ¥Ñ±”ì(€¥¹ÁÕÑ%Ñ•µ1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô½¹˜¹±…‰•°ì(€¥¹ÁÕÑ%Ñ•µQ¥Ñ±”¹Á±…•¡½±‘•È€ô½¹˜¹Á ì(€¥¹ÁÕÑ%Ñ•µQ¥Ñ±”¹É½ÝÌ€ôµ½‘”€ôôô€‘¥…Éäœ€ü€Ð€è€Èì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ½Ý¹•ÉM•±•Ñ½É]É…Àœ¤¹±…ÍÍ1¥ÍÐ¹Ñ½±” ¡¥‘‘•¸œ°µ½‘”€„ôô€•Ù•¹Ðœ¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘…Ñ•¥•±‘]É…Àœ¤¹±…ÍÍ1¥ÍÐ¹Ñ½±” ¡¥‘‘•¸œ°µ½‘”€ôôô€Ñ½‘¼œ¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% •¹‘…Ñ•]É…Àœ¤¹±…ÍÍ1¥ÍÐ¹Ñ½±” ¡¥‘‘•¸œ°µ½‘”€„ôô€•Ù•¹Ðœ¤ì(€‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% É•Á•…Ñ¥•±‘]É…Àœ¤¹±…ÍÍ1¥ÍÐ¹Ñ½±” ¡¥‘‘•¸œ°µ½‘”€„ôô€•Ù•¹Ðœ¤ì(€Ñ¥µ•¥•±‘]É…À¹±…ÍÍ1¥ÍÐ¹Ñ½±” ¡¥‘‘•¸œ°µ½‘”€„ôô€•Ù•¹Ðœ¤ì(€µ½½‘M•±•Ñ½É]É…À¹±…ÍÍ1¥ÍÐ¹Ñ½±” ¡¥‘‘•¸œ°µ½‘”€„ôô€‘¥…Éäœ¤ì(€µ•‘¥…UÁ±½…‘]É…À¹±…ÍÍ1¥ÍÐ¹Ñ½±” ¡¥‘‘•¸œ°µ½‘”€„ôô€‘¥…Éäœ¤ì)ô()Ý¥¹‘½Ü¹‘•±•Ñ•Ù•¹Ð€ô™Õ¹Ñ¥½¸¡¥¤ì(€½¹ÍÐ¥‘à€ôÍÑ…Ñ”¹•Ù•¹ÑÌ¹™¥¹‘%¹‘•à¡™Õ¹Ñ¥½¸¡”¤ìÉ•ÑÕÉ¸”¹¥€ôôô¥ìô¤ì(€¥˜€¡¥‘à€ð€À¤É•ÑÕÉ¸ì(€½¹ÍÐÉ•µ½Ù•€ôÍÑ…Ñ”¹•Ù•¹ÑÌ¹ÍÁ±¥”¡¥‘à°€Ä¥lÁtì(€Í…Ù•Ù•¹ÑÌ ¤ì(€ÁÕÍ¡I•µ½Ñ•Ù•¹Ð ‘•±•Ñ”œ°É•µ½Ù•¤ì(€É•¹‘•É…±•¹‘…È ¤ì(€É•¹‘•ÉM•±•Ñ•‘…Ñ•Y¥•Ü ¤ì(€Í¡½ÝQ½…ÍÐ Ÿ²V÷²7²vƒ²ž²nƒ²ZÓ²jPœ°™Õ¹Ñ¥½¸ ¤ì(€€€É•ÍÑ½É•Ð¡ÍÑ…Ñ”¹•Ù•¹ÑÌ°¥‘à°É•µ½Ù•¤ì(€€€Í…Ù•Ù•¹ÑÌ ¤ì(€€€ÁÕÍ¡I•µ½Ñ•Ù•¹Ð ¥¹Í•ÉÐœ°É•µ½Ù•¤ì(€€€É•¹‘•É…±•¹‘…È ¤ì(€€€É•¹‘•ÉM•±•Ñ•‘…Ñ•Y¥•Ü ¤ì(€ô¤ì)ôì()Ý¥¹‘½Ü¹Ñ½±•Q½‘¼€ô™Õ¹Ñ¥½¸¡¥¤ì(€½¹ÍÐÑ½‘¼€ôÍÑ…Ñ”¹Ñ½‘½Ì¹™¥¹¡™Õ¹Ñ¥½¸¡Ð¤ìÉ•ÑÕÉ¸Ð¹¥€ôôô¥ìô¤ì(€¥˜€ …Ñ½‘¼¤É•ÑÕÉ¸ì(€Ñ½‘¼¹¥Í½µÁ±•Ñ•€ô€…Ñ½‘¼¹¥Í½µÁ±•Ñ•ì(€Í…Ù•Q½‘½Ì ¤ì(€ÁÕÍ¡I•µ½Ñ•Q½‘¼ ÕÁ‘…Ñ”œ°Ñ½‘¼¤ì(€É•¹‘•ÉQ½‘½Ì ¤ì(€¥˜€¡Ñ½‘¼¹¥Í½µÁ±•Ñ•¤Í¡½ÝQ½…ÍÐ Ÿ²zc¶Z#²ZÓ²jP„ƒŠrœ¤ì)ôì()Ý¥¹‘½Ü¹‘•±•Ñ•Q½‘¼€ô™Õ¹Ñ¥½¸¡¥¤ì(€½¹ÍÐ¥‘à€ôÍÑ…Ñ”¹Ñ½‘½Ì¹™¥¹‘%¹‘•à¡™Õ¹Ñ¥½¸¡Ð¤ìÉ•ÑÕÉ¸Ð¹¥€ôôô¥ìô¤ì(€¥˜€¡¥‘à€ð€À¤É•ÑÕÉ¸ì(€½¹ÍÐÉ•µ½Ù•€ôÍÑ…Ñ”¹Ñ½‘½Ì¹ÍÁ±¥”¡¥‘à°€Ä¥lÁtì(€Í…Ù•Q½‘½Ì ¤ì(€ÁÕÍ¡I•µ½Ñ•Q½‘¼ ‘•±•Ñ”œ°É•µ½Ù•¤ì(€É•¹‘•ÉQ½‘½Ì ¤ì(€Í¡½ÝQ½…ÍÐ Ÿ¶V€ƒ²vó²vƒ²ž²nƒ²ZÓ²jPœ°™Õ¹Ñ¥½¸ ¤ì(€€€É•ÍÑ½É•Ð¡ÍÑ…Ñ”¹Ñ½‘½Ì°¥‘à°É•µ½Ù•¤ì(€€€Í…Ù•Q½‘½Ì ¤ì(€€€ÁÕÍ¡I•µ½Ñ•Q½‘¼ ¥¹Í•ÉÐœ°É•µ½Ù•¤ì(€€€É•¹‘•ÉQ½‘½Ì ¤ì(€ô¤ì)ôì()Ý¥¹‘½Ü¹‘•±•Ñ•¥…Éä€ô™Õ¹Ñ¥½¸¡¥¤ì(€½¹ÍÐ¥‘à€ôÍÑ…Ñ”¹‘¥…É¥•Ì¹™¥¹‘%¹‘•à¡™Õ¹Ñ¥½¸¡¤ìÉ•ÑÕÉ¸¹¥€ôôô¥ìô¤ì(€¥˜€¡¥‘à€ð€À¤É•ÑÕÉ¸ì(€½¹ÍÐÉ•µ½Ù•€ôÍÑ…Ñ”¹‘¥…É¥•Ì¹ÍÁ±¥”¡¥‘à°€Ä¥lÁtì(€Í…Ù•¥…É¥•Ì ¤ì(€ÁÕÍ¡I•µ½Ñ•¥…Éä ‘•±•Ñ”œ°É•µ½Ù•¤ì(€É•¹‘•É…±•¹‘…È ¤ì(€É•¹‘•ÉM•±•Ñ•‘…Ñ•Y¥•Ü ¤ì(€É•¹‘•É±±¥…É¥•Ì ¤ì(€Í¡½ÝQ½…ÍÐ Ÿ²vóªâÃ®–ðƒ²ž²nƒ²ZÓ²jPœ°™Õ¹Ñ¥½¸ ¤ì(€€€É•ÍÑ½É•Ð¡ÍÑ…Ñ”¹‘¥…É¥•Ì°¥‘à°É•µ½Ù•¤ì(€€€Í…Ù•¥…É¥•Ì ¤ì(€€€ÁÕÍ¡I•µ½Ñ•¥…Éä ¥¹Í•ÉÐœ°É•µ½Ù•¤ì(€€€É•¹‘•É…±•¹‘…È ¤ì(€€€É•¹‘•ÉM•±•Ñ•‘…Ñ•Y¥•Ü ¤ì(€€€É•¹‘•É±±¥…É¥•Ì ¤ì(€ô¤ì)ôì()™Õ¹Ñ¥½¸Í…Ù•Ù•¹ÑÌ ¤ì(€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}•Ù•¹ÑÌœ°)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¹•Ù•¹ÑÌ¤¤ì)ô()™Õ¹Ñ¥½¸Í…Ù•Q½‘½Ì ¤ì(€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}Ñ½‘½Ìœ°)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¹Ñ½‘½Ì¤¤ì)ô()™Õ¹Ñ¥½¸Í…Ù•¥…É¥•Ì ¤ì(€ÑÉäì(€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ …±}‘¥…É¥•Ìœ°)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¹‘¥…É¥•Ì¤¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô…Ñ €¡•ÉÈ¤ì(€€€Í¡½ÝQ½…ÍÐ Ÿ²‚²z”ƒªÎ×ªÂ²vÐƒªö$ƒ²Âó²ZÓ²jP¸ƒ²
³²ž²vÓ®
`ƒ®>g²b²²vƒ®ªƒªÂpƒ®æóªÎ€ƒ®.“².pƒ²‚²z—¶VÐƒ²Žó²ã²jPƒÂ~b”œ¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô)ô()™Õ¹Ñ¥½¸™½Éµ…Ñ…Ñ”¡¤ì(€É•ÑÕÉ¸€‘í¹•ÑÕ±±e•…È ¥ô´‘íMÑÉ¥¹œ¡¹•Ñ5½¹Ñ  ¤€¬€Ä¤¹Á…‘MÑ…ÉÐ È°€œÀœ¥ô´‘íMÑÉ¥¹œ¡¹•Ñ…Ñ” ¤¤¹Á…‘MÑ…ÉÐ È°€œÀœ¥õ€ì)ô()™Õ¹Ñ¥½¸™½Éµ…ÑQ¥µ•¼¡¥Í½MÑÈ¤ì(€¥˜€ …¥Í½MÑÈ¤É•ÑÕÉ¸€œœì(€½¹ÍÐ‘…Ñ”€ô¹•Ü…Ñ”¡¥Í½MÑÈ¤ì(€½¹ÍÐ¹½Ü€ô¹•Ü…Ñ” ¤ì(€½¹ÍÐ‘¥™™M•Œ€ô5…Ñ ¹™±½½È ¡¹½Ü€´‘…Ñ”¤€¼€ÄÀÀÀ¤ì(€¥˜€¡‘¥™™M•Œ€ð€ØÀ¤É•ÑÕÉ¸€Ÿ®Â§ªâ ƒ²‚œì(€½¹ÍÐ‘¥™™5¥¸€ô5…Ñ ¹™±½½È¡‘¥™™M•Œ€¼€ØÀ¤ì(€¥˜€¡‘¥™™5¥¸€ð€ØÀ¤É•ÑÕÉ¸€‘í‘¥™™5¥¹÷®Úƒ²‚€ì(€½¹ÍÐ‘¥™™!½ÕÈ€ô5…Ñ ¹™±½½È¡‘¥™™5¥¸€¼€ØÀ¤ì(€¥˜€¡‘¥™™!½ÕÈ€ð€ÈÐ¤É•ÑÕÉ¸€‘í‘¥™™!½ÕÉ÷².sªÂƒ²‚€ì(€É•ÑÕÉ¸€‘í‘…Ñ”¹•Ñ5½¹Ñ  ¤€¬€Å÷²nP€‘í‘…Ñ”¹•Ñ…Ñ” ¥÷²vñ€ì)ô()™Õ¹Ñ¥½¸•Í…Á•!Ñµ°¡ÍÑÈ¤ì(€É•ÑÕÉ¸ÍÑÈ¹É•Á±…” ¼˜½œ°€œ™…µÀìœ¤¹É•Á±…” ¼ð½œ°€œ™±Ðìœ¤¹É•Á±…” ¼ø½œ°€œ™Ðìœ¤ì)ô()‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È =5½¹Ñ•¹Ñ1½…‘•œ°¥¹¥Ð¤ì((