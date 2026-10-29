// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DayDrawer } from './OperationsCalendarFoundation';
import { calculateOperationTodaySummary, type OperationSchedule } from './operationsScheduleRepository';

const entry = '2026-10-27T01:20:00Z';
const exit = '2026-10-27T07:00:00Z';
const fixture = (patch: Partial<OperationSchedule> = {}) => ({
  id: 'sancho-1027', title: '산초 · 데이케어', status: 'scheduled',
  calendarName: '호텔', businessUnitCode: 'hotel', scheduleTypeName: '호텔 데이케어',
  startsAt: entry, endsAt: exit, allDay: false, timeUnspecified: false,
  assignees: [], dogs: [], customers: [], daycareReservation: true,
  daycareOperation: { lifecycleStatus: 'scheduled', checkedInAt: null, checkedOutAt: null },
  ...patch,
} as OperationSchedule);

function open(rows: OperationSchedule[], date = '2026-10-27') {
  const onOpen = vi.fn();
  const controls = {onRetry: vi.fn(), onClose: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), onAdd: vi.fn(), onAddDaycare: vi.fn()};
  render(<DayDrawer open date={date} schedules={rows} loading={false} error="" onOpen={onOpen} {...controls}/>);
  return { onOpen, ...controls };
}
afterEach(cleanup);

describe('Calendar day drawer uses canonical Daycare state without completing workflow', () => {
  for (const date of ['2026-10-27', '2026-10-28', '2026-10-29']) {
    it.each([
      ['scheduled', null, null, '예정'],
      ['checked_in', entry, null, '이용중'],
      ['completed', entry, exit, '완료'],
      ['cancelled', null, null, '취소'],
    ] as const)(`${date}: %s displays %s from actual state, independently of selected day`, (lifecycleStatus, checkedInAt, checkedOutAt, expected) => {
      const row = fixture({daycareOperation: {lifecycleStatus, checkedInAt, checkedOutAt}});
      const before = JSON.stringify(row);
      open([row], date);
      expect(screen.getByText(expected, {selector: '.pm-schedule-status'})).toBeTruthy();
      expect(JSON.stringify(row)).toBe(before);
      expect(row.status).toBe('scheduled');
    });
  }
  it.each([
    {daycareReservation: true, daycareOperation: null},
    {daycareReservation: true, daycareOperation: {lifecycleStatus:'completed', checkedInAt:null, checkedOutAt:null}},
  ] as Partial<OperationSchedule>[])('does not invent actual use for missing or inconsistent state', patch => {
    open([fixture(patch)]);
    expect(screen.getByText('입퇴실 확인 필요')).toBeTruthy();
    expect(screen.queryByText('완료')).toBeNull();
  });
  it('keeps 10/27 unprocessed Sancho and Loki scheduled and opens the exact record', () => {
    const rows = [fixture(), fixture({id:'loki-1027',title:'로키 · 데이케어',startsAt:'2026-10-27T01:30:00Z'})];
    const {onOpen} = open(rows);
    expect(screen.getAllByText('예정', {selector:'.pm-schedule-status'})).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', {name:/로키 · 데이케어/}));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(rows[1]);
  });
  it.each(['hotel','training','daycare'] as const)('preserves ordinary %s schedule status', businessUnitCode => {
    open([fixture({businessUnitCode,daycareReservation:false,daycareOperation:null,status:'completed'})]);
    expect(screen.getByText('완료', {selector:'.pm-schedule-status'})).toBeTruthy();
  });
  it('preserves normal checkout and administrative-release presentation with unchanged totals', () => {
    const rows = [fixture({id:'nai',status:'completed',daycareOperation:{lifecycleStatus:'completed',checkedInAt:entry,checkedOutAt:exit}}),
      fixture({id:'bobby',daycareOperation:{lifecycleStatus:'administratively_released',checkedInAt:entry,checkedOutAt:null}}),
      ...['arim','hoseung'].map(id=>fixture({id,status:'completed',daycareOperation:{lifecycleStatus:'completed',checkedInAt:entry,checkedOutAt:exit}}))];
    const before = JSON.stringify(rows);
    const summary = calculateOperationTodaySummary(rows);
    open(rows);
    expect(screen.getAllByText('완료')).toHaveLength(3);
    expect(screen.getByText('행정 점유 해제 · 실제 퇴실시각 미확정')).toBeTruthy();
    expect(calculateOperationTodaySummary(rows)).toEqual(summary);
    expect(rows.filter(s=>s.status==='scheduled')).toHaveLength(1);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
