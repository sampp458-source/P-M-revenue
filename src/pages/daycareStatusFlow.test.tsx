// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {render,fireEvent,cleanup} from '@testing-library/react';
import {DayDrawer,MonthScheduleCard} from './OperationsCalendarFoundation';
import {ScheduleRow,ScheduleDetailModal} from './OperationsToday';
import {daycareOperationalStatus,type DaycareStatusSource} from './daycareOperationalStatus';
import {MobileCalendarStatusSummary} from './operationSchedulePresentation';
import {useScheduleOperationalRefresh} from './useScheduleOperationalRefresh';
import {calculateOperationTodaySummary,type DaycareScheduleOperation,type OperationSchedule} from './operationsScheduleRepository';
vi.mock('../lib/supabase',()=>({supabase:{rpc:vi.fn(),from:vi.fn()}}));
const flow=JSON.parse(readFileSync('src/pages/__fixtures__/daycareStatusFlow.json','utf8')) as {source:string;states:Array<DaycareScheduleOperation&{scheduleStatus:OperationSchedule['status']}>;secondReader:DaycareStatusSource};
const item=(s:typeof flow.states[number])=>({id:'synthetic-visit',calendarId:'hotel',calendarColor:'#C99845',calendarScope:'business_unit',businessUnitName:'호텔',scheduleTypeId:'hotel-daycare',scheduleTypeColor:'#C99845',memo:null,version:1,requestId:'synthetic',createdBy:'synthetic',createdByName:'합성',createdAt:'2026-10-27T00:00Z',updatedBy:'synthetic',updatedByName:'합성',updatedAt:'2026-10-27T00:00Z',archivedAt:null,title:'합성 Daycare',status:s.scheduleStatus,calendarName:'호텔',businessUnitCode:'hotel',scheduleTypeName:'호텔 데이케어',startsAt:'2026-10-27T01:30Z',endsAt:'2026-10-27T10:00Z',allDay:false,timeUnspecified:false,assignees:[],dogs:[],customers:[],daycareReservation:true,daycareOperation:s} as OperationSchedule);
const noop=()=>{};
afterEach(cleanup);
describe('Real isolated DB lifecycle snapshots through every schedule presentation',()=>{
 it('fixture provenance is official real DB lifecycle with real triggers',()=>expect(flow.source).toContain('real isolated DB official create'));
 for(const [i,s] of flow.states.entries())it(`real DB stage ${i} agrees across Today, month, date drawer and detail`,()=>{
  const row=item(s),label=daycareOperationalStatus(s)!.label;
  const before=JSON.stringify(row);
  const today=renderToStaticMarkup(<ScheduleRow schedule={row} onOpen={noop}/>);
  const month=renderToStaticMarkup(<MonthScheduleCard schedule={row}/>);
  const detail=renderToStaticMarkup(<ScheduleDetailModal schedule={row} processing={false} canManage={false} onClose={noop} onEdit={noop} onComplete={noop} onCancel={noop} onArchive={noop} onOpenDog={noop} onOpenCustomer={noop}/>);
  for(const html of [today,month,detail])expect(html).toContain(label);expect(month).toContain('data-daycare="true"');
  for(const date of ['2026-10-26','2026-10-27','2026-10-29']){
   const html=renderToStaticMarkup(<DayDrawer open date={date} schedules={[row]} loading={false} error="" onOpen={noop} onRetry={noop} onClose={noop} onPrevious={noop} onNext={noop} onAdd={noop} onAddDaycare={noop}/>);
   expect(html).toContain(`data-daycare-state="${s.lifecycleStatus}"`);expect(html).toContain(label);
  }
  expect(JSON.stringify(row)).toBe(before);
 });
 it('second actual DB Operations reader observes completed independently',()=>expect(daycareOperationalStatus(flow.secondReader)?.label).toBe('완료'));
 it('operational summary separates in-use/completed without mutating workflow or department totals',()=>{
  const rows=flow.states.map(s=>item(s));const before=JSON.stringify(rows);
  const html=renderToStaticMarkup(<MobileCalendarStatusSummary schedules={rows} id="status-counts"/>);
  expect(html).toContain('예정 2건');expect(html).toContain('이용중 1건');expect(html).toContain('완료 1건');
  expect(calculateOperationTodaySummary(rows).counts.hotel).toBe(4);expect(JSON.stringify(rows)).toBe(before);
 });
 it('focus and visible return refresh canonical data once, not commands',async()=>{
  let resolve:()=>void=()=>{};const refresh=vi.fn(()=>new Promise<void>(r=>{resolve=r;}));
  function View(){useScheduleOperationalRefresh(refresh);return null;}
  const v=render(<View/>);fireEvent(window,new Event('focus'));fireEvent(document,new Event('visibilitychange'));expect(refresh).toHaveBeenCalledTimes(1);resolve();await Promise.resolve();await Promise.resolve();v.unmount();fireEvent(window,new Event('focus'));expect(refresh).toHaveBeenCalledTimes(1);
 });
});
