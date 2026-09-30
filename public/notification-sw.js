/* Push-only worker: deliberately no fetch handler and no offline cache. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function valid(data) {
  return data && data.v === 1 && uuid.test(data.notification_id) && uuid.test(data.deep_link_id)
    && ["ANNOUNCEMENT", "CENTER"].includes(data.deep_link_type) && !("url" in data);
}
function pushBody(data) {
  const labels = { ANNOUNCEMENT: "새 공지가 도착했습니다.", SCHEDULE_ASSIGNED: "새 일정이 등록되었습니다.", SCHEDULE_UPDATED: "일정이 변경되었습니다.", SCHEDULE_COMPLETED: "일정이 완료 처리되었습니다.", SCHEDULE_CANCELLED: "일정이 취소되었습니다." };
  if (data.event_type === "DAILY_SCHEDULE_SUMMARY" && Number.isSafeInteger(data.summary_count) && data.summary_count > 0) return `오늘 일정 ${data.summary_count}건이 있습니다.`;
  return (Object.prototype.hasOwnProperty.call(labels, data.event_type) ? labels[data.event_type] : null) || (data.deep_link_type === "ANNOUNCEMENT" ? labels.ANNOUNCEMENT : "새 알림이 도착했습니다.");
}
self.addEventListener("push", event => {
  let data;
  try { data = event.data?.json(); } catch { return; }
  if (!valid(data)) return;
  event.waitUntil(self.registration.showNotification("P&M OS", {
    body: pushBody(data),
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
