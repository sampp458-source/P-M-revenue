import { announcementExpiryError } from "./announcementExpiry";
import { supabase } from "../lib/supabase";
export interface Notice {
  id: string; announcement_id: string | null; title: string; message: string;
  category?: "ANNOUNCEMENT" | "SCHEDULE"; deep_link_type?: "ANNOUNCEMENT" | "SCHEDULE" | "SCHEDULE_DAY";
  deep_link_id?: string; schedule_local_date?: string | null;
  priority: "NORMAL" | "IMPORTANT"; ack_required: boolean; created_at: string;
  read_at: string | null; acknowledged_at: string | null; popup_presented_at: string | null;
  revoked_at: string | null; expires_at: string | null;
}
export interface Inbox {
  items: Notice[]; popup: Notice[]; unread_count: number; unacknowledged_count: number;
  can_publish: boolean; can_view_receipts: boolean;
}
export interface Publication {
  id: string; title: string; body: string; priority: string; ack_required: boolean;
  stats: { total: number; read: number; ack: number; unack: number } | null;
  state: "PUBLISHED" | "RETRACTED"; published_at: string; expires_at: string | null;
}
export interface Receipt { recipient_id: string; name: string; active: boolean; read_at: string | null; acknowledged_at: string | null; revoked_at: string | null }
export interface Target { id: string; name: string }
export interface PublishInput {
  requestId: string; title: string; body: string; priority: "NORMAL" | "IMPORTANT";
  ackRequired: boolean; targetKind: "ALL" | "USER"; userIds: string[]; expiresAt: string | null;
}
export class NotificationFailure extends Error {
  constructor(message: string, readonly definite: boolean) { super(message); }
}
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (name === "publish_announcement_v1" && error?.code === "22023" && error.message === "INVALID_EXPIRY") throw new NotificationFailure(announcementExpiryError, true);
  if (error?.message === "ANNOUNCEMENT_REQUEST_DELETED") throw new NotificationFailure("이 발행 요청의 공지는 삭제되었습니다. 다시 보내려면 새 공지로 발행해 주세요.", true);
  if (error?.message === "ANNOUNCEMENT_NOT_FOUND") throw new NotificationFailure("이미 삭제되었거나 찾을 수 없는 공지입니다.", true);
  if (error) throw new NotificationFailure(error.code === "42501" ? "접근 권한이 없거나 더 이상 사용할 수 없는 공지입니다." : error.code === "22023" ? "대상 또는 게시 종료 시간을 확인해 주세요." : "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.", ["42501", "22023", "23514"].includes(error.code));
  return data as T;
}
export const notificationRepository = {
  inbox: (offset = 0, unread = false) => rpc<Inbox>("get_notification_inbox_v1", { p_offset: offset, p_unread_only: unread }),
  detail: (id: string) => rpc<Notice | null>("get_notification_detail_v1", { p_notification_id: id }),
  read: (id: string) => rpc<void>("mark_notification_read_v1", { p_notification_id: id }),
  acknowledge: (id: string) => rpc<void>("acknowledge_notification_v1", { p_notification_id: id }),
  presented: (ids: string[]) => rpc<void>("mark_notification_popup_presented_v1", { p_notification_ids: ids }),
  targets: () => rpc<Target[]>("get_announcement_targets_v1"),
  sent: (offset = 0) => rpc<Publication[]>("get_sent_announcements_v1", { p_offset: offset }),
  // Existing SELECT grants/RLS support receipt-only users; keep the author's own sent scope.
  sentForReceiptViewer: async (authorId: string, offset = 0): Promise<Publication[]> => {
    const { data, error } = await supabase.from("announcements").select("id,title,body,priority,ack_required,state,published_at,expires_at")
      .eq("author_id", authorId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 49);
    if (error) throw new Error("보낸 공지를 불러오지 못했습니다.");
    return Promise.all((data || []).map(async a => {
      const receipts = await rpc<Receipt[]>("get_announcement_receipts_v1", { p_announcement_id: a.id });
      return { ...a, stats: { total: receipts.length, read: receipts.filter(r => r.read_at).length, ack: receipts.filter(r => r.acknowledged_at).length, unack: receipts.filter(r => !r.acknowledged_at).length } } as Publication;
    }));
  },
  audience: async (id: string): Promise<Pick<PublishInput, "targetKind" | "userIds">> => {
    const { data, error } = await supabase.from("announcement_targets").select("target_kind,target_user_id").eq("announcement_id", id);
    if (error || !data?.length) throw new Error("기존 공지 대상을 확인하지 못했습니다. 다시 시도해 주세요.");
    if (data.length === 1 && data[0].target_kind === "ALL" && data[0].target_user_id === null) return { targetKind: "ALL", userIds: [] };
    if (data.every(t => t.target_kind === "USER" && typeof t.target_user_id === "string") && new Set(data.map(t => t.target_user_id)).size === data.length)
      return { targetKind: "USER", userIds: data.map(t => t.target_user_id as string) };
    throw new Error("기존 공지 대상 구성을 확인해야 합니다.");
  },
  receipts: (id: string) => rpc<Receipt[]>("get_announcement_receipts_v1", { p_announcement_id: id }),
  deleteAnnouncement: (id: string) => rpc<void>("delete_announcement_v1", { p_announcement_id: id }),
  retract: (id: string) => rpc<void>("retract_announcement_v1", { p_announcement_id: id }),
  publish: (p: PublishInput) => rpc<string>("publish_announcement_v1", {
    p_request_id: p.requestId, p_title: p.title, p_body: p.body, p_priority: p.priority,
    p_ack_required: p.ackRequired, p_target_kind: p.targetKind, p_user_ids: p.userIds, p_expires_at: p.expiresAt,
  }),
  subscribe: (userId: string, refresh: () => void) => {
    const channel = supabase.channel(`notification-inbox:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notification_inbox_revisions", filter: `recipient_id=eq.${userId}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notification_inbox_revisions", filter: `recipient_id=eq.${userId}` }, refresh)
      .subscribe(status => { if (status === "SUBSCRIBED") refresh(); });
    return () => { void supabase.removeChannel(channel); };
  },
};
export type NotificationRepository = typeof notificationRepository;
export const emptyInbox: Inbox = { items: [], popup: [], unread_count: 0, unacknowledged_count: 0, can_publish: false, can_view_receipts: false };
