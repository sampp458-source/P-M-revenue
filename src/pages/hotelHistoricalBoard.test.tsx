// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
const db=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:db}));
import {fetchHistoricalBoard, parseHistoricalBoard, type HistoricalBoard, type HistoricalSegment} from './hotelHistoricalBoardRepository';
import {HotelHistoricalRoomGrid, historicalOccupantSlices} from './HotelHistoricalRoomGrid';
afterEach(()=>{cleanup();vi.clearAllMocks();});
const segment: HistoricalSegment={segmentId:'segment',stayId:'stay',dogId:'dog',dogName:'합성견',lifecycleKind:'single',roomId:'a',usedFrom:'2032-01-01T01:00:00Z',usedUntil:'2032-01-01T03:00:00Z',displayFrom:'2032-01-01T01:00:00Z',displayUntil:'2032-01-01T03:00:00Z',selectedDayEvents:['check_in','moved_out'],provenanceStatus:'verified',coverageClassification:'verified_supported_path'};
const history: HistoricalBoard={selectedDate:'2032-01-01',timezone:'Asia/Seoul',evidenceAsOf:'2032-01-03T00:00:00Z',readOnly:true,coverageStatus:'PARTIAL',rooms:[{roomId:'a',roomName:'합성 A',roomTypeId:'type',roomType:'합성 유형',segments:[segment]},{roomId:'b',roomName:'합성 B',roomTypeId:'type',roomType:'합성 유형',segments:[{...segment,segmentId:'next',roomId:'b',usedFrom:'2032-01-01T03:00:00Z',displayFrom:'2032-01-01T03:00:00Z',usedUntil:'2032-01-01T09:00:00Z',displayUntil:'2032-01-01T09:00:00Z',selectedDayEvents:['moved_in','check_out']}]},{roomId:'c',roomName:'합성 C',roomTypeId:'type',roomType:'합성 유형',segments:[]}],unavailable:[{stayId:'unknown',dogId:'unknownDog',dogName:'미확인견',lifecycleKind:'shared',reasonCode:'SHARED_PARTICIPATION_UNPROVEN',affectedFrom:'2032-01-01T01:00:00Z',affectedUntil:'2032-01-01T09:00:00Z',coverageClassification:'unavailable'}]};
describe('010 actual-use room grid',()=>{
 it('keeps both room segments and same-day transitions with detail-only buttons',()=>{
  const open=vi.fn();render(<HotelHistoricalRoomGrid history={history} onOpenStay={open}/>);
  expect(screen.getByText('합성 A')).toBeVisible();expect(screen.getByText('합성 B')).toBeVisible();
  expect(screen.getByText('당일 입실 · 이동 퇴실')).toBeVisible();expect(screen.getByText('이동 입실 · 당일 퇴실')).toBeVisible();
  fireEvent.click(screen.getByText(/객실 정보 확인 필요 · 1마리/));
  fireEvent.click(screen.getByRole('button',{name:/미확인견/}));expect(open).toHaveBeenCalledWith('unknown');
  expect(screen.queryByRole('button',{name:/배정|이동 실행|입실 처리|퇴실 처리/})).not.toBeInTheDocument();
  expect(document.querySelector('[draggable="true"]')).toBeNull();
 });
 it('does not claim an empty historical room from missing coverage',()=>{
  render(<HotelHistoricalRoomGrid history={history} onOpenStay={vi.fn()}/>);
  expect(screen.queryByText('확인된 사용 기록 없음')).not.toBeInTheDocument();expect(screen.getByRole('note')).toHaveTextContent('당시 빈 객실이었다는 의미는 아닙니다');
 });
 it('shows fetch error without falling back to current room data',()=>{
  render(<HotelHistoricalRoomGrid history={history} error="조회 실패" onOpenStay={vi.fn()}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('조회 실패');expect(screen.queryByText('합성 A')).not.toBeInTheDocument();
 });
 it('uses one read RPC for every lifecycle and never per stay',async()=>{
  db.rpc.mockResolvedValue({data:history,error:null});expect(await fetchHistoricalBoard(history.selectedDate)).toEqual(history);
  expect(db.rpc).toHaveBeenCalledTimes(1);expect(db.rpc).toHaveBeenCalledWith('get_hotel_historical_room_board',{p_local_date:history.selectedDate});
 });
 it.each([null,{...history,readOnly:false},{...history,selectedDate:'2032-01-02'},{...history,rooms:[{...history.rooms[0],segments:[{...segment,provenanceStatus:'unavailable'}]}]},{...history,rooms:[{...history.rooms[0],segments:[{...segment,displayUntil:segment.displayFrom}]}]},{...history,rooms:[{...history.rooms[0],segments:[segment,segment]}]}])('rejects untrusted or conflicting DTOs',data=>{
  expect(()=>parseHistoricalBoard(data,history.selectedDate)).toThrow();
 });
 it('rejects RPC failure without secondary source queries',async()=>{
  db.rpc.mockResolvedValue({data:null,error:{message:'denied'}});await expect(fetchHistoricalBoard(history.selectedDate)).rejects.toThrow();expect(db.rpc).toHaveBeenCalledTimes(1);
 });
 it.each([
  ['2032-01-01T03:00:00Z','2032-01-01T03:00:00Z'],
  ['2032-01-01T09:00:00Z','2032-01-01T03:00:00Z'],
  ['2031-12-31T14:00:00Z','2032-01-01T03:00:00Z'],
  ['2032-01-01T03:00:00Z','2032-01-01T16:00:00Z'],
  ['invalid','2032-01-01T03:00:00Z'],
 ])('rejects unavailable outside the positive selected-day intersection (%s, %s)',(affectedFrom,affectedUntil)=>{
  expect(()=>parseHistoricalBoard({...history,unavailable:[{...history.unavailable[0],affectedFrom,affectedUntil}]},history.selectedDate)).toThrow();
 });
 it('accepts a positive unavailable intersection without promoting it to a room',()=>{
  const value=parseHistoricalBoard({...history,rooms:[]},history.selectedDate);
  expect(value.unavailable).toHaveLength(1);expect(value.rooms).toEqual([]);
 });

 it.each([false,true])('reuses room frames and type groups, including shared members (mobile=%s)',mobile=>{
  const shared={...segment,lifecycleKind:'shared' as const,physicalOccupancyId:'synthetic-occupancy'};
  const board={...history,rooms:[{...history.rooms[0],roomType:'DELUXE',segments:[shared,{...shared,segmentId:'member-2',stayId:'stay-2',dogName:'합성동반견'}]},{...history.rooms[2],roomType:'STANDARD'}]};
  const open=vi.fn();render(<HotelHistoricalRoomGrid history={board} onOpenStay={open} mobile={mobile}/>);
  const cell=screen.getByTestId('hotel-room-board-room-a');
  expect(cell).toHaveClass('rounded-xl','border',mobile?'min-h-[4.5rem]':'min-h-[5.5rem]');
  expect(screen.getByText('같은 방 투숙')).toBeVisible();expect(screen.getByText('함께 투숙 · 2마리 · 객실 1실')).toBeVisible();
  expect(screen.getAllByRole('note')).toHaveLength(1);
  expect(screen.queryByText(/실 잔여|빈방/)).not.toBeInTheDocument();
  expect(screen.getByTestId('hotel-room-board-room-c')).toHaveClass('bg-transparent');
  fireEvent.click(screen.getByRole('button',{name:/합성동반견/}));expect(open).toHaveBeenCalledWith('stay-2');
  expect(document.querySelector('[draggable="true"]')).toBeNull();
  const group=screen.getByRole('region',{name:mobile?'DELUXE 모바일 Room Board':'DELUXE Room Board'});
  expect(group.querySelector(mobile?'.grid-cols-1':'.grid-cols-6')).not.toBeNull();
 });

});

describe('historical concurrent membership and display time',()=>{
 const member=(id:string,from:number,until:number,occupancy='shared'):HistoricalSegment=>({...segment,segmentId:id,stayId:id,dogId:id,dogName:id,lifecycleKind:'shared',physicalOccupancyId:occupancy,usedFrom:`2032-01-01T0${from}:00:00Z`,usedUntil:`2032-01-01T0${until}:00:00Z`,displayFrom:`2032-01-01T0${from}:00:00Z`,displayUntil:`2032-01-01T0${until}:00:00Z`});
 const show=(segments:HistoricalSegment[])=>render(<HotelHistoricalRoomGrid history={{...history,rooms:[{...history.rooms[0],segments}],unavailable:[]}} onOpenStay={vi.fn()}/>);
 it('groups two members only in their positive common interval',()=>{
  const rows=[member('A',1,4),member('B',2,3)];
  expect(historicalOccupantSlices(rows).map(s=>s.items.map(x=>x.stayId))).toEqual([['A'],['A','B'],['A']]);
  show(rows);expect(screen.getByText('함께 투숙 · 2마리 · 객실 1실')).toBeVisible();
 });
 it.each([[2,3],[2,2]])('does not group sequential or touching members (%s,%s)',(aEnd,bStart)=>{
  const rows=[member('A',1,aEnd),member('B',bStart,4)];
  expect(historicalOccupantSlices(rows).every(s=>s.items.length===1)).toBe(true);
  show(rows);expect(screen.queryByText('같은 방 투숙')).not.toBeInTheDocument();
 });
 it('splits a transitive three-member chain into actual simultaneous sets',()=>{
  const rows=[member('A',1,3),member('B',2,5),member('C',4,6)];
  expect(historicalOccupantSlices(rows).map(s=>s.items.map(x=>x.stayId))).toEqual([['A'],['A','B'],['B'],['B','C'],['C']]);
  show(rows);expect(screen.queryByText(/함께 투숙 · 3마리/)).not.toBeInTheDocument();
 });
 it('allows three members only during a positive three-way intersection',()=>{
  const slices=historicalOccupantSlices([member('A',1,5),member('B',2,4),member('C',3,6)]);
  const triple=slices.filter(s=>s.items.length===3);expect(triple).toHaveLength(1);
  expect(triple[0].from).toBe(Date.parse('2032-01-01T03:00:00Z'));expect(triple[0].until).toBe(Date.parse('2032-01-01T04:00:00Z'));
 });
 it('never combines different occupancies or separate Single stays',()=>{
  const a=member('A',1,3),b=member('B',1,3,'other');
  expect(historicalOccupantSlices([a,b]).every(s=>s.items.length===1)).toBe(true);
  expect(historicalOccupantSlices([{...a,lifecycleKind:'single'},{...b,lifecycleKind:'single'}]).every(s=>s.items.length===1)).toBe(true);
 });
 it('does not count overlapping segments from one stay as multiple members',()=>{
  expect(historicalOccupantSlices([member('A',1,3),{...member('B',1,3),stayId:'A'}]).every(s=>s.items.length===1)).toBe(true);
 });
 it.each([false,true])('labels full-day clipping as 00:00–24:00, not lifecycle boundaries (extends=%s)',extendsDay=>{
  const dayFrom='2031-12-31T15:00:00Z',dayUntil='2032-01-01T15:00:00Z';
  const s={...segment,usedFrom:extendsDay?'2031-12-30T15:00:00Z':dayFrom,usedUntil:extendsDay?'2032-01-02T15:00:00Z':dayUntil,displayFrom:dayFrom,displayUntil:dayUntil,selectedDayEvents:['continuing'] as HistoricalSegment['selectedDayEvents']};
  show([s]);expect(screen.getByText('선택일 표시 구간 00:00–24:00')).toBeVisible();expect(screen.getByText('이용중')).toBeVisible();
  expect(screen.queryByText(/00:00–00:00|당일 입실|당일 퇴실/)).not.toBeInTheDocument();
 });
 it('retains supplied event labels without treating clipped midnight as a new event',()=>{
  show([{...segment,usedFrom:'2031-12-31T14:00:00Z',displayFrom:'2031-12-31T15:00:00Z',selectedDayEvents:['continuing','check_out']}]);
  expect(screen.getByText('이용중 · 당일 퇴실')).toBeVisible();expect(screen.getByText('선택일 표시 구간 00:00–12:00')).toBeVisible();
  expect(screen.queryByText('당일 입실')).not.toBeInTheDocument();
 });
});
