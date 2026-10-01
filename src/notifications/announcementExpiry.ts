export const announcementExpiryError = "게시 종료 시간은 현재보다 이후로 설정해주세요.";

// datetime-local is a Seoul wall-clock value, independent of the device timezone.
export function announcementExpiryLocal(value: string | number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value)).replace(" ", "T");
}
export function announcementExpiryMin(now = Date.now()): string {
  return announcementExpiryLocal((Math.floor(now / 60000) + 1) * 60000);
}
export function announcementExpiryUtc(value: string, now = Date.now()): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error(announcementExpiryError);
  const timestamp = Date.parse(`${value}:00+09:00`);
  if (!Number.isFinite(timestamp) || timestamp <= now || announcementExpiryLocal(timestamp) !== value)
    throw new Error(announcementExpiryError);
  return new Date(timestamp).toISOString();
}
