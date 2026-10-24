(function attachPushReminders(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PushReminders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPushRemindersModule() {
  function decodeApplicationServerKey(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  function createClient(options) {
    const config = options || {};
    const NotificationApi = config.Notification;
    const navigatorApi = config.navigator;
    const supabaseClient = config.supabaseClient;
    const vapidPublicKey = String(config.vapidPublicKey || '').trim();

    function supportsPush() {
      return !!(NotificationApi && navigatorApi && navigatorApi.serviceWorker
        && navigatorApi.serviceWorker.ready);
    }

    async function currentSubscription() {
      if (!supportsPush()) return null;
      const registration = await navigatorApi.serviceWorker.ready;
      if (!registration || !registration.pushManager
        || typeof registration.pushManager.getSubscription !== 'function') return null;
      return registration.pushManager.getSubscription();
    }

    async function getStatus(userId) {
      if (!userId) return { status: 'signed_out', enabled: false };
      if (!supportsPush()) return { status: 'unsupported', enabled: false };
      if (NotificationApi.permission === 'denied') return { status: 'denied', enabled: false };
      if (NotificationApi.permission !== 'granted') return { status: 'permission_required', enabled: false };

      try {
        const subscription = await currentSubscription();
        if (!subscription) {
          return vapidPublicKey
            ? { status: 'not_subscribed', enabled: false }
            : { status: 'missing_config', enabled: false };
        }
        if (!supabaseClient) return { status: 'server_unavailable', enabled: false };
        const { data, error } = await supabaseClient
          .from('push_subscriptions')
          .select('id')
          .eq('user_id', userId)
          .eq('endpoint', subscription.endpoint)
          .maybeSingle();
        if (error) return { status: 'server_unavailable', enabled: false };
        return data
          ? { status: 'subscribed', enabled: true }
          : { status: 'not_registered', enabled: false };
      } catch (error) {
        return { status: 'error', enabled: false };
      }
    }

    async function enable(userId) {
      if (!userId) return { ok: false, reason: 'auth_required' };
      if (!supportsPush()) return { ok: false, reason: 'unsupported' };
      if (!supabaseClient) return { ok: false, reason: 'server_unavailable' };
      if (!vapidPublicKey) return { ok: false, reason: 'missing_config' };
      if (NotificationApi.permission === 'denied') return { ok: false, reason: 'permission_denied' };

      try {
        // Call permission synchronously within the button's user gesture.
        const permissionRequest = NotificationApi.permission === 'granted'
          ? Promise.resolve('granted')
          : NotificationApi.requestPermission();
        const permission = await permissionRequest;
        if (permission !== 'granted') return { ok: false, reason: 'permission_denied' };

        const registration = await navigatorApi.serviceWorker.ready;
        if (!registration || !registration.pushManager
          || typeof registration.pushManager.subscribe !== 'function') {
          return { ok: false, reason: 'unsupported' };
        }
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: decodeApplicationServerKey(vapidPublicKey)
          });
        }
        if (!subscription || typeof subscription.toJSON !== 'function') {
          return { ok: false, reason: 'subscription_failed' };
        }
        const json = subscription.toJSON();
        const keys = json.keys || {};
        if (!json.endpoint || !keys.p256dh || !keys.auth) {
          return { ok: false, reason: 'subscription_failed' };
        }
        const expiresAt = json.expirationTime ? new Date(json.expirationTime).toISOString() : null;
        const { error } = await supabaseClient.from('push_subscriptions').upsert({
          user_id: userId,
          endpoint: json.endpoint,
          p256dh: keys.p256dh,
          auth_key: keys.auth,
          expires_at: expiresAt
        }, { onConflict: 'endpoint' });
        if (error) return { ok: false, reason: 'save_failed' };
        return { ok: true, status: 'subscribed' };
      } catch (error) {
        return { ok: false, reason: 'subscription_failed' };
      }
    }

    async function disable(userId) {
      if (!userId) return { ok: false, reason: 'auth_required' };
      if (!supportsPush()) return { ok: false, reason: 'unsupported' };
      try {
        const subscription = await currentSubscription();
        if (!subscription) return { ok: true, status: 'disabled' };
        if (!supabaseClient) return { ok: false, reason: 'server_unavailable' };
        const { error } = await supabaseClient
          .from('push_subscriptions')
          .delete()
          .eq('user_id', userId)
          .eq('endpoint', subscription.endpoint);
        if (error) return { ok: false, reason: 'save_failed' };
        await subscription.unsubscribe();
        return { ok: true, status: 'disabled' };
      } catch (error) {
        return { ok: false, reason: 'subscription_failed' };
      }
    }

    return { enable, disable, getStatus };
  }

  return { createClient };
});
