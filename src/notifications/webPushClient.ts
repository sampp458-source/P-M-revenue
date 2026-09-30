import { supabase } from "../lib/supabase";
export const webPushEnabled = import.meta.env.VITE_WEB_PUSH_ENABLED === "true";
const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || "";
export type PushState = "off" | "on" | "denied" | "unsupported" | "install";
export function detectPushSupport() : PushState {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && "PushSubscriptionOptions" in window && "applicationServerKey" in PushSubscriptionOptions.prototype;
  if (!supported) return !standalone && navigator.maxTouchPoints > 0 ? "install" : "unsupported";
  return Notification.permission === "denied" ? "denied" : "off";
}
function keyBytes(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
let identity: string | null = null;
let generation = 0;
let serial: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = serial.catch(() => {}).then(work); serial = next; return next;
}
export function notePushIdentity(id: string | null) {
  if (identity === id) return;
  identity = id; generation++;
  if (!id) void removeLocalSubscription().catch(() => {});
}
async function registration() {
  return navigator.serviceWorker.register("/notification-sw.js", { scope: "/", updateViaCache: "none" });
}
async function existing() {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription() || null;
}
async function removeLocalSubscription() {
  await syncAppBadge(0);
  const sub = await existing();
  if (sub) await sub.unsubscribe();
  const reg = await navigator.serviceWorker?.getRegistration("/");
  for (const item of await reg?.getNotifications() || []) item.close();
}
async function register(sub: PushSubscription, userId: string, ticket: number) {
  const json = sub.toJSON();
  if (identity !== userId || ticket !== generation) { await sub.unsubscribe(); throw Error("계정이 변경되었습니다. 다시 시도해 주세요."); }
  try {
    const { error } = await supabase.rpc("register_web_push_subscription_v1", {
      p_endpoint: sub.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth,
      p_expiration_time: sub.expirationTime ? new Date(sub.expirationTime).toISOString() : null,
    }).abortSignal(AbortSignal.timeout(5000));
    if (error || identity !== userId || ticket !== generation) throw Error("BINDING_FAILED");
  } catch {
    await sub.unsubscribe();
    throw Error("기기 알림을 연결하지 못했습니다. 다시 시도해 주세요.");
  }
}
export const webPushClient = {
  async status(): Promise<PushState> {
    const state = detectPushSupport();
    if (state !== "off") return state;
    return await existing() ? "on" : "off";
  },
  async prepare() {
    if (detectPushSupport() === "off") {
      await registration(); await navigator.serviceWorker.ready;
    }
  },
  async reconcile(userId: string) {
    notePushIdentity(userId);
    const ticket = generation;
    return serialized(async () => {
      const sub = await existing();
      if (sub) await register(sub, userId, ticket);
    });
  },
  enable(userId: string): Promise<void> {
    // Called directly from a click; never request permission in mount/reconcile/SW.
    if (detectPushSupport() !== "off" || !/^[A-Za-z0-9_-]{87}$/.test(publicKey)) return Promise.reject(Error("이 기기의 알림 설정을 확인해 주세요."));
    notePushIdentity(userId); const ticket = generation;
    const permission = Notification.requestPermission();
    return permission.then(granted => {
      if (granted !== "granted") throw Error("브라우저 또는 OS 설정에서 알림을 허용해 주세요.");
      if (identity !== userId || ticket !== generation) throw Error("계정이 변경되었습니다.");
      return serialized(async () => {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
        await register(sub, userId, ticket);
      });
    });
  },
  disable(): Promise<void> {
    generation++;
    return serialized(async () => {
      const sub = await existing(); if (!sub) return;
      let serverOk = false;
      try {
        const { error } = await supabase.rpc("disable_web_push_subscription_v1", { p_endpoint: sub.endpoint }).abortSignal(AbortSignal.timeout(3000));
        serverOk = !error;
      } catch { /* Browser unsubscribe also invalidates a stale server endpoint. */ }
      const localOk = await sub.unsubscribe();
      if (!serverOk && !localOk) throw Error("알림 해제를 확인하지 못했습니다. 기기 설정에서 알림을 꺼주세요.");
    });
  },
};
async function bounded<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), ms); })]); }
  finally { clearTimeout(timer); }
}
export async function cleanupPushBeforeLogout() {
  // Do not queue logout behind an unresolved OS permission/subscribe prompt.
  identity = null; generation++;
  try {
    const sub = await bounded(existing(), 1000);
    if (sub) await bounded(Promise.allSettled([
      sub.unsubscribe(),
      Promise.resolve().then(() => supabase.rpc("disable_web_push_subscription_v1", { p_endpoint: sub.endpoint }).abortSignal(AbortSignal.timeout(3000))),
    ]), 3500);
  } catch { /* Best effort; authentication sign-out must remain available. */ }
  void syncAppBadge(0);
}

export async function syncAppBadge(count: number) {
  const badge = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try { if (count > 0) await badge.setAppBadge?.(count); else await badge.clearAppBadge?.(); } catch { /* Optional. */ }
}
