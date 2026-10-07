import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';
const sw=readFileSync('public/notification-sw.js','utf8');
it('payment push templates do not include business payload',()=>{
 const body=runInNewContext(sw.slice(0,sw.indexOf('self.addEventListener'))+';pushBody;') as (v:unknown)=>string;
 const messages=['새 결제 확인 요청이 있습니다.','입금이 확인되었습니다.','입금이 아직 확인되지 않았습니다.','결제 확인 요청이 수정되었습니다.','새 지급 요청이 있습니다.','요청한 지급이 완료되었습니다.','지급 요청이 반려되었습니다.','요청이 취소되었습니다.'];
 for(const message of messages)expect(sw).toContain(message);
 const paymentBlock=sw.slice(sw.indexOf('const payments ='),sw.indexOf('const tasks ='));
 expect(paymentBlock).not.toMatch(/data\.(amount|payer|payee|note|reason|title|body)/);
 for(const event_type of ['PAYMENT_CONFIRMATION_UPDATED','PAYMENT_CONFIRMATION_REQUESTED','PAYMENT_CONFIRMATION_CONFIRMED','PAYMENT_CONFIRMATION_NOT_FOUND','PAYMENT_CONFIRMATION_CANCELLED','PAYMENT_REQUEST_REQUESTED','PAYMENT_REQUEST_COMPLETED','PAYMENT_REQUEST_REJECTED','PAYMENT_REQUEST_CANCELLED'])expect(messages).toContain(body({event_type,amount:100000,payer_name:'SECRET',payee_name:'SECRET',title:'SECRET',note:'SECRET',reason:'SECRET'}));
});
it('candidate never writes Finance ledgers or calls financial commands; legacy whitelist stays unchanged',()=>{
 const sql=readFileSync('supabase/migrations/202610070001_payment_requests_v1.sql','utf8');
 expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:public\.)?(?:sales|sale_payments|sale_refunds|monthly_closings)\b/i);
 expect(sql).not.toMatch(/public\.(?:add_sale_payment|edit_sale_with_initial_payments|record_sale_refund|void_sale_payment)\s*\(/);
 expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.set_notification_capability_v1/);
 expect(sql).toContain('payment_confirmation_enabled boolean NOT NULL DEFAULT false');
 expect(sql).toContain('payment_request_enabled boolean NOT NULL DEFAULT false');
 expect(sql).not.toMatch(/ALTER PUBLICATION|cron\.schedule/);
});

it.each([
 ['PAYMENT_CONFIRMATION_ADMIN_CANCELLED','결제 확인 요청이 관리 종료되었습니다. 입금 여부를 확인해 주세요.'],
 ['PAYMENT_REQUEST_ADMIN_CANCELLED','지급 요청이 관리 종료되었습니다. 외부 지급 여부를 확인해 주세요.'],
 ['PAYMENT_CONFIRMATION_CANCELLED','요청이 취소되었습니다.'],
 ['PAYMENT_REQUEST_CANCELLED','요청이 취소되었습니다.'],
])('exact lock-screen copy for %s excludes all sensitive fields', (event_type, expected)=>{
 const body=runInNewContext(sw.slice(0,sw.indexOf('self.addEventListener'))+';pushBody;') as (v:unknown)=>string;
 expect(body({event_type,amount:123456,payer_name:'PRIVATE PAYER',customer_name:'PRIVATE CUSTOMER',dog_name:'PRIVATE DOG',payee_name:'PRIVATE PAYEE',reason:'PRIVATE REASON',staff_name:'PRIVATE STAFF',account:'PRIVATE ACCOUNT',card:'PRIVATE CARD',title:'PRIVATE TITLE',body:'PRIVATE BODY'})).toBe(expected);
});
