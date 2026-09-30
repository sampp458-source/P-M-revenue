import { createContext, useContext } from "react";
import type { Inbox, Notice, NotificationRepository } from "./notificationRepository";
export interface NotificationState {
  userId: string; repository: NotificationRepository; inbox: Inbox; error: string; loading: boolean;
  view: "closed" | "summary" | "center" | "detail" | "compose" | "manage";
  setView: (view: NotificationState["view"]) => void;
  detail: Notice | null; setDetail: (notice: Notice | null) => void;
  refresh: () => Promise<void>;
}
export const NotificationContext = createContext<NotificationState | null>(null);
export const useNotifications = () => useContext(NotificationContext);
