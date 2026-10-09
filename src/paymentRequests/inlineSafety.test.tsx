// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PaymentDetail} from './PaymentDetail';
import {RequestHubWorkspace} from './RequestHubWorkspace';
import {emptyPaymentAccess} from './paymentRequestTypes';
const api=vi.hoisted(()=>({list:vi.fn(),detail:vi.fn(),command:vi.fn()}));
vi.mock('./paymentRequestRepository',async original=>({...await original<typeof import('./paymentRequestRepository')>(),paymentRequestRepository:api}));
vi.mock('../lib/supabase',()=>({supabase:{rpc:vi.fn()}}));
const rows=Array.from({length:50},(_,i)=>({id:'row-'+i,request_type:'PAYMENT_CONFIRMATION_REQUEST',display_title:'예약 '+i,counterparty:'직원',status:'REQUESTED',lifecycle:'OPEN',created_at:'2026-10-08T00:00:00Z',due_at:null}));
const detail=(id:string)=>({id,request_type:'PAYMENT_CONFIRMATION_REQUEST',payer_name:id,reported_amount:1000,status:'REQUESTED',version:1,can_process:true,can_cancel:false,requester_name:'직원',handler_name:'대표'});
function tree(path='/operations/requests'){return <MemoryRouter initialEntries={[path+(path.includes('?')?'&':'?')+'paymentView=list']}><RequestHubWorkspace userId="safe-user" taskAccess={{enabled:true,can_create:false,owner:false}} paymentAccess={{...emptyPaymentAccess,confirmation_enabled:true,view_all:true}} revision={0}/></MemoryRouter>;}
beforeEach(()=>{sessionStorage.clear();api.list.mockImplementation(async()=>({items:rows.map(r=>({...r})),count:50}));api.detail.mockImplementation(async(_type,id)=>detail(id));});
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks();sessionStorage.clear();});
it('unchanged 50-row automatic/focus/visibility refresh reuses details',async()=>{vi.useFakeTimers();render(tree());await act(async()=>{});expect(api.detail).toHaveBeenCalledTimes(50);await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(api.list).toHaveBeenCalledTimes(2);expect(api.detail).toHaveBeenCalledTimes(50);await act(async()=>{fireEvent(window,new Event('focus'));fireEvent(document,new Event('visibilitychange'));});expect(api.detail).toHaveBeenCalledTimes(50);});
it('initial 50 details have maximum concurrency four',async()=>{const finish:Array<()=>void>=[];let active=0,max=0;api.detail.mockImplementation((_type,id)=>new Promise(resolve=>{active++;max=Math.max(max,active);finish.push(()=>{active--;resolve(detail(id));});}));render(tree());await waitFor(()=>expect(api.detail).toHaveBeenCalledTimes(4));for(let round=0;round<13;round++)await act(async()=>{finish.splice(0).forEach(done=>done());});expect(api.detail).toHaveBeenCalledTimes(50);expect(max).toBe(4);});
it('explicit refresh rechecks all details including permission and version changes',async()=>{render(tree());await waitFor(()=>expect(api.detail).toHaveBeenCalledTimes(50));api.detail.mockImplementation(async(_type,id)=>({...detail(id),version:9,can_process:false,reported_amount:7777}));fireEvent.click(screen.getByRole('button',{name:'목록 갱신'}));await waitFor(()=>expect(api.detail).toHaveBeenCalledTimes(100));await waitFor(()=>expect(screen.getAllByText('7,777원')).toHaveLength(50));expect(screen.queryByRole('button',{name:'입금 확인'})).toBeNull();});
it('a changed row triggers only its own detail read',async()=>{render(tree());await waitFor(()=>expect(api.detail).toHaveBeenCalledTimes(50));api.list.mockResolvedValue({items:rows.map((r,i)=>i===5?{...r,status:'NOT_FOUND'}:{...r}),count:50});fireEvent(window,new Event('focus'));await waitFor(()=>expect(api.detail).toHaveBeenCalledTimes(51));expect(api.detail).toHaveBeenLastCalledWith('PAYMENT_CONFIRMATION_REQUEST','row-5');});
async function one(){api.list.mockImplementation(async(scope,_type,filter,offset)=>({items:scope==='inbox'&&filter!=='done'&&!offset?[rows[0]]:[],count:51}));render(tree());await screen.findByRole('button',{name:'입금 미확인'});}
it('in-flight detail navigation restores the original command for explicit reconciliation',async()=>{let finish!:(v:unknown)=>void;api.command.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({id:'row-0',version:2,status:'NOT_FOUND'});await one();fireEvent.click(screen.getByRole('button',{name:'입금 미확인'}));const original=api.command.mock.calls[0][0];fireEvent.click(screen.getByRole('button',{name:/예약 0 · 직원/}));await screen.findByRole('heading',{name:'row-0'});fireEvent.click(screen.getByRole('button',{name:'같은 요청으로 결과 확인'}));await waitFor(()=>expect(api.command).toHaveBeenCalledTimes(2));expect(api.command.mock.calls[1][0]).toEqual(original);await act(async()=>finish({id:'row-0',version:2,status:'NOT_FOUND'}));expect(sessionStorage.length).toBe(0);});
it.each(['tab','filter','page'])('uncertain result survives %s navigation and retains exact identity',async destination=>{api.command.mockRejectedValueOnce(new Error('결과 불확실')).mockResolvedValue({id:'row-0',version:2,status:'NOT_FOUND'});await one();fireEvent.click(screen.getByRole('button',{name:'입금 미확인'}));await screen.findByText('결과 불확실');const original=api.command.mock.calls[0][0];if(destination==='tab')fireEvent.click(screen.getByRole('button',{name:'보낸 요청'}));if(destination==='filter')fireEvent.change(screen.getByLabelText('상태'),{target:{value:'done'}});if(destination==='page')fireEvent.click(screen.getByRole('button',{name:'다음'}));fireEvent.click(await screen.findByRole('button',{name:'처리 결과 확인하기'}));await screen.findByRole('heading',{name:'row-0'});fireEvent.click(screen.getByRole('button',{name:'같은 요청으로 결과 확인'}));await waitFor(()=>expect(api.command).toHaveBeenCalledTimes(2));expect(api.command.mock.calls[1][0]).toEqual(original);await waitFor(()=>expect(sessionStorage.length).toBe(0));fireEvent.click(screen.getByRole('button',{name:'목록으로'}));await screen.findByLabelText('상태');});
it('reload-equivalent unmount/remount preserves request ID and unload warning',async()=>{api.list.mockResolvedValue({items:[rows[0]],count:1});api.command.mockRejectedValueOnce(new Error('결과 불확실')).mockResolvedValue({id:'row-0',version:2,status:'NOT_FOUND'});const ui=render(tree());fireEvent.click(await screen.findByRole('button',{name:'입금 미확인'}));await screen.findByText('결과 불확실');const original=api.command.mock.calls[0][0];const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);ui.unmount();render(tree());fireEvent.click(await screen.findByRole('button',{name:'같은 요청으로 결과 확인'}));await waitFor(()=>expect(api.command).toHaveBeenCalledTimes(2));expect(api.command.mock.calls[1][0]).toEqual(original);await waitFor(()=>expect(sessionStorage.length).toBe(0));});
it.each(['storage','command creation'])('%s failure keeps the snapshot live without sending an RPC',async failure=>{
 vi.useFakeTimers();
 api.list.mockResolvedValue({items:[rows[0]],count:1});
 render(tree());await act(async()=>{});
 const spy=failure==='storage'
  ?vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('저장 불가');})
  :vi.spyOn(crypto,'randomUUID').mockImplementation(()=>{throw new Error('명령 생성 불가');});
 try{
  fireEvent.click(screen.getByRole('button',{name:'입금 미확인'}));
  expect(screen.getByText(failure==='storage'?'저장 불가':'명령 생성 불가')).toBeTruthy();
  expect(api.command).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
  expect(screen.queryByText('조회 순서·건수 유지 중 · 최신 목록은 갱신해주세요.')).toBeNull();
  expect(screen.queryByText('목록에서 연속 처리할 수 있습니다.')).toBeNull();
  expect(screen.getByRole('button',{name:'목록 갱신'})).toBeEnabled();
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
  expect(api.list).toHaveBeenCalledTimes(2);
  await act(async()=>{fireEvent(window,new Event('focus'));});
  expect(api.list).toHaveBeenCalledTimes(3);
  expect(api.command).not.toHaveBeenCalled();
 }finally{spy.mockRestore();}
});
it('persisted command freezes the snapshot through automatic refresh',async()=>{
 vi.useFakeTimers();api.list.mockResolvedValue({items:[rows[0]],count:1});
 api.command.mockImplementation(async()=>{expect(sessionStorage.length).toBe(1);return {id:'row-0',version:2,status:'NOT_FOUND'};});
 render(tree());await act(async()=>{});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'입금 미확인'}));});
 expect(api.command).toHaveBeenCalledTimes(1);
 expect(screen.getByText('조회 순서·건수 유지 중 · 최신 목록은 갱신해주세요.')).toBeTruthy();
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
 expect(api.list).toHaveBeenCalledTimes(1);
});
it.each(['PAYMENT_VERSION_CONFLICT','permission denied'])('definite %s preserves state and clears recoverable attempt',async message=>{const {PaymentFailure}=await import('./paymentRequestRepository');api.command.mockRejectedValue(new PaymentFailure(message,true));await one();fireEvent.click(screen.getByRole('button',{name:'입금 미확인'}));await screen.findByText(message);expect(sessionStorage.length).toBe(0);expect(screen.getByText('확인 대기',{selector:'.payment-inline-status'})).toBeTruthy();expect(screen.getByRole('button',{name:'입금 미확인'})).toBeEnabled();});
it('saved attempts are isolated by authenticated actor identity',async()=>{const {savePaymentAttempt,pendingPaymentAttempts}=await import('./paymentCommandRecovery');savePaymentAttempt({userId:'actor-a',id:'row-0'},{id:'row-0',type:'PAYMENT_CONFIRMATION_REQUEST',action:'CONFIRMED',version:1,key:'same-request',payload:{note:null}});expect(pendingPaymentAttempts('actor-b')).toEqual([]);expect(pendingPaymentAttempts('actor-a')).toHaveLength(1);});

it('completion after leaving detail clears recovery without refreshing an obsolete route',async()=>{let finish!:(v:unknown)=>void;api.command.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const refresh=vi.fn().mockResolvedValue(undefined);const ui=render(<PaymentDetail item={{...detail('row-0'),request_type:'PAYMENT_CONFIRMATION_REQUEST'}} repository={api as never} recoveryUserId="safe-user" onRefresh={refresh}/>);fireEvent.click(screen.getByRole('button',{name:'입금 확인'}));expect(sessionStorage.length).toBe(1);ui.unmount();await act(async()=>finish({id:'row-0',status:'CONFIRMED',version:2}));expect(refresh).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);});
