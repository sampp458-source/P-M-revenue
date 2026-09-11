// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
const m=vi.hoisted(()=>({snapshot:vi.fn(),history:vi.fn(),completed:vi.fn(),event:vi.fn(),shared:vi.fn(),unassigned:vi.fn(),daycare:vi.fn(),profile:{id:'local-test-user'}}));
vi.mock('../auth/AuthContext',()=>({useAuth:()=>({profile:m.profile})}));
vi.mock('./hotelOperationsRepository',async original=>({...await original<typeof import('./hotelOperationsRepository')>(),fetchHotelOperationsSnapshot:m.snapshot,fetchHotelEventRoomProjections:m.event}));
vi.mock('./hotelHistoricalBoardRepository',()=>({fetchHistoricalBoard:m.history}));
vi.mock('./sharedHotelHistoryRepository',()=>({fetchCompletedSharedStays:m.completed}));
vi.mock('../platform/multiDogSharedRoomRepository',()=>({sharedHotelRoomRepository:{listForDate:m.shared,listUnassigned:m.unassigned}}));
vi.mock('./daycareOperationsRepository',async original=>({...await original<typeof import('./daycareOperationsRepository')>(),fetchDaycareOperationsForDate:m.daycare}));
vi.mock('./operationsScheduleRepository',async original=>({...await original<typeof import('./operationsScheduleRepository')>(),seoulDateKey:()=> '2032-01-03',fetchOperationScheduleOptions:async()=>({calendars:[],scheduleTypes:[],assignees:[],customers:[],dogs:[]}),fetchCurrentOperationRole:async()=> 'admin'}));
vi.mock('./LongStayOperationsPanel',()=>({LongStayOperationsPanel:()=>null}));
vi.mock('./DaycareOperationsPanel',()=>({DaycareOperationsPanel:()=>null}));
vi.mock('./HotelRoomBoard',()=>({HotelRoomBoard:({selectedDate,dateMode,historicalBoard}:{selectedDate:string;dateMode:string;historicalBoard?:{selectedDate:string}})=><p data-testid="loaded-board">{selectedDate} / {dateMode} / {historicalBoard?.selectedDate}</p>}));
import {HotelOperationsPage} from './HotelOperations';
const snapshot=(date:string)=>({date,roomTypes:[],rooms:[],settings:null,stays:[],unassignedFuture:[]});
function deferred<T>() {let resolve!:(v:T)=>void;let reject!:(e:Error)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
afterEach(()=>{cleanup();vi.clearAllMocks();});
beforeEach(()=>{m.snapshot.mockImplementation(async date=>snapshot(date));m.history.mockImplementation(async date=>({selectedDate:date}));m.completed.mockResolvedValue([]);m.event.mockResolvedValue(new Map());m.shared.mockResolvedValue([]);m.unassigned.mockResolvedValue([]);m.daycare.mockResolvedValue([]);});
it('waits for matching date evidence and makes only one historical call per completed date load',async()=>{
 render(<MemoryRouter><HotelOperationsPage/></MemoryRouter>);
 await waitFor(()=>expect(screen.getByTestId('loaded-board')).toHaveTextContent('2032-01-03 / TODAY'));
 const input=screen.getByLabelText('운영 날짜');
 for(const date of ['2032-01-01','2032-01-02','2032-01-03','2032-01-04']){
  const pending=deferred<ReturnType<typeof snapshot>>();m.snapshot.mockReturnValueOnce(pending.promise);
  const previous=screen.getByTestId('loaded-board');const text=previous.textContent;
  fireEvent.change(input,{target:{value:date}});
  expect(screen.getByTestId('loaded-board')).toBe(previous);expect(previous.textContent).toBe(text);
  expect(screen.getByTestId('hotel-date-presentation')).toHaveAttribute('inert');
  await act(async()=>pending.resolve(snapshot(date)));
  await waitFor(()=>{expect(screen.getByTestId('loaded-board')).toHaveTextContent(date);expect(screen.getByTestId('hotel-date-presentation')).not.toHaveAttribute('inert');});
 }
 expect(m.history.mock.calls.map(c=>c[0])).toEqual(['2032-01-01','2032-01-02']);
 expect(m.shared).toHaveBeenCalledTimes(5);expect(m.snapshot).toHaveBeenCalledTimes(5);
});
it('ignores late older snapshot responses during rapid selection',async()=>{
 render(<MemoryRouter><HotelOperationsPage/></MemoryRouter>);await screen.findByTestId('loaded-board');
 const first=deferred<ReturnType<typeof snapshot>>(),last=deferred<ReturnType<typeof snapshot>>();
 m.snapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
 const input=screen.getByLabelText('운영 날짜');
 fireEvent.change(input,{target:{value:'2032-01-01'}});fireEvent.change(input,{target:{value:'2032-01-02'}});
 await act(async()=>last.resolve(snapshot('2032-01-02')));
 await waitFor(()=>expect(screen.getByTestId('loaded-board')).toHaveTextContent('2032-01-02 / PAST'));
 await act(async()=>first.resolve(snapshot('2032-01-01')));
 expect(screen.getByTestId('loaded-board')).toHaveTextContent('2032-01-02 / PAST');
 expect(m.history.mock.calls.map(c=>c[0])).toEqual(['2032-01-02']);
});
it('keeps the previous board until historical evidence arrives and preserves it on history failure',async()=>{
 render(<MemoryRouter><HotelOperationsPage/></MemoryRouter>);await screen.findByTestId('loaded-board');
 const historyPending=deferred<{selectedDate:string}>();m.history.mockReturnValueOnce(historyPending.promise);
 const input=screen.getByLabelText('운영 날짜');fireEvent.change(input,{target:{value:'2032-01-01'}});
 await waitFor(()=>expect(m.history).toHaveBeenCalledWith('2032-01-01'));
 expect(screen.getByTestId('loaded-board')).toHaveTextContent('2032-01-03 / TODAY');
 expect(screen.getByLabelText('운영 날짜')).toBe(input);
 await act(async()=>historyPending.resolve({selectedDate:'2032-01-01'}));
 await waitFor(()=>expect(screen.getByTestId('loaded-board')).toHaveTextContent('2032-01-01 / PAST'));
 m.history.mockRejectedValueOnce(new Error('synthetic failure'));
 fireEvent.change(input,{target:{value:'2032-01-02'}});
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('선택일 실제 객실 기록을 확인하지 못했습니다.'));
 expect(screen.getByTestId('loaded-board')).toHaveTextContent('2032-01-01 / PAST');
 expect(screen.getByTestId('hotel-date-presentation')).toHaveAttribute('inert');
});

