// One formatter for the encrypted display payload. SW only displays validated output.
export type PreviewSource = { title?: string; body?: string; summary?: string; due_at?: string; sender?: string; subject?: string; ack_required?: boolean };
type Source = { category: string; event_type?: string; summary_count?: number; expires_at?: string; preview_source?: PreviewSource };
export function compact(value: unknown, limit = 150): string {
  if (typeof value !== "string") return "";
  const safe = Array.from(value).map(c => c.charCodeAt(0)<32 || c.charCodeAt(0)===127 ? " " : c).join("").replace(/<[^>]*>/g, " ").replace(/[\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일 숨김]")
    .replace(/(?:\+82[- .]?)?0?1[016789][- .]?\d{3,4}[- .]?\d{4}/g, "[연락처 숨김]")
    .replace(/\d[\d,]*(?:\.\d+)?\s*(?:원|KRW|₩)/gi, "[금액 숨김]")
    .replace(/\d(?:[ -]?\d){8,}/g, "[번호 숨김]").replace(/\s+/g," ").trim();
  const chars = Array.from(safe); return chars.length > limit ? chars.slice(0, limit-1).join("")+"…" : safe;
}
function kst(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
  const get = (k: string) => parts.find(p=>p.type===k)?.value;
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")} KST`;
}
const prefixes: Record<string,string> = {SCHEDULE_ASSIGNED:"내 일정",SCHEDULE_UPDATED:"일정 변경",SCHEDULE_COMPLETED:"일정 완료",SCHEDULE_CANCELLED:"일정 취소",SCHEDULE_REMINDER:"일정 시작",DAILY_SCHEDULE_SUMMARY:"오늘 일정",TASK_REQUEST_ASSIGNED:"업무 요청",TASK_REQUEST_COMPLETED:"업무 완료",TASK_REQUEST_CANCELLED:"업무 취소",TASK_REQUEST_OVERDUE:"업무 기한",PAYMENT_CONFIRMATION_REQUESTED:"입금 확인 요청",PAYMENT_CONFIRMATION_UPDATED:"입금 확인 수정",PAYMENT_CONFIRMATION_CONFIRMED:"입금 확인",PAYMENT_CONFIRMATION_NOT_FOUND:"입금 미확인",PAYMENT_CONFIRMATION_CANCELLED:"입금 요청 취소",PAYMENT_CONFIRMATION_ADMIN_CANCELLED:"입금 요청 관리 종료",PAYMENT_REQUEST_REQUESTED:"지급 요청",PAYMENT_REQUEST_COMPLETED:"지급 완료",PAYMENT_REQUEST_REJECTED:"지급 반려",PAYMENT_REQUEST_CANCELLED:"지급 요청 취소",PAYMENT_REQUEST_ADMIN_CANCELLED:"지급 요청 관리 종료"};
// Payment copy is event-derived; never trust free-form notification title/body.
const paymentMessages: Record<string,string> = {
  PAYMENT_CONFIRMATION_REQUESTED:"입금 여부를 확인해주세요.",
  PAYMENT_CONFIRMATION_UPDATED:"입금 확인 요청이 수정되었습니다.",
  PAYMENT_CONFIRMATION_CONFIRMED:"입금이 확인되었습니다.",
  PAYMENT_CONFIRMATION_NOT_FOUND:"입금이 아직 확인되지 않았습니다.",
  PAYMENT_CONFIRMATION_CANCELLED:"입금 확인 요청이 취소되었습니다.",
  PAYMENT_CONFIRMATION_ADMIN_CANCELLED:"입금 확인 요청이 관리 종료되었습니다. 입금 여부는 별도로 확인해주세요.",
  PAYMENT_REQUEST_REQUESTED:"지급 요청을 확인해주세요.",
  PAYMENT_REQUEST_COMPLETED:"지급 요청이 완료 처리되었습니다.",
  PAYMENT_REQUEST_REJECTED:"지급 요청이 반려되었습니다.",
  PAYMENT_REQUEST_CANCELLED:"지급 요청이 취소되었습니다.",
  PAYMENT_REQUEST_ADMIN_CANCELLED:"지급 요청이 관리 종료되었습니다. 외부 지급 여부는 별도로 확인해주세요.",
};
export function buildPreview(d: Source, now = Date.now()) {
  if (d.category === "PUSH_SELF_TEST" && d.event_type === "ADMIN_PUSH_SELF_TEST") return { preview_version: 1, preview: { title: "[테스트 알림] 새 미리보기 확인", body: "P&M OS 알림 표시 테스트입니다. 실제 업무 처리는 필요하지 않습니다." } };
  const p = d.preview_source; if (!p) return {};
  const kind = d.category === "ANNOUNCEMENT" ? "ANNOUNCEMENT" : d.event_type || "";
  const prefix = kind === "ANNOUNCEMENT" ? "공지" : prefixes[kind]; if (!prefix) return {};
  const payment = d.category === "PAYMENT_CONFIRMATION_REQUEST" || d.category === "PAYMENT_REQUEST";
  // Structured financial identity is masked; amount/dog/account/reason never enter display.
  const subject = compact(p.subject,48);
  const label = payment ? (subject ? Array.from(subject)[0]+"**" : "") : compact(p.title, 48);
  const title = compact(`[${prefix}]${label ? " "+label : ""}`, 70);
  let body = payment ? "" : compact(p.body);
  if (kind === "ANNOUNCEMENT" && p.ack_required) body = "확인 필요 · "+body;
  if (d.category === "SCHEDULE") {
    body = compact(p.summary);
    if (kind === "SCHEDULE_REMINDER") {
      const remaining = Date.parse(d.expires_at || "") - now;
      body = [Number.isFinite(remaining) && remaining>0 ? `약 ${Math.ceil(remaining/60000)}분 후 시작` : "시작 시간 확인",body].filter(Boolean).join(" · ");
    }
    if (kind === "DAILY_SCHEDULE_SUMMARY") body = [`오늘 ${d.summary_count}건`,body].filter(Boolean).join(" · ");
  } else if (d.category === "TASK_REQUEST") {
    body = [compact(p.sender,24),body,kst(p.due_at) ? "기한 "+kst(p.due_at) : ""].filter(Boolean).join(" · ");
  } else if (payment) body = [paymentMessages[kind],"대상·금액은 요청 상세에서 확인"].filter(Boolean).join(" · ");
  return { preview_version: 1, preview: { title, body: compact(body,150) } };
}
