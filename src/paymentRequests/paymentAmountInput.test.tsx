// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PaymentComposer} from './PaymentComposer';
import {PaymentDetail} from './PaymentDetail';
import {paymentAmount} from './paymentRequestPresentation';
import {paymentRequestRepository,PaymentFailure,type PaymentRepository} from './paymentRequestRepository';
vi.mock('../lib/supabase',()=>({supabase:{rpc:vi.fn()}}));
afterEach(cleanup);

it.each(['123400','123,400','123400원','123,400원',' 123,400 원 '])('normalizes ordinary KRW input %s',value=>{
 expect(paymentAmount(value)).toBe(123400);
});
it.each(['0','0원','-1원','1.2원','1e3','01','1,23','1,,000','1,000,','12 300','₩100','원100','100원원','2147483648','2,147,483,648원',''])('rejects invalid or excessive input %s',value=>{
 expect(()=>paymentAmount(value)).toThrow();
});
it.each(['1','1원','2147483647','2,147,483,647원'])('preserves allowed boundary amount %s',value=>{
 expect(paymentAmount(value)).toBe(value.startsWith('1')?1:2147483647);
});
it('editing a confirmation preserves the intended integer and other fields',async()=>{
 const repo={...paymentRequestRepository,command:vi.fn().mockResolvedValue({id:'synthetic-edit',version:2,status:'REQUESTED'})} satisfies PaymentRepository;
 render(<PaymentDetail item={{id:'synthetic-edit',request_type:'PAYMENT_CONFIRMATION_REQUEST',payer_name:'합성 입금자',reported_amount:100,dog_name:'합성 반려견',note:'합성 메모',status:'REQUESTED',version:1,requester_name:'합성 직원',handler_name:'합성 대표',can_process:false,can_cancel:true,can_edit:true}} repository={repo} onRefresh={async()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'수정'}));
 fireEvent.change(screen.getByLabelText('확인 금액'),{target:{value:'123,400원'}});
 fireEvent.click(screen.getByRole('button',{name:'수정 저장'}));
 await waitFor(()=>expect(repo.command).toHaveBeenCalledTimes(1));
 expect(repo.command.mock.calls[0][0]).toMatchObject({action:'UPDATED',version:1,payload:{payer_name:'합성 입금자',reported_amount:123400,dog_name:'합성 반려견',note:'합성 메모'}});
});
it.each(['1,23원','1.2원','-100원','2,147,483,648원'])('invalid form amount %s never calls the server',async value=>{
 const repo={...paymentRequestRepository,handlers:vi.fn().mockResolvedValue([{id:'synthetic-handler',name:'합성 담당자'}]),command:vi.fn()} satisfies PaymentRepository;
 render(<PaymentComposer type="PAYMENT_CONFIRMATION_REQUEST" userId={`invalid-${value}`} repository={repo} onCreated={()=>{}}/>);
 await screen.findByText('합성 담당자');
 fireEvent.change(screen.getByLabelText('입금자명 / 확인 대상 이름'),{target:{value:'합성 입금자'}});
 fireEvent.change(screen.getByLabelText('확인 금액'),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'결제 확인 요청 보내기'}));
 expect(screen.getByRole('alert').textContent).toContain('정수');
 expect(repo.command).not.toHaveBeenCalled();
});
it.each(['PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST'] as const)('%s sends numeric KRW and retries an uncertain submission with the same key',async type=>{
 const confirmation=type==='PAYMENT_CONFIRMATION_REQUEST';
 const repo={...paymentRequestRepository,handlers:vi.fn().mockResolvedValue([{id:'synthetic-handler',name:'합성 담당자'}]),command:vi.fn().mockRejectedValueOnce(new PaymentFailure('합성 연결 오류',false)).mockResolvedValue({id:'synthetic-result',version:1,status:'REQUESTED'})} satisfies PaymentRepository;
 const created=vi.fn();
 render(<PaymentComposer type={type} userId={`synthetic-${type}`} repository={repo} onCreated={created}/>);
 await screen.findByText('합성 담당자');
 fireEvent.change(screen.getByLabelText(confirmation?'입금자명 / 확인 대상 이름':'지급 대상'),{target:{value:'합성 거래처'}});
 fireEvent.change(screen.getByLabelText(confirmation?'확인 금액':'금액'),{target:{value:'123,400원'}});
 if(!confirmation){
  fireEvent.change(screen.getByLabelText('제목'),{target:{value:'합성 요청'}});
  fireEvent.change(screen.getByLabelText('사유'),{target:{value:'합성 검증'}});
 }
 fireEvent.click(screen.getByRole('button',{name:confirmation?'결제 확인 요청 보내기':'지급 요청 보내기'}));
 await screen.findByText('합성 연결 오류');
 expect(repo.command).toHaveBeenCalledTimes(1);
 const first=repo.command.mock.calls[0][0];
 expect(first.payload.amount).toBe(123400);
 fireEvent.click(screen.getByRole('button',{name:'같은 요청으로 결과 확인'}));
 await waitFor(()=>expect(created).toHaveBeenCalledTimes(1));
 expect(created).toHaveBeenCalledWith('synthetic-result');
 expect(repo.command).toHaveBeenCalledTimes(2);
 expect(repo.command.mock.calls[1][0]).toEqual(first);
});
