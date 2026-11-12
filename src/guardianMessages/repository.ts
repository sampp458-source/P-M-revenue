import {supabase} from '../lib/supabase';
import type {ApprovedTemplate,MessageContext,MessageDraft,MessageSnapshot,Unit} from '../../supabase/functions/_shared/guardianMessage';
export type MessageConfiguration={configured:boolean;enabled:boolean;sender:string|null;channel:string|null;templates:ApprovedTemplate[];units:Unit[];admin:boolean;fallbackEnabled:boolean;sendScope?:'off'|'internal'|'live';internalRecipientCount?:number};
export type GuardianContact={id:string;name:string|null;phone_masked:string|null};
export type MessageHistory={id:string;unit:Unit;channel:string;status:string;created_at:string;requested_at?:string|null;actor_name?:string;recipient:string;type:string;provider_message_id:string|null;provider_group_id:string|null;result_code:string|null;fallback_used:boolean|null;cost:number|null};
export type Preview={saved:{id:string;hash:string;status:string};snapshot:MessageSnapshot;canSend:boolean};
export type MessageStaffPermission={id:string;name:string;units:Unit[]};
export interface GuardianMessageApi {
 staffPermissions?():Promise<MessageStaffPermission[]>;
 setPermission?(profile:string,unit:Unit,allowed:boolean,reason:string,request:string):Promise<void>;
 configuration(unit:Unit):Promise<MessageConfiguration>;
 search(unit:Unit,query:string):Promise<GuardianContact[]>;
 context(unit:Unit,customer:string,schedule?:string):Promise<MessageContext>;
 preview(draft:MessageDraft,requestId:string):Promise<Preview>;
 send(id:string,hash:string):Promise<{status:string;error?:string;code?:string;duplicate?:boolean}>;
 history(unit:string,channel:string,status:string):Promise<MessageHistory[]>;
 detail(id:string):Promise<{snapshot:MessageSnapshot;status:string}>;
 refresh(id:string):Promise<{status:string;note?:string}>;
}
async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{const {data,error}=await supabase.rpc(name,args);if(error)throw Error('메시지 정보를 불러오지 못했습니다. 권한 및 설치 상태를 확인해 주세요.');return data as T;}
async function action<T>(body:Record<string,unknown>):Promise<T>{const {data,error}=await supabase.functions.invoke('guardian-messages',{body});if(error||!data)throw Error('메시지 서버에 연결하지 못했습니다. 발송 이력 확인 전 다시 보내지 마세요.');if(data.error)throw Error(`${data.error}${data.code?` (${data.code})`:''}`);return data as T;}
export const guardianMessageApi:GuardianMessageApi={staffPermissions:()=>rpc('get_guardian_message_staff_v1',{}),setPermission:(profile,unit,allowed,reason,request)=>rpc('set_guardian_message_permission_v1',{p_profile:profile,p_unit:unit,p_can_send:allowed,p_reason:reason,p_request:request}),configuration:unit=>action({action:'configuration',unit}),search:(unit,query)=>rpc('search_guardian_message_customers_v1',{p_unit:unit,p_query:query}),context:(unit,customer,schedule)=>rpc('get_guardian_message_context_v1',{p_unit:unit,p_customer:customer,p_schedule:schedule??null}),preview:(draft,requestId)=>action({action:'preview',draft,requestId}),send:(id,hash)=>action({action:'send',id,hash}),history:(unit,channel,status)=>rpc('list_guardian_messages_v1',{p_unit:unit||null,p_channel:channel||null,p_status:status||null}),detail:id=>rpc('get_guardian_message_v1',{p_id:id}),refresh:id=>action({action:'refresh',id})};
