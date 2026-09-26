import { operationPersonDisplayName, schedulePrimaryAssignee, type OperationSchedule } from './operationsScheduleRepository';

// Existing Production Today summary palette. Business identity is independent of lifecycle status.
export const SCHEDULE_BUSINESSES = {
  daycare: { label: '유치원', color: '#52B8D0' },
  training: { label: '교육센터', color: '#4568B2' },
  hotel: { label: '호텔', color: '#C99845' },
  common: { label: '공통', color: '#5B7FA3' },
} as const;
export function scheduleBusiness(schedule: Pick<OperationSchedule, 'businessUnitCode'>) {
  return SCHEDULE_BUSINESSES[schedule.businessUnitCode ?? 'common'];
}
export function scheduleAssigneeLabel(schedule: OperationSchedule) {
  const primary = schedulePrimaryAssignee(schedule);
  if (!primary) return '담당 미지정';
  const others = schedule.assignees.filter(person => person.id !== primary.id).length;
  return `담당 ${operationPersonDisplayName(primary)}${others ? ` 외 ${others}명` : ''}`;
}
export function ScheduleBusinessMarker({ schedule }: { schedule: OperationSchedule }) {
  const business = scheduleBusiness(schedule);
  return <span className="pm-schedule-business"><i aria-hidden="true" style={{ backgroundColor: business.color }} />{business.label}</span>;
}
export function ScheduleStatus({ status }: { status: OperationSchedule['status'] }) {
  return <span className="pm-schedule-status" data-status={status}>{status === 'completed' ? '완료' : status === 'cancelled' ? '취소' : '예정'}</span>;
}
export function SchedulePeople({ schedule }: { schedule: OperationSchedule }) {
  return <div className="pm-schedule-people">
    {schedule.dogs.length > 0 && <span className="pm-schedule-dogs">{schedule.dogs.map(dog => dog.name).join(' · ')}</span>}
    <span className="pm-schedule-assignee" data-unassigned={schedule.assignees.length === 0} title={schedule.assignees.map(operationPersonDisplayName).join(' · ')}>{scheduleAssigneeLabel(schedule)}</span>
  </div>;
}

const MONTH_STATUSES = [
  { status: 'scheduled', label: '예정' },
  { status: 'completed', label: '완료' },
  { status: 'cancelled', label: '취소' },
] as const;

export function MobileCalendarStatusLegend() {
  return <div className="pm-month-status-legend" aria-label="일정 상태 색상">
    {MONTH_STATUSES.map(({ status, label }) => <span key={status} data-status={status}><i aria-hidden="true" />{label}</span>)}
  </div>;
}

// Counts summarize the supplied date's existing records; no filtering or domain state changes.
export function MobileCalendarStatusSummary({ schedules, id }: { schedules: OperationSchedule[]; id: string }) {
  const counts = MONTH_STATUSES.map(item => ({ ...item, count: schedules.filter(schedule => schedule.status === item.status).length })).filter(item => item.count > 0);
  if (!counts.length) return null;
  const description = counts.map(({ label, count }) => `${label} ${count}건`).join(', ');
  return <span id={id} className="pm-month-status-summary" role="img" aria-label={description} title={description}>
    {counts.map(({ status, count }) => <span key={status} data-status={status} aria-hidden="true"><i />{count}</span>)}
  </span>;
}
