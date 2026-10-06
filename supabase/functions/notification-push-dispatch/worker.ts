// @deno-types="npm:@types/web-push@3.6.4"
import webpush from "web-push";
export type Delivery = { notification_id: string; deep_link_type: string; deep_link_id: string; category: string; event_type?: string; task_audience?: string; summary_count?: number; endpoint: string; p256dh: string; auth: string };
export type Claim = { delivery_id: string; token: string };
export type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export type Vapid = { subject: string; publicKey: string; privateKey: string };
export function safeEndpoint(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash && u.pathname !== "/" &&
      (["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com"].includes(u.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname));
  } catch { return false; }
}
export function pushTemplate(d: Pick<Delivery, "category" | "event_type" | "summary_count" | "task_audience">) {
  if (d.category === "ANNOUNCEMENT") return { event_type: "ANNOUNCEMENT" };
  if (d.category === "TASK_REQUEST" && ["TASK_REQUEST_ASSIGNED","TASK_REQUEST_OVERDUE","TASK_REQUEST_COMPLETED","TASK_REQUEST_CANCELLED"].includes(d.event_type || "")) {
    if (d.task_audience !== "target" && d.task_audience !== "requester") throw new Error("INVALID_TASK_AUDIENCE");
    return { event_type: d.event_type, task_audience: d.task_audience };
  }
  if (d.category !== "SCHEDULE") throw new Error("INVALID_PUSH_CATEGORY");
  if (["SCHEDULE_ASSIGNED", "SCHEDULE_UPDATED", "SCHEDULE_COMPLETED", "SCHEDULE_CANCELLED"].includes(d.event_type || "")) return { event_type: d.event_type };
  if (d.event_type === "DAILY_SCHEDULE_SUMMARY" && Number.isSafeInteger(d.summary_count) && d.summary_count! > 0) return { event_type: d.event_type, summary_count: d.summary_count };
  throw new Error("INVALID_PUSH_TEMPLATE");
}
export function encryptedRequest(d: Delivery, vapid: Vapid) {
  if (!safeEndpoint(d.endpoint)) throw new Error("INVALID_ENDPOINT");
  const payload = JSON.stringify({ ...pushTemplate(d), v: 1, notification_id: d.notification_id,
    deep_link_type: d.deep_link_type === "ANNOUNCEMENT" ? "ANNOUNCEMENT" : "CENTER", deep_link_id: d.deep_link_id });
  return webpush.generateRequestDetails({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload,
    { vapidDetails: vapid, TTL: 300, urgency: "normal", topic: d.notification_id.replaceAll("-", ""), contentEncoding: "aes128gcm" });
}
export function resultForStatus(status: number) {
  if (status >= 200 && status < 300) return "SENT";
  if (status === 404 || status === 410) return "GONE";
  if (status === 429 || status >= 500) return "RETRY";
  return "PERMANENT";
}
export async function dispatch(rpc: Rpc, vapid: Vapid, send: typeof fetch = fetch) {
  const claims = await rpc<Claim[]>("claim_notification_push_deliveries_v1", { p_limit: 10 });
  const results = await Promise.all(claims.map(async c => {
    let result = "CANCELLED", retry: number | null = null;
    const d = await rpc<Delivery | null>("get_notification_push_delivery_v1", { p_delivery_id: c.delivery_id, p_token: c.token });
    if (d) {
      try {
        const req = encryptedRequest(d, vapid);
        const response = await send(d.endpoint, { method: "POST", headers: req.headers as Record<string, string>,
          body: new Uint8Array(req.body as Uint8Array), redirect: "error", signal: AbortSignal.timeout(8000) });
        result = resultForStatus(response.status);
        const value = response.headers.get("retry-after");
        if (value && /^\d+$/.test(value)) retry = Math.min(3600, Number(value));
        await response.body?.cancel();
      } catch {
        result = safeEndpoint(d.endpoint) ? "RETRY" : "PERMANENT";
      }
    }
    const saved = await rpc<boolean>("finish_notification_push_delivery_v1", {
      p_delivery_id: c.delivery_id, p_token: c.token, p_result: result, p_retry_after: retry });
    return saved ? result : "STALE";
  }));
  // Only aggregate status names; no endpoint, payload or keys in output.
  return results.reduce<Record<string, number>>((acc, key) => ({ ...acc, [key]: (acc[key] || 0) + 1 }), {});
}
export function handler(rpc: Rpc, vapid: Vapid, secret: string) {
  return async (request: Request) => {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const provided = request.headers.get("x-push-worker-secret") || "";
    // Fixed-length hash comparison avoids a prefix-dependent comparison of the secret.
    const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
    const [a, b] = await Promise.all([hash(provided), hash(secret)]);
    const equal = a.reduce((diff, byte, i) => diff | (byte ^ b[i]), 0) === 0;
    if (secret.length < 32 || !equal) return new Response(null, { status: 401 });
    try { return Response.json(await dispatch(rpc, vapid)); }
    catch { return Response.json({ error: "WORKER_UNAVAILABLE" }, { status: 503 }); }
  };
}
