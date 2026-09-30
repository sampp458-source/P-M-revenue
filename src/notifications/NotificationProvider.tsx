import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { emptyInbox, notificationRepository, type Notice, type NotificationRepository } from "./notificationRepository";
import { NotificationContext, type NotificationState } from "./notificationContext";
import { NotificationDialogs } from "./NotificationUi";
import "./notifications.css";
export function NotificationProvider({ children, enabled = import.meta.env.VITE_ANNOUNCEMENTS_ENABLED === "true" }: { children: ReactNode; enabled?: boolean }) {
  const { profile, loading } = useAuth();
  const id = enabled && !loading && profile?.isActive && profile.accountStatus === "active" ? profile.id : null;
  return id ? <NotificationSession key={id} userId={id}>{children}</NotificationSession> : <>{children}</>;
}
// A keyed session discards in-flight responses and popup state on account changes.
export function NotificationSession({ userId, children, repository = notificationRepository }: { userId: string; children: ReactNode; repository?: NotificationRepository }) {
  const [inbox, setInbox] = useState(emptyInbox);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<NotificationState["view"]>("closed");
  const [detail, setDetail] = useState<Notice | null>(null);
  const alive = useRef(false);
  const request = useRef(0);
  const firstPresentation = useRef(false);
  const refresh = useCallback(async () => {
    const ticket = ++request.current;
    try {
      const result = await repository.inbox();
      if (!alive.current || ticket !== request.current) return;
      setInbox(result); setError("");
    } catch (e) {
      if (alive.current && ticket === request.current) {
        setError(e instanceof Error ? e.message : "알림을 불러오지 못했습니다.");
        setInbox(emptyInbox); setDetail(null);
      }
    } finally { if (alive.current && ticket === request.current) setLoading(false); }
  }, [repository]);
  const invalidate = useCallback(() => { alive.current = false; request.current += 1; }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (document.visibilityState !== "hidden") void refresh(); }, 180);
    };
    let unsubscribe = () => {};
    try { unsubscribe = repository.subscribe(userId, schedule); }
    catch { /* Inbox and focus/poll refresh remain available without Realtime. */ }
    const visible = () => { if (document.visibilityState !== "hidden") schedule(); };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    // Expiry and disconnected Realtime fallback. Counts always come from the server.
    const poll = setInterval(visible, 30_000);
    return () => { invalidate(); clearTimeout(timer); clearInterval(poll); unsubscribe(); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [repository, refresh, userId, invalidate]);
  useEffect(() => {
    if (loading || error || firstPresentation.current) return;
    firstPresentation.current = true;
    if (inbox.popup.length) setView("summary");
  }, [loading, error, inbox.popup]);
  return <NotificationContext.Provider value={{ userId, repository, inbox, error, loading, view, setView, detail, setDetail, refresh }}>
    {children}<NotificationDialogs />
  </NotificationContext.Provider>;
}
