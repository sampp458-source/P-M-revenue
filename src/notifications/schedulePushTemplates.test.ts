import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect,it,vi } from 'vitest';
it.each([
 ['SCHEDULE_ASSIGNED','새 일정이 등록되었습니다.'],['SCHEDULE_UPDATED','일정이 변경되었습니다.'],
 ['SCHEDULE_COMPLETED','일정이 완료 처리되었습니다.'],['SCHEDULE_CANCELLED','일정이 취소되었습니다.'],
 ['DAILY_SCHEDULE_SUMMARY','오늘 일정 4건이 있습니다.'],['ANNOUNCEMENT','새 공지가 도착했습니다.'],
])('SW displays only static privacy-safe %s template',async(event_type,body)=>{
 const handlers:Record<string,(e:unknown)=>void>={};const show=vi.fn(async()=>{});
 runInNewContext(readFileSync('public/notification-sw.js','utf8'),{self:{addEventListener:(name:string,fn:(e:unknown)=>void)=>handlers[name]=fn,registration:{showNotification:show}}});
 const waits:Promise<unknown>[]=[];
 handlers.push({data:{json:()=>({v:1,notification_id:'00000000-0000-4000-8000-000000000001',deep_link_type:event_type==='ANNOUNCEMENT'?'ANNOUNCEMENT':'CENTER',deep_link_id:'00000000-0000-4000-8000-000000000002',event_type,summary_count:4,title:'PRIVATE NAME',body:'PRIVATE MEMO',phone:'PRIVATE PHONE'})},waitUntil:(p:Promise<unknown>)=>waits.push(p)});
 await Promise.all(waits);expect(show).toHaveBeenCalledWith('P&M OS',expect.objectContaining({body}));expect(JSON.stringify(show.mock.calls)).not.toContain('PRIVATE');
});
