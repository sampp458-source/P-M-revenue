import type { Notice } from "./notificationRepository";
export function validScheduleDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function scheduleNotificationPath(notice: Notice): string | null {
  if (notice.category !== "SCHEDULE" || !["SCHEDULE", "SCHEDULE_DAY"].includes(notice.deep_link_type || "") ||
      !/^[0-9a-f-]{36}$/i.test(notice.deep_link_id || "") || !validScheduleDate(notice.schedule_local_date)) return null;
  return `/operations/calendar?notification_date=${notice.schedule_local_date}`;
}
