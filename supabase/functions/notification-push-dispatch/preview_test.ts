import { buildPreview } from "./preview.ts";
Deno.test("preview is bounded, explicit KST and privacy-masked before encryption",()=>{
 const p=buildPreview({category:"TASK_REQUEST",event_type:"TASK_REQUEST_ASSIGNED",preview_source:{title:"업무 점검",body:"010-1234-5678 test@example.com 100,000원",due_at:"2026-10-15T15:00:00Z"}}).preview;
 if(!p||!p.body.includes("2026.10.16 00:00 KST")||/010-1234|test@example|100,000/.test(p.body))throw Error("unsafe preview");
});
Deno.test("old DB source absence remains backward compatible",()=>{
 if(Object.keys(buildPreview({category:"SCHEDULE",event_type:"SCHEDULE_ASSIGNED"})).length)throw Error("unexpected fields");
});

Deno.test("payment copy never consumes a sensitive n.title body projection",()=>{
 for(const event_type of ['PAYMENT_CONFIRMATION_REQUESTED','PAYMENT_CONFIRMATION_NOT_FOUND','PAYMENT_CONFIRMATION_CONFIRMED','PAYMENT_CONFIRMATION_UPDATED','PAYMENT_CONFIRMATION_CANCELLED','PAYMENT_CONFIRMATION_ADMIN_CANCELLED','PAYMENT_REQUEST_REQUESTED','PAYMENT_REQUEST_COMPLETED','PAYMENT_REQUEST_REJECTED','PAYMENT_REQUEST_CANCELLED','PAYMENT_REQUEST_ADMIN_CANCELLED']){
  const category=event_type.startsWith('PAYMENT_CONFIRMATION_')?'PAYMENT_CONFIRMATION_REQUEST':'PAYMENT_REQUEST';
  const normal=buildPreview({category,event_type,preview_source:{}}).preview;
  const secret=buildPreview({category,event_type,preview_source:{title:'김고객 100,000원',body:'김고객 계좌 123456789012 연락처 01012345678 반려견 비밀사유'}}).preview;
  if(!normal||normal.body!==secret?.body||normal.title!==secret.title)throw Error('free-text dependency');
 }
});
