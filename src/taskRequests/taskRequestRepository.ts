import { supabase } from '../lib/supabase';
export const taskUiEnabled = import.meta.env.VITE_TASK_REQUESTS_ENABLED === 'true';
export interface TaskTarget { recipient_id: string; name: string; acknowledged_at: string | null; completed_at: string | null; completion_note: string | null; version: number }
export interface TaskRequest { id: string; requester_id: string; requester_name: string; title: string; body: string; due_at: string; created_at: string; cancelled_at: string | null; cancel_reason: string | null; version: number; can_cancel: boolean; targets: TaskTarget[] }
export interface TaskAccess { enabled: boolean; can_create: boolean; owner: boolean }
export interface CapabilityRow { id: string; name: string; active: boolean; operation_role: string | null; operation_active: boolean; capabilities: Record<string, { active: boolean; version: number }> }
const messages: Record<string,string> = {
 TASK_ACK_REQUIRED: '먼저 확인했습니다 버튼을 눌러주세요.', TASK_DUE_MUST_BE_FUTURE: '완료기한은 현재보다 이후로 설정해주세요.', TASK_CANCELLED: '취소된 업무요청입니다.', TASK_DISABLED: '업무요청 기능이 현재 비활성화되어 있습니다.', TASK_ALREADY_COMPLETE: '모두 완료된 업무요청은 취소할 수 없습니다.', CAPABILITY_VERSION_CONFLICT: '권한이 변경되었습니다. 새로고침 후 다시 시도해주세요.', REQUEST_ID_PAYLOAD_MISMATCH: '이 요청은 다른 내용으로 이미 처리되었습니다.',
};
export class TaskFailure extends Error { constructor(message:string,readonly definite:boolean){super(message);} }
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
 const { data,error } = await supabase.rpc(name,args);
 if(error) throw new TaskFailure(messages[error.message] || (error.code==='42501'?'이 작업을 수행할 권한이 없습니다.':'처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해주세요.'), ['22023','42501','55000','P0002','40001'].includes(error.code));
 return data as T;
}
export interface TaskCreate { requestId: string; title: string; body: string; dueAt: string; recipientIds: string[] }
export const taskRequestRepository = {
 summary:()=>rpc<{incomplete:number}>('get_task_request_summary_v1'),
 access:()=>rpc<TaskAccess>('get_task_request_access_v1'),
 list:(scope: 'inbox'|'sent'|'all',offset=0,filter='active')=>rpc<TaskRequest[]>('get_task_request_inbox_v1',{p_scope:scope,p_offset:offset,p_filter:filter}),
 detail:(id:string)=>rpc<TaskRequest>('get_task_request_detail_v1',{p_task_request_id:id}),
 recipients:()=>rpc<{id:string;name:string}[]>('get_task_request_recipients_v1'),
 create:(p:TaskCreate)=>rpc<string>('create_task_request_v1',{p_request_id:p.requestId,p_title:p.title,p_body:p.body,p_due_at:p.dueAt,p_recipient_ids:p.recipientIds}),
 ack:(id:string,key:string)=>rpc<void>('acknowledge_task_request_v1',{p_task_request_id:id,p_request_id:key}),
 complete:(id:string,key:string,note:string)=>rpc<void>('complete_task_request_v1',{p_task_request_id:id,p_request_id:key,p_completion_note:note||null}),
 cancel:(id:string,key:string,reason:string)=>rpc<void>('cancel_task_request_v1',{p_task_request_id:id,p_request_id:key,p_reason:reason}),
 directory:()=>rpc<CapabilityRow[]>('get_notification_capability_directory_v1'),
 setCapability:(id:string,capability:string,active:boolean,version:number,key:string)=>rpc<void>('set_notification_capability_v1',{p_target_id:id,p_capability:capability,p_active:active,p_expected_version:version,p_request_id:key}),
};
export type TaskRepository=typeof taskRequestRepository;