it('does not use a retained A snapshot for the new A generation during A → B → A',async()=>{
 render(<MemoryRouter><HotelOperationsPage/></MemoryRouter>);await screen.findByTestId('loaded-board');
 const input=screen.getByLabelText('운영 날짜');
 fireEvent.change(input,{target:{value:'2032-01-01'}});
 await waitFor(()=>{expect(screen.getByTestId('loaded-board')).toHaveTextContent('2032-01-01 / PAST');expect(screen.getByTestId('hotel-date-presentation')).not.toHaveAttribute('inert');});
 const beforeEvent=m.event.mock.calls.length,beforeCompleted=m.completed.mock.calls.length;
 const b=deferred<ReturnType<typeof snapshot>>(),a=deferred<ReturnType<typeof snapshot>>();
 m.snapshot.mockReturnValueOnce(b.promise).mockReturnValueOnce(a.promise);
 fireEvent.change(input,{target:{value:'2032-01-02'}});
 fireEvent.change(input,{target:{value:'2032-01-01'}});
 expect(m.history.mock.calls.map(c=>c[0])).toEqual(['2032-01-01']);
 expect(m.event).toHaveBeenCalledTimes(beforeEvent);expect(m.completed).toHaveBeenCalledTimes(beforeCompleted);
 expect(screen.getByTestId('hotel-date-presentation')).toHaveAttribute('inert');
 await act(async()=>a.resolve(snapshot('2032-01-01')));
 await waitFor(()=>expect(screen.getByTestId('hotel-date-presentation')).not.toHaveAttribute('inert'));
 expect(m.history.mock.calls.map(c=>c[0])).toEqual(['2032-01-01','2032-01-01']);
 expect(m.event).toHaveBeenCalledTimes(beforeEvent+1);expect(m.completed).toHaveBeenCalledTimes(beforeCompleted+1);
 await act(async()=>b.resolve(snapshot('2032-01-02')));
 expect(m.history).toHaveBeenCalledTimes(2);expect(screen.getByTestId('loaded-board')).toHaveTextContent('2032-01-01 / PAST');
});
it.each(['success','history_failure','snapshot_failure'] as const)('locks repeated retry until the matching pipeline settles (%s)',async outcome=>{
 render(<MemoryRouter><HotelOperationsPage/></MemoryRouter>);await screen.findByTestId('loaded-board');
 m.history.mockRejectedValueOnce(new Error('initial historical failure'));
 fireEvent.change(screen.getByLabelText('운영 날짜'),{target:{value:'2032-01-01'}});
 const retry=await screen.findByRole('button',{name:'다시 시도'});
 const baseCount=m.snapshot.mock.calls.length,historyCount=m.history.mock.calls.length;
 const pending=deferred<ReturnType<typeof snapshot>>(),historyPending=deferred<{selectedDate:string}>(),eventPending=deferred<Map<string,never>>();
 m.snapshot.mockReturnValueOnce(pending.promise);
 if(outcome!=='snapshot_failure')m.history.mockReturnValueOnce(historyPending.promise);
 if(outcome==='success')m.event.mockReturnValueOnce(eventPending.promise);
 act(()=>{fireEvent.click(retry);fireEvent.click(retry);fireEvent.doubleClick(retry);});
 expect(m.snapshot).toHaveBeenCalledTimes(baseCount+1);
 expect(screen.getByRole('button',{name:'재시도 중…'})).toBeDisabled();
 expect(screen.getByRole('status')).toHaveTextContent('다시 불러오는 중');
 expect(screen.getByTestId('hotel-date-presentation')).toHaveAttribute('inert');
 if(outcome==='snapshot_failure'){
  await act(async()=>pending.reject(new Error('snapshot failed')));
 }else{
  await act(async()=>pending.resolve(snapshot('2032-01-01')));
  expect(m.history).toHaveBeenCalledTimes(historyCount+1);
  expect(screen.getByRole('button',{name:'재시도 중…'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'재시도 중…'}));expect(m.snapshot).toHaveBeenCalledTimes(baseCount+1);
  if(outcome==='history_failure')await act(async()=>historyPending.reject(new Error('retry historical failure')));
  else{
   await act(async()=>historyPending.resolve({selectedDate:'2032-01-01'}));
   expect(screen.getByRole('button',{name:'재시도 중…'})).toBeDisabled();
   await act(async()=>eventPending.resolve(new Map<string,never>()));
  }
 }
 if(outcome==='success'){
  await waitFor(()=>expect(screen.getByTestId('hotel-date-presentation')).not.toHaveAttribute('inert'));
  expect(screen.queryByRole('button',{name:/재시도 중|다시 시도/})).toBeNull();
 }else{
  const nextRetry=await screen.findByRole('button',{name:'다시 시도'});expect(nextRetry).toBeEnabled();
  expect(screen.getByTestId('hotel-date-presentation')).toHaveAttribute('inert');
  fireEvent.click(nextRetry);
  await waitFor(()=>expect(screen.getByTestId('hotel-date-presentation')).not.toHaveAttribute('inert'));
  expect(m.snapshot).toHaveBeenCalledTimes(baseCount+2);
 }
 expect(screen.getByTestId('loaded-board')).toHaveTextContent('2032-01-01 / PAST');
});

it('012 A→B→C→D starts follow-up reads only for the final completed generation',async()=>{
 render(<MemoryRouter><HotelOperationsPage/></MemoryRouter>);await screen.findByTestId('loaded-board');
 const eventBefore=m.event.mock.calls.length;
 const pending=['2031-12-29','2031-12-30','2031-12-31'].map(date=>({date,...deferred<ReturnType<typeof snapshot>>()}));
 for(const item of pending){m.snapshot.mockReturnValueOnce(item.promise);fireEvent.change(screen.getByLabelText('운영 날짜'),{target:{value:item.date}});}
 expect(screen.getByTestId('loaded-board')).toHaveTextContent('2032-01-03');
 await act(async()=>pending[2].resolve(snapshot(pending[2].date)));
 await waitFor(()=>expect(screen.getByTestId('loaded-board')).toHaveTextContent(pending[2].date));
 await act(async()=>{pending[0].resolve(snapshot(pending[0].date));pending[1].resolve(snapshot(pending[1].date));});
 expect(screen.getByTestId('loaded-board')).toHaveTextContent(pending[2].date);
 expect(m.history.mock.calls.map(call=>call[0])).toEqual([pending[2].date]);expect(m.event).toHaveBeenCalledTimes(eventBefore+1);
});
