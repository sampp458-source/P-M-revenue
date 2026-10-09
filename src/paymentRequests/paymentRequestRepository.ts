import {supabase} from '../lib/supabase';
import type {PaymentAccess,PaymentAttempt,PaymentDetail,PaymentType,HubRow} from './paymentRequestTypes';
import type {CapabilityRow} from '../taskRequests/taskRequestRepository';
export class PaymentFailure extends Error {constructor(message:string,readonly definite:boolean){super(message);}}
const messages:Record<string,string>={PAYMENT_CAPABILITY_IN_USE:'처리 중인 금융 요청이 있어 권한을 해제할 수 없습니다. 요청을 먼저 처리해 주세요. 담당자가 비활성화된 경우 금융 관리자가 관리 종료할 수 있습니다.',PAYMENT_ADMIN_CLOSE_NOT_ALLOWED:'담당자가 사용 불가한 미종결 요청만 관리 종료할 수 있습니다.',PAYMENT_DISABLED:'이 요청 기능은 현재 비활성화되어 있습니다.',PAYMENT_VERSION_CONFLICT:'요청 상태가 변경되었습니다. 다시 확인해주세요.',PAYMENT_INVALID_TRANSITION:'현재 상태에서는 처리할 수 없습니다.',PAYMENT_REASON_REQUIRED:'사유를 입력해주세요.',PAYMENT_DUE_MUST_BE_FUTURE:'완료 희망일시는 현재보다 이후로 설정해주세요.',INVALID_PAYMENT_HANDLER:'현재 처리 가능한 담당자를 선택해주세요.',REQUEST_ID_PAYLOAD_MISMATCH:'같은 요청 번호에 다른 내용을 사용할 수 없습니다.'};
async function rpc<T>(name:string,args:Record<string,unknown>={}):Promise<T>{const {data,error}=await supabase.rpc(name,args);if(error)throw new PaymentFailure(messages[error.message]||(error.code==='42501'?'이 작업을 수행할 권한이 없습니다.':'처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'),['22023','23514','23502','22P02','42501','55000','P0002','40001'].includes(error.code));return data as T;}
const commands:Record<PaymentType,Record<string,string>>={PAYMENT_CONFIRMATION_REQUEST:{UPDATED:'update_payment_confirmation_request_v1',DELETED:'delete_payment_confirmation_request_v1',ADMIN_CANCELLED:'administratively_cancel_payment_confirmation_request_v1',CREATE:'create_payment_confirmation_request_v1',CONFIRMED:'confirm_payment_confirmation_request_v1',NOT_FOUND:'mark_payment_confirmation_not_found_v1',CANCELLED:'cancel_payment_confirmation_request_v1'},PAYMENT_REQUEST:{ADMIN_CANCELLED:'administratively_cancel_payment_request_v1',CREATE:'create_payment_request_v1',ACKNOWLEDGED:'acknowledge_payment_request_v1',COMPLETED:'complete_payment_request_v1',REJECTED:'reject_payment_request_v1',CANCELLED:'cancel_payment_request_v1'}};
export const paymentRequestRepository={
 access:()=>rpc<PaymentAccess>('get_payment_request_access_v1'),
 handlers:(type:PaymentType)=>rpc<{id:string;name:string}[]>('get_payment_request_handlers_v1',{p_type:type}),
 command:(p:PaymentAttempt)=>rpc<{id:string;version:number;status:string}>(commands[p.type][p.action],{p_request_id:p.key,p_expected_version:p.version,p_payload:p.payload,...(p.id?{p_id:p.id}:{})}),
 detail:(type:PaymentType,id:string)=>rpc<PaymentDetail>('get_payment_request_detail_v1',{p_type:type,p_id:id}),
 list:(scope:string,type:string,filter:string,offset:number)=>rpc<{count:number;items:HubRow[]}>('get_request_hub_v1',{p_scope:scope,p_type:type,p_filter:filter,p_offset:offset}),
 history:(type:string,date:string,offset:number,openOffset=0)=>rpc<{count:number;items:(HubRow&{processed_at:string})[];open:{count:number;items:HubRow[]}}>('get_payment_received_history_v1',{p_type:type,p_date:date,p_offset:offset,p_limit:50,p_open_offset:openOffset}),
 directory:()=>rpc<CapabilityRow[]>('get_payment_request_capability_directory_v1'),
 setCapability:(id:string,capability:string,active:boolean,version:number,key:string)=>rpc<void>('set_payment_request_capability_v1',{p_target_id:id,p_capability:capability,p_active:active,p_expected_version:version,p_request_id:key}),
};
export type PaymentRepository=typeof paymentRequestRepository;
