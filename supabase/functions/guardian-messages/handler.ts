import {composeGuardianSnapshot,substituteTemplate,type MessageContext,type MessageDraft,type MessageSnapshot,type Unit,normalizeGuardianPhone} from '../_shared/guardianMessage.ts';
import {type SolapiProvider} from './provider.ts';
export type Rpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export type Access={units:Unit[];admin:boolean;enabled:boolean;internalTestVerified:boolean;fallbackEnabled:boolean;sendScope:'off'|'internal'|'live';internalRecipientCount:number};
export type Deps={authenticate:(token:string)=>Promise<{id:string;rpc:Rpc}>;service:Rpc;provider:SolapiProvider;origin:string};
type Saved={actor_id:string;id:string;request_id:string;snapshot_hash:string;snapshot:MessageSnapshot;provider_message_id:string|null;provider_group_id:string|null;status:string};
export function guardianHandler(deps:Deps){return async(req:Request)=>{
 const origin=req.headers.get('origin');const headers={'Content-Type':'application/json','Cache-Control':'no-store',...(origin===deps.origin?{'Access-Control-Allow-Origin':deps.origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
 const scopeAllowed=(a:Access)=>deps.provider.config.sendScope===a.sendScope&&(a.sendScope==='live'?a.internalTestVerified&&deps.provider.config.internalTestVerified:a.sendScope==='internal'&&a.admin&&a.internalRecipientCount>0);
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(origin&&origin!==deps.origin)return json({error:'허용되지 않은 요청입니다.'},403);
 if(req.method==='OPTIONS')return json({});if(req.method!=='POST')return json({error:'POST 요청만 지원합니다.'},405);
 let actor:string|undefined;let id:string|null=null;let claimed=false;
 try{
  const token=req.headers.get('authorization');if(!token?.startsWith('Bearer '))return json({error:'로그인이 필요합니다.'},401);
  const user=await deps.authenticate(token);actor=user.id;const access=await user.rpc('get_guardian_message_access_v1',{}) as Access;
  if(!access?.units?.length)return json({error:'메시지 발송 권한이 없습니다.'},403);
  const raw=await req.text();if(raw.length>20000)return json({error:'요청이 너무 큽니다.'},413);const body=JSON.parse(raw) as Record<string,unknown>;
  if(body.action==='configuration'){const unit=body.unit as Unit;if(!access.units.includes(unit))return json({configured:false,enabled:false,sender:null,channel:null,templates:[],units:access.units,admin:access.admin,fallbackEnabled:false});const reg=await deps.provider.registry(unit);return json({...reg,enabled:reg.enabled&&access.enabled&&scopeAllowed(access),fallbackEnabled:access.fallbackEnabled&&deps.provider.config.fallbackEnabled===true,sendScope:access.sendScope,internalRecipientCount:access.internalRecipientCount,units:access.units,admin:access.admin});}
  if(body.action==='preview'){
   const draft=body.draft as MessageDraft;if(!draft||!access.units.includes(draft.unit)||typeof body.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.requestId))throw Error('MESSAGE_INPUT');
   const context=await user.rpc('get_guardian_message_context_v1',{p_unit:draft.unit,p_customer:draft.customerId,p_schedule:draft.scheduleId??null}) as MessageContext;
   const reg=await deps.provider.registry(draft.unit);const template=reg.templates.find(t=>t.templateId===draft.templateId)??null;
   const snapshot=composeGuardianSnapshot(draft,context,template,reg.sender,access.fallbackEnabled&&deps.provider.config.fallbackEnabled===true);
   const internalAllowed=access.sendScope!=='internal'||await user.rpc('is_guardian_message_internal_recipient_v1',{p_phone:snapshot.to})===true;
   const serverInternalAllowed=access.sendScope!=='internal'||!!deps.provider.config.internalRecipients?.some(p=>normalizeGuardianPhone(p)===snapshot.to);
   const saved=await deps.service('save_guardian_message_v1',{p_actor:actor,p_request:body.requestId,p_snapshot:snapshot});return json({saved,snapshot,canSend:reg.enabled&&access.enabled&&scopeAllowed(access)&&internalAllowed&&serverInternalAllowed});
  }
  if(!['send','refresh'].includes(String(body.action))||typeof body.id!=='string')throw Error('MESSAGE_INPUT');id=body.id;
  const record=await user.rpc('get_guardian_message_v1',{p_id:id}) as Saved;
  if(body.action==='refresh'){
   if(!record.provider_message_id||!record.provider_group_id)return json({status:record.status,note:'제공사 식별자가 없어 자동 재발송하지 않습니다. 관리자 확인이 필요합니다.'});
   const result=await deps.provider.lookup(record.provider_message_id,record.provider_group_id);
   if(result.messageId!==record.provider_message_id||result.groupId!==record.provider_group_id)throw Error('MESSAGE_PROVIDER_ID_MISMATCH');
   if(result.fallback===true&&!record.snapshot.fallback)throw Error('MESSAGE_UNAPPROVED_FALLBACK');
   await deps.service('finish_guardian_message_v1',{p_actor:actor,p_id:id,p_status:result.status,p_message_id:result.messageId,p_group_id:result.groupId,p_code:result.code,p_fallback:result.fallback});const persisted=await user.rpc('get_guardian_message_v1',{p_id:id}) as Saved;return json({...result,status:persisted.status});
  }
  if(record.status!=='draft')return json({status:record.status,duplicate:true});
  const snapshot=record.snapshot;const reg=await deps.provider.registry(snapshot.unit);
  if(!reg.enabled||!access.enabled||!scopeAllowed(access))throw Error('MESSAGE_DISABLED');
  deps.provider.assertSendAllowed(snapshot);
  if(access.sendScope==='internal'&&await user.rpc('is_guardian_message_internal_recipient_v1',{p_phone:snapshot.to})!==true)throw Error('MESSAGE_INTERNAL_RECIPIENT_DENIED');
  if(reg.sender!==snapshot.sender||snapshot.fallback!== (snapshot.channel==='ATA'&&access.fallbackEnabled&&deps.provider.config.fallbackEnabled===true))throw Error('MESSAGE_PREVIEW_CHANGED');
  if(snapshot.channel==='ATA'){const template=reg.templates.find(t=>t.templateId===snapshot.templateId);if(!template||template.channelId!==snapshot.channelId||substituteTemplate(template.content,snapshot.variables??{})!==snapshot.text)throw Error('MESSAGE_TEMPLATE_CHANGED');}
  const claim=await deps.service('claim_guardian_message_v1',{p_actor:actor,p_id:id,p_hash:body.hash}) as {claimed:boolean;status?:string;snapshot?:MessageSnapshot};
  if(!claim.claimed)return json({status:claim.status,duplicate:true});claimed=true;
  const result=await deps.provider.send(claim.snapshot!,record.request_id);
  await deps.service('finish_guardian_message_v1',{p_actor:actor,p_id:id,p_status:result.status,p_message_id:result.messageId,p_group_id:result.groupId,p_code:result.code});return json(result);
 }catch(error){
  const known=error instanceof Error&&/^(MESSAGE_[A-Z_]+|PROVIDER_[A-Z_]+)$/.test(error.message)?error.message:'MESSAGE_REQUEST_FAILED';
  const uncertain=claimed&&known!=='PROVIDER_REJECTED';
  if(actor){try{if(claimed&&id)await deps.service('finish_guardian_message_v1',{p_actor:actor,p_id:id,p_status:uncertain?'unknown':'failed',p_message_id:null,p_group_id:null,p_code:uncertain?'PROVIDER_UNCERTAIN':'PROVIDER_REJECTED'});else await deps.service('audit_guardian_message_attempt_v1',{p_actor:actor,p_id:id,p_code:known});}catch{/* Persisted submitting claim still blocks resend if finalization storage is unavailable. */}}
  return json({error:uncertain?'접수 결과가 불확실합니다. 재발송하지 말고 이력에서 상태를 확인해 주세요.':claimed?'제공사가 발송 접수를 거부했습니다. 발송 이력을 확인해 주세요.':'요청을 처리하지 못했습니다. 권한·입력·설정 상태를 확인해 주세요.',code:known},uncertain?202:400);
 }
};}
