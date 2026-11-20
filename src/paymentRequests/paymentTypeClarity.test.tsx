// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {RequestTypeComposer} from './RequestTypeComposer';
import {PaymentDetail} from './PaymentDetail';
import {paymentRequestRepository,PaymentFailure} from './paymentRequestRepository';
import {availableRequestTypes,paymentNoticeTitle} from './paymentRequestPresentation';
import {emptyPaymentAccess,paymentLabels,type PaymentType} from './paymentRequestTypes';
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:api}));
vi.mock('../taskRequests/TaskRequestUi',()=>({TaskComposer:()=> <p>합성 업무 작성</p>}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('keeps inbound and outbound labels distinct across the picker',()=>{
 render(<RequestTypeComposer types={['PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST']} userId="synthetic" onCreated={()=>{}}/>);
 expect(screen.getByRole('button',{name:'입금 확인 요청'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'지급 요청'})).toBeTruthy();
 expect(screen.getByText(/받을 돈이 입금되었는지/)).toBeTruthy();
 expect(screen.getByText(/내보낼 돈의 결제·지급/)).toBeTruthy();
 expect(screen.queryByText(/현재 계정에서 지급 요청/)).toBeNull();
 expect(api.rpc).not.toHaveBeenCalled();
});

it.each([false,true])('unavailable payout has an explanation even with direct single-type entry (%s)',async single=>{
 api.rpc.mockResolvedValue({data:[],error:null});
 render(<RequestTypeComposer types={single?['PAYMENT_CONFIRMATION_REQUEST']:['TASK_REQUEST','PAYMENT_CONFIRMATION_REQUEST']} userId="synthetic" onCreated={()=>{}}/>);
 expect(screen.getByText(/지출 결제를 입금 확인 요청으로 대신 보내지 말고/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'지급 요청'})).toBeNull();
 if(single) await screen.findByRole('heading',{name:'입금 확인 요청'});
});

it('source flags and capabilities remain independent for every combination',()=>{
 for(const confirmation_enabled of [false,true])for(const payment_enabled of [false,true])for(const confirmation_create of [false,true])for(const payment_create of [false,true]){
  const result=availableRequestTypes({enabled:true,can_create:true,owner:true},{...emptyPaymentAccess,confirmation_enabled,payment_enabled,confirmation_create,payment_create});
  expect(result.includes('PAYMENT_CONFIRMATION_REQUEST')).toBe(confirmation_enabled&&confirmation_create);
  expect(result.includes('PAYMENT_REQUEST')).toBe(payment_enabled&&payment_create);
  expect(result.includes('TASK_REQUEST')).toBe(true);
 }
});

it.each(['PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST'] as const)('%s submits its own RPC and never substitutes the other type',async type=>{
 const confirmation=type==='PAYMENT_CONFIRMATION_REQUEST';
 api.rpc.mockImplementation(async(name:string)=>({data:name==='get_payment_request_handlers_v1'?[{id:'synthetic-handler',name:'합성 담당자'}]:{id:'synthetic-result',status:'REQUESTED',version:1},error:null}));
 const created=vi.fn();
 render(<RequestTypeComposer types={['PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST']} userId={`synthetic-${type}`} onCreated={created}/>);
 fireEvent.click(screen.getByRole('button',{name:paymentLabels[type]}));
 await screen.findByText('합성 담당자');
 fireEvent.change(screen.getByLabelText(confirmation?'입금자명 / 확인 대상 이름':'지급 대상'),{target:{value:'합성 거래처'}});
 fireEvent.change(screen.getByLabelText(confirmation?'확인 금액':'금액'),{target:{value:'12,300원'}});
 if(!confirmation){fireEvent.change(screen.getByLabelText('제목'),{target:{value:'합성 비용'}});fireEvent.change(screen.getByLabelText('사유'),{target:{value:'합성 검증'}});}
 fireEvent.click(screen.getByRole('button',{name:paymentLabels[type]+' 보내기'}));
 await waitFor(()=>expect(created).toHaveBeenCalledWith(type,'synthetic-result'));
 const commands=api.rpc.mock.calls.filter(([name])=>name.startsWith('create_'));
 expect(commands).toHaveLength(1);
 expect(commands[0][0]).toBe(confirmation?'create_payment_confirmation_request_v1':'create_payment_request_v1');
 expect(commands[0][1].p_payload).toMatchObject(confirmation?{payer_name:'합성 거래처',amount:12300}:{payee_name:'합성 거래처',amount:12300});
 expect(api.rpc).toHaveBeenCalledWith('get_payment_request_handlers_v1',{p_type:type});
});

it('server payout denial is not retried as an inbound confirmation',async()=>{
 api.rpc.mockResolvedValue({data:null,error:{code:'55000',message:'PAYMENT_DISABLED'}});
 await expect(paymentRequestRepository.command({type:'PAYMENT_REQUEST',action:'CREATE',version:0,key:'synthetic-key',payload:{}})).rejects.toBeInstanceOf(PaymentFailure);
 expect(api.rpc).toHaveBeenCalledTimes(1);
 expect(api.rpc.mock.calls[0][0]).toBe('create_payment_request_v1');
});

it.each(['PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST'] as PaymentType[])('%s detail displays its type and matching actions without writing on read',type=>{
 render(<PaymentDetail item={{id:'synthetic',request_type:type,payer_name:'합성 대상',title:'합성 비용',requester_name:'합성 직원',handler_name:'합성 대표',status:'REQUESTED',version:1,can_process:true,can_cancel:false}} onRefresh={async()=>{}}/>);
 expect(screen.getByText(paymentLabels[type])).toBeTruthy();
 expect(screen.queryByRole('button',{name:'입금 확인'})!==null).toBe(type==='PAYMENT_CONFIRMATION_REQUEST');
 expect(screen.queryByRole('button',{name:'확인했습니다'})!==null).toBe(type==='PAYMENT_REQUEST');
 expect(api.rpc).not.toHaveBeenCalled();
});

it('clarifies legacy inbound notice titles only; outbound and task titles stay intact',()=>{
 expect(paymentNoticeTitle('PAYMENT_CONFIRMATION_REQUEST','새 결제 확인 요청이 있습니다.')).toBe('새 입금 확인 요청이 있습니다.');
 expect(paymentNoticeTitle('PAYMENT_REQUEST','새 지급 요청이 있습니다.')).toBe('새 지급 요청이 있습니다.');
 expect(paymentNoticeTitle('TASK_REQUEST','결제 확인 업무')).toBe('결제 확인 업무');
});
