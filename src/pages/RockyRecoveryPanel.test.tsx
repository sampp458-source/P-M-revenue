// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {RockyRecoveryPanel} from './RockyRecoveryPanel';
import type {DaycareReservation} from './daycareOperationsRepository';
const api=vi.hoisted(()=>({inspect:vi.fn(),execute:vi.fn()}));
vi.mock('./rockyRecoveryRepository',()=>({inspectRockyRecovery:api.inspect,executeRockyRecovery:api.execute}));
const row={operationScheduleId:'c8d76766-22e5-4b46-b191-248449b5be0b',version:3,scheduleVersion:1,lifecycleStatus:'scheduled',roomAllocation:{allocatedFrom:'2026-10-27T01:30Z',allocatedUntil:'2026-10-27T10:00Z'},capacityReservation:{reservedFrom:'2026-10-27T01:30Z',reservedUntil:'2026-10-27T10:00Z'}} as DaycareReservation;
afterEach(cleanup);beforeEach(()=>{vi.clearAllMocks();api.inspect.mockResolvedValue(row);});
async function open(){render(<RockyRecoveryPanel allowed/>);fireEvent.click(screen.getByRole('button',{name:'관리자 · 로키 사후 이용 복구'}));await screen.findByText(/예약 version 3/);}
describe('Rocky-only admin execution',()=>{
 it('non-admin has no control and triggers no reads',()=>{render(<RockyRecoveryPanel allowed={false}/>);expect(screen.queryByRole('button')).toBeNull();expect(api.inspect).not.toHaveBeenCalled();});
 it('reads only on explicit open and shows confirmed exact times and latest version',async()=>{await open();expect(api.inspect).toHaveBeenCalledTimes(1);expect(screen.getByText('실제 입실: 10:20 KST / 실제 퇴실: 18:10 KST')).toBeTruthy();expect(screen.getByRole('button',{name:'확인한 로키 1건 복구 실행'})).toHaveProperty('disabled',true);expect(api.execute).not.toHaveBeenCalled();});
 it('explicit confirmation calls one atomic command and blocks double click',async()=>{await open();let done:(x:DaycareReservation)=>void=()=>{};api.execute.mockImplementation(()=>new Promise<DaycareReservation>(r=>{done=r;}));fireEvent.click(screen.getByRole('checkbox'));const b=screen.getByRole('button',{name:'확인한 로키 1건 복구 실행'});fireEvent.click(b);fireEvent.click(b);expect(api.execute).toHaveBeenCalledTimes(1);expect(api.execute).toHaveBeenCalledWith(row,expect.any(String));done({...row,version:6,lifecycleStatus:'completed'});await screen.findByText(/실제 이용 기록이 완료/);expect(screen.getByRole('button',{name:'확인한 로키 1건 복구 실행'})).toHaveProperty('disabled',true);});
 it('failed or uncertain result is not silently retried',async()=>{await open();api.execute.mockRejectedValue(new Error('응답 유실'));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'확인한 로키 1건 복구 실행'}));await screen.findByText(/응답 유실.*요청 ID/);expect(api.execute).toHaveBeenCalledTimes(1);expect(screen.getByRole('checkbox')).toHaveProperty('disabled',true);});
 it('read conflict fails closed',async()=>{api.inspect.mockRejectedValue(new Error('점유 충돌'));render(<RockyRecoveryPanel allowed/>);fireEvent.click(screen.getByRole('button',{name:'관리자 · 로키 사후 이용 복구'}));await screen.findByText('점유 충돌');expect(screen.getByRole('checkbox')).toHaveProperty('disabled',true);});
 it('refresh clears prior confirmation and shows changed version',async()=>{await open();fireEvent.click(screen.getByRole('checkbox'));api.inspect.mockResolvedValue({...row,version:4});fireEvent.click(screen.getByRole('button',{name:'최신 상태 다시 조회'}));await screen.findByText(/예약 version 4/);expect(screen.getByRole('checkbox')).toHaveProperty('checked',false);await waitFor(()=>expect(api.inspect).toHaveBeenCalledTimes(2));});
});
