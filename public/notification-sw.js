/* Push-only worker: deliberately no fetch handler and no offline cache. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function valid(data) {
  return data && data.v === 1 && uuid.test(data.notification_id) && uuid.test(data.deep_link_id)
    && ["ANNOUNCEMENT", "CENTER"].includes(data.deep_link_type) && !("url" in data);
}
self.addEventListener("push", event => {
  let data;
  try { data = event.data?.json(); } catch { return; }
  if (!valid(data)) return;
  event.waitUntil(self.registration.showNotification("P&M OS", {
    body: data.deep_link_type === "ANNOUNCEMENT" ? "새 공지가 도착했습니다." : "새 알림이 도착했습니다.",
    icon: "/android-chrome-192x192.png", badge: "/android-chrome-192x192.png",
    tag: `pnm-${data.notification_id}`, renotify: false,
    data: { v: 1, notification_id: data.notification_id, deep_link_type: data.deep_link_type, deep_link_id: data.deep_link_id },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data;
  if (!valid(data)) return;
  // Typed IDs only. Query opens the center; recipient-scoped repository resolves details.
  const url = new URL("/select-module", self.location.origin);
  url.searchParams.set("push_notification", data.notification_id);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { existing.postMessage({ type: "PNM_PUSH_OPEN", notificationId: data.notification_id }); await existing.focus(); }
    else await self.clients.openWindow(url.href);
  })());
});
self.addEventListener("pushsubscriptionchange", event => {
  // A SW has no authenticated user context: do not silently bind to a stale identity.
  event.waitUntil((async () => {
    if (event.newSubscription) await event.newSubscription.unsubscribe();
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) client.postMessage({ type: "PNM_PUSH_RECONCILE" });
  })());
});
