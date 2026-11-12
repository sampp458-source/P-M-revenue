export type Unit='training'|'hotel'|'daycare';
export type Channel='SMS'|'LMS'|'ATA';
export const MESSAGE_TYPES=['상담예약 확정','상담예약 변경','방문 전 준비사항','호텔 예약 확정','호텔 입실 안내','호텔 퇴실 안내','유치원 개별 안내','일반 문자 직접 작성'] as const;
export type MessageContext={customerId:string;guardianName:string|null;phone:string|null;dogNames:string|null;scheduleId?:string;scheduleVersion?:number;title?:string;startsAt?:string|null;endsAt?:string|null};
export type ApprovedTemplate={templateId:string;channelId:string;name:string;content:string;status:'APPROVED';variables:string[]};
export type MessageDraft={unit:Unit;customerId:string;scheduleId?:string;channel:Channel;type:string;text:string;phoneOverride?:string;overrideReason?:string;templateId?:string;variables?:Record<string,string>};
export type MessageSnapshot={unit:Unit;customerId:string;scheduleId?:string;scheduleVersion?:number;channel:Channel;type:string;to:string;originalPhone:string|null;phoneChanged:boolean;overrideReason:string|null;text:string;templateId?:string;channelId?:string;variables?:Record<string,string>;fallback:boolean;sender:string|null;costLabel:string};
export function normalizeGuardianPhone(value:string):string {let p=value.replace(/[\s()-]/g,'');if(p.startsWith('+82'))p='0'+p.slice(3);return /^0(?:1[016789]\d{7,8}|[2-6]\d{7,9}|70\d{8})$/.test(p)?p:'';}
export const maskGuardianPhone=(value:string)=>value.length>=8?`${value.slice(0,3)}****${value.slice(-4)}`:'번호 확인 필요';
export function kstMessageTime(value:string|undefined|null):string {if(!value)return '';const date=new Date(value);if(Number.isNaN(date.getTime()))return '';return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);}
/** Conservative Korean SMS byte budget (non-ASCII 2 bytes); reject non-BMP glyphs. */
export function smsBytes(text:string):number {if(/[\uD800-\uDFFF]/.test(text))throw Error('문자에 지원되지 않는 이모지가 있습니다.');return [...text].reduce((n,c)=>n+(c.charCodeAt(0)>127?2:1),0);}
export function substituteTemplate(content:string,variables:Record<string,string>):string {return content.replace(/#\{([^}]+)\}/g,(_,name)=>{const value=variables[name]??variables[`#{${name}}`];if(!value?.trim())throw Error(`필수 항목을 확인해 주세요: ${name}`);return value;});}
export function composeGuardianSnapshot(d:MessageDraft,c:MessageContext,template:ApprovedTemplate|null,sender:string|null,fallback=false):MessageSnapshot {
 if(!['training','hotel','daycare'].includes(d.unit)||!MESSAGE_TYPES.includes(d.type as typeof MESSAGE_TYPES[number])||!['SMS','LMS','ATA'].includes(d.channel)||c.customerId!==d.customerId||d.scheduleId!==c.scheduleId)throw Error('업무 또는 보호자 연결을 확인해 주세요.');
 const original=normalizeGuardianPhone(c.phone??'');const to=d.phoneOverride!==undefined?normalizeGuardianPhone(d.phoneOverride):original;
 if(!to)throw Error('유효한 보호자 연락처가 필요합니다.');const changed=to!==original;
 if(changed&&(!d.overrideReason||d.overrideReason.trim().length<5||d.overrideReason.length>300))throw Error('번호 변경 사유를 5자 이상 입력해 주세요.');
 let text=d.text.trim();let variables:Record<string,string>|undefined;
 if(d.channel==='ATA'){
  if(!template||template.status!=='APPROVED'||template.templateId!==d.templateId)throw Error('승인된 알림톡 템플릿이 필요합니다.');
  variables={};for(const key of template.variables){const value=d.variables?.[key]?.trim();if(!value||value.length>300||/#\{/.test(value))throw Error(`필수 템플릿 변수 확인: ${key}`);variables[`#{${key}}`]=value;}
  text=substituteTemplate(template.content,variables);if(text.length>1000)throw Error('알림톡 내용은 치환 후 1,000자 이내여야 합니다.');
 }else {const bytes=smsBytes(text);if(!text||bytes>(d.channel==='SMS'?90:2000))throw Error(d.channel==='SMS'?'SMS는 90바이트 이내로 작성해 주세요.':'LMS는 2,000바이트 이내로 작성해 주세요.');}
 if(/#\{[^}]*\}|\{\{[^}]*\}\}/.test(text))throw Error('빈 변수를 확인해 주세요.');
 return {unit:d.unit,customerId:d.customerId,...(c.scheduleId?{scheduleId:c.scheduleId,scheduleVersion:c.scheduleVersion}:{}),channel:d.channel,type:d.type,to,originalPhone:c.phone,phoneChanged:changed,overrideReason:changed?d.overrideReason!.trim():null,text,...(template&&d.channel==='ATA'?{templateId:template.templateId,channelId:template.channelId,variables}:{}),fallback:d.channel==='ATA'&&fallback,sender,costLabel:'발송 비용 발생 · 단가는 SOLAPI 계약/잔액에서 확인'};
}
export function providerMessage(snapshot:MessageSnapshot){if(!snapshot.sender)throw Error('발신번호 미확인');return {to:snapshot.to,from:snapshot.sender,type:snapshot.channel,text:snapshot.text,...(snapshot.channel==='ATA'?{kakaoOptions:{pfId:snapshot.channelId,templateId:snapshot.templateId,variables:snapshot.variables,disableSms:!snapshot.fallback}}:{})};}
export const providerMessageState=(code:string)=>code==='4000'?'success':code==='2000'?'accepted':code==='3000'?'processing':code==='5000'?'failed':'unknown';
export const MESSAGE_STATUS_LABELS:Record<string,string>={draft:'작성',submitting:'접수 대기',accepted:'접수',processing:'발송 처리중',success:'성공',failed:'실패',unknown:'상태 확인 필요'};
