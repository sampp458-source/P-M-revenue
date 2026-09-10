// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
const db=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:db}));
import {fetchHistoricalBoard, parseHistoricalBoard, type HistoricalBoard, type HistoricalSegment} from './hotelHistoricalBoardRepository';
import {HotelHistoricalRoomGrid} from './HotelHistoricalRoomGrid';
afterEach(()=>{cleanup();vi.clearAllMocks();});
const segment: HistoricalSegment={segmentId:'segment',stayId:'stay',dogId:'dog',dogName:'합성견',lifecycleKind:'single',roomId:'a',usedFrom:'2032-01-01T01:00:00Z',usedUntil:'2032-01-01T03:00:00Z',displayFrom:'2032-01-01T01:00:00Z',displayUntil:'2032-01-01T03:00:00Z',selectedDayEvents:['check_in','moved_out'],provenanceStatus:'verified',coverageClassification:'verified_supported_path'};
const history: HistoricalBoard={selectedDate:'2032-01-01',timezone:'Asia/Seoul',evidenceAsOf:'2032-01-03T00:00:00Z',readOnly:true,coverageStatus:'PARTIAL',rooms:[{roomId:'a',roomName:'합성 A',roomTypeId:'type',roomType:'합성 유형',segments:[segment]},{roomId:'b',roomName:'합성 B',roomTypeId:'type',roomType:'합성 유형',segments:[{...segment,segmentId:'next',roomId:'b',usedFrom:'2032-01-01T03:00:00Z',displayFrom:'2032-01-01T03:00:00Z',usedUntil:'2032-01-01T09:00:00Z',displayUntil:'2032-01-01T09:00:00Z',selectedDayEvents:['moved_in','check_out']}]},{roomId:'c',roomName:'합성 C',roomTypeId:'type',roomType:'합성 유형',segments:[]}],unavailable:[{stayId:'unknown',dogId:'unknownDog',dogName:'미확인견',lifecycleKind:'shared',reasonCode:'SHARED_PARTICIPATION_UNPROVEN',affectedFrom:'2032-01-01T01:00:00Z',affectedUntil:'2032-01-01T09:00:00Z',coverageClassification:'unavailable'}]};
describe('010 actual-use room grid',()=>{
 it('keeps both room segments and same-day transitions with detail-only buttons',()=>{
  const open=vi.fn();render(<HotelHistoricalRoomGrid history={history} onOpenStay={open}/>);
  expect(screen.getByText('합성 A')).toBeVisible();expect(screen.getByText('합성 B')).toBeVisible();
  expect(screen.getByText('당일 입실 · 이동 퇴실')).toBeVisible();expect(screen.getByText('이동 입실 · 당일 퇴실')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:/미확인견/}));expect(open).toHaveBeenCalledWith('unknown');
  expect(screen.queryByRole('button',{name:/배정|이동 실행|입실 처리|퇴실 처리/})).not.toBeInTheDocument();
  expect(document.querySelector('[draggable="true"]')).toBeNull();
 });
 it('does not claim an empty historical room from missing coverage',()=>{
  render(<HotelHistoricalRoomGrid history={history} onOpenStay={vi.fn()}/>);
  expect(screen.getByText('확인된 사용 기록 없음')).toBeVisible();expect(screen.getByRole('note')).toHaveTextContent('당시 빈 객실이었다는 의미는 아닙니다');
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

});
