const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function rememberPushTarget(value: unknown) {
  if (!validId(value)) return;
  try { sessionStorage.setItem("pnm-push-open", value); } catch { /* Storage optional. */ }
}
export function consumePushTarget(): string | null {
  const url = new URL(window.location.href);
  let value = url.searchParams.get("push_notification");
  try { value ||= sessionStorage.getItem("pnm-push-open"); sessionStorage.removeItem("pnm-push-open"); } catch { /* Storage optional. */ }
  if (url.searchParams.has("push_notification")) {
    url.searchParams.delete("push_notification"); window.history.replaceState(window.history.state, "", url);
  }
  return validId(value) ? value : null;
}
export function installPushNavigation() {
  rememberPushTarget(new URLSearchParams(window.location.search).get("push_notification"));
  navigator.serviceWorker?.addEventListener("message", event => {
    if (event.data?.type === "PNM_PUSH_OPEN") rememberPushTarget(event.data.notificationId);
  });
}
