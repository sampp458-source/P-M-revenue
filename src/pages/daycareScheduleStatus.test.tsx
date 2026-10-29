// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render, screen } from '@testing-library/react';
const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), state: [] as Record<string, unknown>[], failure: false, selects: [] as string[] }));
vi.mock('../lib/supabase', () => ({ supabase: db }));
import { ScheduleStatus, daycareScheduleStatus } from './operationSchedulePresentation';
import { calculateOperationTodaySummary, fetchOperationSchedulesForDay, fetchOperationSchedulesForRange, type OperationSchedule, type DaycareScheduleOperation } from './operationsScheduleRepository';
import { ScheduleDetailModal } from './OperationsToday';
const entry = '2026-10-22T03:54:00Z';
const state = (lifecycleStatus: DaycareScheduleOperation['lifecycleStatus'], checkedInAt: string | null = null, checkedOutAt: string | null = null) => ({ lifecycleStatus, checkedInAt, checkedOutAt });
const fixture = (patch: Partial<OperationSchedule> = {}) => ({ id:'sancho', title:'산초 · 데이케어', status:'scheduled', businessUnitCode:'hotel', calendarName:'호텔', scheduleTypeName:'호텔 데이케어', startsAt:'2026-10-22T01:00:00Z', endsAt:'2026-10-22T07:00:00Z', allDay:false,timeUnspecified:false,version:1,createdBy:'staff',assignees:[],dogs:[],customers:[],daycareReservation:true,...patch } as OperationSchedule);
const label = (s: OperationSchedule) => renderToStaticMarkup(<ScheduleStatus status={s.status} daycare={s.daycareOperation} daycareReservation={s.daycareReservation}/>);
beforeEach(() => { cleanup(); vi.clearAllMocks(); db.state=[];db.failure=false;db.selects=[]; });
describe('canonical daycare operational presentation, independent of schedule completion', () => {
  it.each([
    [state('scheduled'),'예정'],
    [state('checked_in',entry),'이용중'],
    [state('completed',entry,'2026-10-23T08:00:00Z'),'완료'],
    [state('cancelled'),'취소'],
    [state('completed',entry),'입퇴실 확인 필요'],
    [state('checked_in',null),'입퇴실 확인 필요'],
    [state('completed',entry,'2026-10-21T08:00:00Z'),'입퇴실 확인 필요'],
    [state('checked_in',entry,'invalid'),'입퇴실 확인 필요'],
  ])('%j displays %s without deriving it from the clock', (operation, expected) => {
    expect(label(fixture({daycareOperation:operation}))).toContain(expected);
  });
  it('keeps Sancho in use even after planned16:00 and preserves scheduled workflow', () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    try { const s=fixture({daycareOperation:state('checked_in',entry)});const before=JSON.stringify(s);expect(label(s)).toContain('이용중');expect(s.status).toBe('scheduled');expect(JSON.stringify(s)).toBe(before); } finally {vi.useRealTimers();}
  });
  it('does not substitute schedule completion for actual checkout', () => {
    expect(label(fixture({status:'completed',daycareOperation:state('checked_in',entry)}))).toContain('이용중');
    expect(label(fixture({status:'completed',daycareOperation:state('scheduled')}))).toContain('예정');
  });
  it('does not equate actual checkout with a separate scheduled workflow being completed', () => {
    const s=fixture({daycareOperation:state('completed',entry,'2026-10-22T08:00:00Z')});expect(label(s)).toContain('완료');expect(s.status).toBe('scheduled');
  });
  it('does not guess missing operational data and leaves unrelated schedule types unchanged', () => {
    expect(label(fixture())).toContain('입퇴실 확인 필요');
    for(const status of ['scheduled','completed','cancelled'] as const) expect(label(fixture({status,daycareReservation:false}))).toContain({scheduled:'예정',completed:'완료',cancelled:'취소'}[status]);
    expect(daycareScheduleStatus(null)).toBeNull();
  });
  it('does not change department totals, pending/overdue schedule counts, or input', () => {
    const rows=[fixture({daycareOperation:state('checked_in',entry)}),fixture({id:'closed',status:'completed',daycareOperation:state('completed',entry,'2026-10-22T08:00:00Z')}),fixture({id:'school',businessUnitCode:'daycare',daycareReservation:false})];
    const before=JSON.stringify(rows);expect(calculateOperationTodaySummary(rows)).toEqual({total:3,countSum:3,counts:{daycare:1,hotel:2,training:0,common:0}});rows.forEach(label);expect(rows.filter(s=>s.status==='scheduled')).toHaveLength(2);expect(JSON.stringify(rows)).toBe(before);
  });
  it('detail shows operational and schedule statuses independently without invoking a command', () => {
    const noop=vi.fn();render(<ScheduleDetailModal schedule={fixture({daycareOperation:state('checked_in',entry)})} processing={false} canManage={false} onClose={noop} onEdit={noop} onComplete={noop} onCancel={noop} onArchive={noop} onOpenDog={noop} onOpenCustomer={noop}/>);
    expect(screen.getByText('이용중')).toBeTruthy();expect(screen.getByText('일정 업무 처리(운영 상태와 별도): 예정')).toBeTruthy();expect(db.rpc).not.toHaveBeenCalled();expect(noop).not.toHaveBeenCalled();
  });
});
function setupReads() {
  const s=fixture();
  db.rpc.mockResolvedValue({data:[s],error:null});
  db.from.mockImplementation((table:string)=>{
    const rows=table==='daycare_operation_states'?db.state:table==='operation_schedules'?[{...s,starts_at:s.startsAt,ends_at:s.endsAt,calendar_id:'hotel',schedule_type_id:'daycare',created_at:s.startsAt}]:[];
    const result=Promise.resolve({data:rows,error:table==='daycare_operation_states'&&db.failure?{code:'42501',message:'denied'}:null});
    const q=Object.assign(result,{select:vi.fn((fields:string)=>{if(table==='daycare_operation_states')db.selects.push(fields);return q;}),in:vi.fn(),is:vi.fn(),lt:vi.fn(),gt:vi.fn(),order:vi.fn()});
    for(const f of [q.in,q.is,q.lt,q.gt,q.order])f.mockReturnValue(q);return q;
  });
}
describe('date-scoped batched canonical state read',()=>{
  it.each(['2026-10-17','2026-10-22','2026-10-23'])('day and range reads retain canonical identity for %s and refresh state',async date=>{
    setupReads();db.state=[{operation_schedule_id:'sancho',lifecycle_status:'checked_in',checked_in_at:entry,checked_out_at:null}];
    const options={calendars:[],scheduleTypes:[],assignees:[],dogs:[],customers:[]};
    for(const load of [()=>fetchOperationSchedulesForDay(date),()=>fetchOperationSchedulesForRange(date,'2026-10-24',options)]) {
      db.state=[{operation_schedule_id:'sancho',lifecycle_status:'checked_in',checked_in_at:entry,checked_out_at:null}];db.from.mockClear();const rows=await load();expect(rows[0].daycareReservation).toBe(true);expect(label(rows[0])).toContain('이용중');expect(db.from.mock.calls.filter(([t])=>t==='daycare_operation_states')).toHaveLength(1);
      db.state=[{...db.state[0],lifecycle_status:'completed',checked_out_at:'2026-10-23T08:00:00Z'}];expect(label((await load())[0])).toContain('완료');
    }
    expect(db.selects.every(x=>x==='operation_schedule_id, lifecycle_status, checked_in_at, checked_out_at')).toBe(true);
  });
  it('propagates denied state reads instead of inventing a scheduled status',async()=>{setupReads();db.failure=true;await expect(fetchOperationSchedulesForDay('2026-10-22')).rejects.toThrow('권한');});
});
