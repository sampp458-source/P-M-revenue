import { expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { buildPreview } from "../../supabase/functions/notification-push-dispatch/preview";
const now=Date.parse("2026-10-15T23:45:00Z");
const source={title:"밤비 어질리티",body:"매트를 준비해 주세요.",summary:"2026.10.16 · 09:00 · 기타",sender:"담당 직원",due_at:"2026-10-16T03:00:00Z"};
const events=["SCHEDULE_ASSIGNED","SCHEDULE_ASSIGNED","SCHEDULE_UPDATED","SCHEDULE_COMPLETED","SCHEDULE_CANCELLED","SCHEDULE_REMINDER","SCHEDULE_REMINDER","SCHEDULE_ASSIGNED","ANNOUNCEMENT","ANNOUNCEMENT","TASK_REQUEST_ASSIGNED","TASK_REQUEST_ASSIGNED","PAYMENT_CONFIRMATION_REQUESTED","PAYMENT_REQUEST_REQUESTED","ANNOUNCEMENT","TASK_REQUEST_ASSIGNED","ANNOUNCEMENT","SCHEDULE_UPDATED"];
const fixtures=events.map((event_type,i)=>({event_type,category:event_type==="ANNOUNCEMENT"?"ANNOUNCEMENT":event_type.startsWith("TASK")?"TASK_REQUEST":event_type.startsWith("PAYMENT_CONFIRMATION")?"PAYMENT_CONFIRMATION_REQUEST":event_type.startsWith("PAYMENT_REQUEST")?"PAYMENT_REQUEST":"SCHEDULE",expires_at:"2026-10-16T00:00:00Z",preview_source:i===15?{}:i===16?{title:"연락 010-1234-5678",body:"메일 test@example.com 계좌 123456789012 금액 100,000원"}:i===14?{title:"긴 제목 ".repeat(40),body:"긴 본문\n".repeat(150)}:i===8||i===9?{title:"운영 안내",ack_required:i===9,body:"오전 회의는 10시에 시작합니다.\n자료를 준비해주세요."}:i===12||i===13?{subject:"홍길동",body:i===12?"새 결제 확인 요청이 있습니다.":"새 지급 요청이 있습니다."}:source}));
it("prints 18 real-contract synthetic preview fixtures and preserves SW routing",()=>{
 const results=fixtures.map((d,i)=>({case:i+1,...buildPreview(d,now)}));
 for(const r of results){expect(r.preview?.title.length).toBeLessThanOrEqual(80);expect(r.preview?.body.length).toBeLessThanOrEqual(160);}
 expect(results[9].preview?.body).toContain("확인 필요");
 expect(results[5].preview?.body).toContain("15분 후");expect(results[11].preview?.body).toContain("12:00 KST");
 expect(results[12].preview?.title).toBe("[입금 확인 요청] 홍**");expect(results[12].preview?.body).not.toContain("100,000");
 expect(JSON.stringify(results[16])).not.toMatch(/010-1234|test@example|123456789012|100,000/);
 mkdirSync('outputs/notification-preview-candidate',{recursive:true});
 writeFileSync('outputs/notification-preview-candidate/payload-fixtures.json',JSON.stringify(results,null,2));
 const handlers:Record<string,(event:unknown)=>void>={};const calls:unknown[][]=[];
 runInNewContext(readFileSync('public/notification-sw.js','utf8'),{self:{addEventListener:(name:string,f:(e:unknown)=>void)=>handlers[name]=f,registration:{showNotification:(...args:unknown[])=>{calls.push(args);return Promise.resolve();}}},Date:class extends Date {static now(){return now;}}});
 handlers.push({data:{json:()=>({v:1,notification_id:'11111111-1111-4111-8111-111111111111',deep_link_id:'22222222-2222-4222-8222-222222222222',deep_link_type:'CENTER',...fixtures[0],...results[0]})},waitUntil:()=>{}});
 expect(calls[0][0]).toBe(results[0].preview?.title);
 expect((calls[0][1] as {body:string}).body).toBe(results[0].preview?.body);
 expect(buildPreview({category:'SCHEDULE',event_type:'SCHEDULE_ASSIGNED'})).toEqual({});
 const sw=readFileSync('public/notification-sw.js','utf8');expect(sw).toContain('push_notification');expect(sw).toContain('data.preview_version === 1');
});
it("format does not invent changed-from time, duration, missing due or money",()=>{
 expect(buildPreview({category:'SCHEDULE',event_type:'SCHEDULE_UPDATED',preview_source:source},now).preview?.body).not.toContain('→');
 const p=buildPreview({category:'TASK_REQUEST',event_type:'TASK_REQUEST_ASSIGNED',preview_source:{title:'점검'}});expect(p.preview?.body).not.toContain('기한');
});

const paymentCases = [["PAYMENT_CONFIRMATION_REQUESTED", "입금 여부를 확인해주세요."], ["PAYMENT_CONFIRMATION_UPDATED", "입금 확인 요청이 수정되었습니다."], ["PAYMENT_CONFIRMATION_CONFIRMED", "입금이 확인되었습니다."], ["PAYMENT_CONFIRMATION_NOT_FOUND", "입금이 아직 확인되지 않았습니다."], ["PAYMENT_CONFIRMATION_CANCELLED", "입금 확인 요청이 취소되었습니다."], ["PAYMENT_CONFIRMATION_ADMIN_CANCELLED", "입금 확인 요청이 관리 종료되었습니다. 입금 여부는 별도로 확인해주세요."], ["PAYMENT_REQUEST_REQUESTED", "지급 요청을 확인해주세요."], ["PAYMENT_REQUEST_COMPLETED", "지급 요청이 완료 처리되었습니다."], ["PAYMENT_REQUEST_REJECTED", "지급 요청이 반려되었습니다."], ["PAYMENT_REQUEST_CANCELLED", "지급 요청이 취소되었습니다."], ["PAYMENT_REQUEST_ADMIN_CANCELLED", "지급 요청이 관리 종료되었습니다. 외부 지급 여부는 별도로 확인해주세요."]] as const;
it.each(paymentCases)("payment %s ignores all free-form title/body content",(event_type,message)=>{
 const category=event_type.startsWith('PAYMENT_CONFIRMATION_')?'PAYMENT_CONFIRMATION_REQUEST':'PAYMENT_REQUEST';
 for(const secret of ['김고객 반려견 비밀이름 특별사유','예약금 100,000원','계좌 123-456789-012 연락처 010-1234-5678','']){
  const p=buildPreview({category,event_type,preview_source:{title:secret,body:secret,summary:secret,sender:secret,subject:'김고객'}}).preview;
  expect(p?.body).toBe(message+' · 대상·금액은 요청 상세에서 확인');
  expect(p?.title).toMatch(/김\*\*$/);
  expect(JSON.stringify(p)).not.toMatch(/김고객|비밀이름|특별사유|100,000|123-456789|010-1234/);
 }
 const missing=buildPreview({category,event_type,preview_source:{}}).preview;
 expect(missing?.body).toBe(message+' · 대상·금액은 요청 상세에서 확인');expect(missing?.title).not.toContain('**');
});
