import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

// One owner and one serialized auth/removal lane per client. Never log JWTs or payloads.
export function createNotificationRealtime(client: SupabaseClient) {
  let lane = Promise.resolve();
  let removalFailed = false;
  let owner: (() => void) | undefined;
  const enqueue = (work: () => Promise<void>) => {
    lane = lane.then(work).catch(() => { /* RPC/focus/visible polling remain available. */ });
  };
  return (userId: string, refresh: () => void) => {
    owner?.();
    let alive = true;
    let authorized = true;
    let generation = 0;
    let channel: RealtimeChannel | undefined;
    let appliedToken: string | undefined;
    const remove = async () => {
      const previous = channel;
      channel = undefined;
      appliedToken = undefined;
      if (previous && await client.removeChannel(previous) !== "ok") {
        // Do not let a new identity join when removal is uncertain.
        throw new Error("Notification channel removal incomplete");
      }
    };
    const retire = async () => {
      try { await remove(); } catch { removalFailed = true; }
    };
    const reconcile = () => {
      const ticket = ++generation;
      enqueue(async () => {
        const current = () => alive && authorized && ticket === generation && !removalFailed;
        if (!current()) return;
        try {
          const { data, error } = await client.auth.getSession();
          const session = data.session;
          if (!current()) return;
          if (error || !session?.access_token || session.user.id !== userId ||
              !session.expires_at || session.expires_at * 1000 <= Date.now()) {
            await retire();
            return;
          }
          const token = session.access_token;
          if (token !== appliedToken) {
            // Explicit bootstrap does not replace the SDK's accessToken callback.
            await client.realtime.setAuth(token);
            if (!current()) return;
            const latest = await client.auth.getSession();
            if (!current()) return;
            if (latest.error || latest.data.session?.user.id !== userId || latest.data.session?.access_token !== token) {
              await retire();
              return;
            }
            appliedToken = token;
          }
          if (channel) return; // Refresh updates authorization, not channel identity.
          channel = client.channel(`notification-inbox:${userId}`);
          const joined = channel;
          const activeRefresh = () => { if (alive && authorized && channel === joined) refresh(); };
          for (const table of ["notifications", "notification_inbox_revisions"]) {
            channel.on("postgres_changes", { event: "INSERT", schema: "public", table, filter: `recipient_id=eq.${userId}` }, activeRefresh);
            channel.on("postgres_changes", { event: "UPDATE", schema: "public", table, filter: `recipient_id=eq.${userId}` }, activeRefresh);
          }
          channel.subscribe(status => {
            if (!alive || channel !== joined) return;
            if (status === "SUBSCRIBED") activeRefresh();
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              ++generation;
              enqueue(retire); // Retry only on a later session/focus event; no retry storm.
            }
          });
        } catch { await retire(); }
      });
    };
    // Auth callbacks stay synchronous: getSession/setAuth run outside the auth lock.
    const listener = client.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      ++generation;
      authorized = event !== "SIGNED_OUT" && !!session && session.user.id === userId;
      if (!authorized) enqueue(retire);
      else queueMicrotask(() => { if (alive) reconcile(); });
    });
    const visible = () => { if (document.visibilityState !== "hidden") reconcile(); };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    const stop = () => {
      if (!alive) return;
      alive = false;
      ++generation;
      listener.data.subscription.unsubscribe();
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
      enqueue(retire);
    };
    owner = stop;
    reconcile();
    return stop;
  };
}
