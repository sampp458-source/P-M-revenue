// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {NotificationSession} from '../notifications/NotificationProvider';
import {NotificationBell} from '../notifications/NotificationUi';
import {emptyInbox,type NotificationRepository,type Notice} from '../notifications/notificationRepository';
import {PaymentDetail} from './PaymentDetail';
import {PaymentCapabilityManagement} from './PaymentCapabilityManagement';
import {paymentRequestRepository} from './paymentRequestRepository';
import type {PaymentDetail as Detail} from './paymentRequestTypes';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('../lib/supabase',()=>({supabase:{rpc:mock.rpc}}));
afterEach(()=>{cleanup();vi.restoreAllMocks();mock.rpc.mockReset();});
const base:Detail={id:'request',request_type:'PAYMENT_REQUEST',title:'검수 지급',requester_name:'요청자',handler_name:'담당자',status:'ACKNOWLEDGED',version:2,can_cancel:false,can_process:false,handler_unavailable:true,can_admin_close:false};
it('requester sees unavailable attention but no cancel, recovery or complete action after ACK',()=>{render(<PaymentDetail item={base} onRefresh={async()=>{}}/>);expect(screen.getByRole('status').textContent).toContain('관리 확인 필요');for(const name of ['관리 종료','요청 취소','지급 완료'])expect(screen.queryByRole('button',{name})).toBeNull();expect(mock.rpc).not.toHaveBeenCalled();});
it('authorized administrative close requires reason, warns about external payment and uses typed RPC',async()=>{mock.rpc.mockResolvedValue({data:{id:'request',version:3,status:'CANCELLED'},error:null});render(<PaymentDetail item={{...base,can_admin_close:true}} onRefresh={async()=>{}}/>);expect(screen.getByText(/외부 지급 여부는 별도로 확인/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'관리 종료'}));expect(mock.rpc).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('결과 메모 / 종료 사유'),{target:{value:'담당자 퇴사로 관리 종료'}});fireEvent.click(screen.getByRole('button',{name:'관리 종료'}));await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(1));expect(mock.rpc).toHaveBeenCalledWith('administratively_cancel_payment_request_v1',expect.objectContaining({p_id:'request',p_expected_version:2,p_request_id:expect.any(String),p_payload:{note:'담당자 퇴사로 관리 종료'}}));});
it('terminal admin cancellation is distinct from regular cancellation and has no action',()=>{render(<PaymentDetail item={{...base,status:'CANCELLED',handler_unavailable:false,administrative_cancelled:true}} onRefresh={async()=>{}}/>);expect(screen.getByText('관리 종료')).toBeTruthy();expect(screen.getByText(/외부 지급 여부/)).toBeTruthy();expect(screen.queryByRole('button')).toBeNull();});
it('eligible normal handler retains only original ACK workflow',()=>{render(<PaymentDetail item={{...base,can_process:true,handler_unavailable:false}} onRefresh={async()=>{}}/>);expect(screen.queryByRole('status')).toBeNull();expect(screen.queryByRole('button',{name:'관리 종료'})).toBeNull();expect(screen.getByRole('button',{name:'지급 완료'})).toBeTruthy();});
it('confirmation has the same narrow administrative recovery while requester cancellation stays available',()=>{render(<PaymentDetail item={{...base,request_type:'PAYMENT_CONFIRMATION_REQUEST',payer_name:'입금자',status:'REQUESTED',can_cancel:true}} onRefresh={async()=>{}}/>);expect(screen.getByRole('button',{name:'요청 취소'})).toBeTruthy();expect(screen.queryByRole('button',{name:'관리 종료'})).toBeNull();});
it('in-use revoke error restores controlled ON state, leaves other grant intact and exposes clear message',async()=>{mock.rpc.mockImplementation((name:string)=>Promise.resolve(name==='get_payment_request_capability_directory_v1'?{data:[{id:'target',name:'담당자',active:true,operation_active:true,capabilities:{PAYMENT_REQUEST_PROCESS:{active:true,version:2},PAYMENT_CONFIRMATION_REVIEW:{active:true,version:1}}}],error:null}:{data:null,error:{code:'55000',message:'PAYMENT_CAPABILITY_IN_USE'}}));render(<PaymentCapabilityManagement selectedId="target"/>);const target=await screen.findByRole('switch',{name:'지급 요청 처리'});fireEvent.click(target);await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toContain('처리 중인 금융 요청이 있어 권한을 해제할 수 없습니다.');expect(screen.getByRole('alert').textContent).toContain('요청을 먼저 처리해 주세요. 담당자가 비활성화된 경우 금융 관리자가 관리 종료할 수 있습니다.');expect(target).toHaveProperty('checked',true);expect(screen.getByRole('switch',{name:'결제 확인 처리'})).toHaveProperty('checked',true);expect(screen.queryByText('같은 요청으로 결과 확인')).toBeNull();expect(mock.rpc).toHaveBeenCalledTimes(2);});
it('admin recovery unavailable error is definite and does not reinterpret another error',async()=>{mock.rpc.mockResolvedValueOnce({data:null,error:{code:'42501',message:'PAYMENT_ADMIN_CLOSE_NOT_ALLOWED'}});await expect(paymentRequestRepository.command({type:'PAYMENT_REQUEST',action:'ADMIN_CANCELLED',id:'x',version:2,key:'k',payload:{note:'사유'}})).rejects.toMatchObject({definite:true,message:'담당자가 사용 불가한 미종결 요청만 관리 종료할 수 있습니다.'});});

it.each(['PAYMENT_REQUEST','PAYMENT_CONFIRMATION_REQUEST'] as const)('Notification Center distinguishes administrative and ordinary cancel for %s and preserves SPA detail navigation',async category=>{
 const title=category==='PAYMENT_REQUEST'?'지급 요청이 관리 종료되었습니다.':'결제 확인 요청이 관리 종료되었습니다.';
 const message=category==='PAYMENT_REQUEST'?'외부 지급 여부는 별도로 확인해 주세요.':'입금 여부는 별도로 확인해 주세요.';
 const notice={id:'admin-notice',category,title,message,deep_link_type:category,deep_link_id:'request',created_at:'2026-10-07T00:00:00Z',priority:'NORMAL',ack_required:false,read_at:null} as Notice;
 const repo={inbox:vi.fn(async()=>({...emptyInbox,items:[notice,{...notice,id:'ordinary',title:'요청이 취소되었습니다.',message:'요청 상세에서 확인해 주세요.'}]})),subscribe:vi.fn(()=>()=>{}),read:vi.fn(async()=>{})} as unknown as NotificationRepository;
 function Location(){const loc=useLocation();return <output aria-label="현재 경로">{loc.pathname+loc.search}</output>;}
 render(<MemoryRouter><NotificationSession userId="requester" repository={repo}><NotificationBell/><Location/></NotificationSession></MemoryRouter>);
 await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:/알림센터, 읽지 않은/}));
 expect(await screen.findByText(title)).toBeTruthy();expect(screen.getByText(message)).toBeTruthy();expect(screen.getByText('요청이 취소되었습니다.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:new RegExp(title)}));
 await waitFor(()=>expect(screen.getByLabelText('현재 경로').textContent).toContain('/operations/requests?'));
 expect(screen.getByLabelText('현재 경로').textContent).toContain('type='+category);expect(screen.getByLabelText('현재 경로').textContent).toContain('request=request');
 expect(repo.read).toHaveBeenCalledWith('admin-notice');expect(mock.rpc).not.toHaveBeenCalled();
});
