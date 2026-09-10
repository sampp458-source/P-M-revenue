// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
const db=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:db}));
import { fetchCompletedSharedStays, fetchSharedRoomHistory, type SharedHistory } from './sharedHotelHistoryRepository';
import { SharedHotelHistory } from './SharedHotelHistory';
afterEach(()=>{cleanup();vi.clearAllMocks();});
const history: SharedHistory={coverageStatus:'SHARED_ONLY',segments:[
 {hotelStayId:'synthetic-member',dogName:'Synthetic dog',roomId:'a',roomName:'Synthetic A',usedFrom:'2090-01-01T01:00:00Z',usedUntil:'2090-01-01T05:00:00Z',displayFrom:'2090-01-01T01:00:00Z',displayUntil:'2090-01-01T05:00:00Z'},
 {hotelStayId:'synthetic-member',dogName:'Synthetic dog',roomId:'b',roomName:'Synthetic B',usedFrom:'2090-01-01T05:00:00Z',usedUntil:'2090-01-02T05:00:00Z',displayFrom:'2090-01-01T05:00:00Z',displayUntil:'2090-01-01T15:00:00Z'}],unavailableMembers:[{hotelStayId:'unproven',dogName:'Unproven dog',reasonCode:'GAP'}]};
describe('008 Shared historical reads',()=>{
 it('keeps moved room segments, partial coverage and detail-only entries',()=>{
 const open=vi.fn();render(<SharedHotelHistory history={history} onOpenStay={open}/>);
 expect(screen.getByText('Synthetic A')).toBeVisible();expect(screen.getByText('Synthetic B')).toBeVisible();
 expect(screen.getByText(/Single·장기호텔/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/Unproven dog/}));expect(open).toHaveBeenCalledWith('unproven');
 expect(screen.queryByRole('button',{name:/배정|퇴실 완료|이동/})).not.toBeInTheDocument();
 });
 it('distinguishes errors from an observed empty date',()=>{
 const {rerender}=render(<SharedHotelHistory error="조회 실패" onOpenStay={vi.fn()}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('조회 실패');expect(screen.queryByText(/기록이 없습니다/)).not.toBeInTheDocument();
 rerender(<SharedHotelHistory history={{coverageStatus:'SHARED_ONLY',segments:[],unavailableMembers:[]}} onOpenStay={vi.fn()}/>);
 expect(screen.getByText(/기록이 없습니다/)).toBeVisible();
 });
 it('fetches completed members with one RPC without requiring room proof',async()=>{
 const rows=[{id:'done',dogName:'Synthetic dog',checkedOutAt:'2090-01-02T01:00:00Z',scheduleEvents:[]}];
 db.rpc.mockResolvedValue({data:rows,error:null});expect(await fetchCompletedSharedStays('2090-01-02')).toEqual(rows);
 expect(db.rpc).toHaveBeenCalledTimes(1);expect(db.rpc).toHaveBeenCalledWith('get_completed_shared_hotel_stays',{p_local_date:'2090-01-02'});
 });
 it('fetches history in one batch',async()=>{db.rpc.mockResolvedValue({data:history,error:null});expect(await fetchSharedRoomHistory('2090-01-01')).toEqual(history);expect(db.rpc).toHaveBeenCalledTimes(1);});
 it.each([{data:null,error:{}},{data:[],error:null},{data:{...history,segments:[{...history.segments[0],displayUntil:'invalid'}]},error:null}])('rejects failed or malformed historical reads',async value=>{db.rpc.mockResolvedValue(value);await expect(fetchSharedRoomHistory('2090-01-01')).rejects.toThrow();});
 it('rejects duplicate completed identities',async()=>{const r={id:'same',dogName:'Synthetic',checkedOutAt:'2090-01-01T00:00:00Z',scheduleEvents:[]};db.rpc.mockResolvedValue({data:[r,r],error:null});await expect(fetchCompletedSharedStays('2090-01-01')).rejects.toThrow();});
});
