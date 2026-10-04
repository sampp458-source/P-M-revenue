// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { NotificationContext, type NotificationState } from './notificationContext';
import { NotificationDialogs } from './NotificationUi';
import { emptyInbox,notificationRepository,type Notice } from './notificationRepository';
import { scheduleNotificationPath,validScheduleDate } from './scheduleNotificationNavigation';
vi.mock('../lib/supabase',()=>({supabase:{}}));
vi.mock('./webPushClient',()=>({webPushEnabled:true}));
vi.mock('./PushSettings',()=>({PushSettings:()=> <section aria-label="휴대폰 알림">이 기기에서 알림 받는 중</section>}));
afterEach(cleanup);
const sample=(extra:Partial<Notice>={}):Notice=>({id:'n1',announcement_id:null,category:'SCHEDULE',deep_link_type:'SCHEDULE',deep_link_id:'00000000-0000-4000-8000-000000000001',schedule_local_date:'2026-10-01',title:'새 일정이 등록되었습니다.',message:'2026. 10. 01. · 시간 미정 · 행동교정',priority:'NORMAL',ack_required:false,created_at:'2026-09-30T10:00:00Z',read_at:null,acknowledged_at:null,popup_presented_at:null,revoked_at:null,expires_at:null,...extra});
function mount(items:Notice[]){
 const navigate=vi.fn();const read=vi.fn(async()=>{});const acknowledge=vi.fn();const inbox={...emptyInbox,items,unread_count:items.filter(x=>!x.read_at).length};
 const state:NotificationState={userId:'self',repository:{...notificationRepository,inbox:vi.fn(async()=>inbox),read,acknowledge},inbox,error:'',loading:false,view:'center',setView:vi.fn(),detail:null,setDetail:vi.fn(),refresh:vi.fn(async()=>{})};
 render(<NotificationContext.Provider value={state}><NotificationDialogs navigate={navigate}/></NotificationContext.Provider>);return {navigate,read,acknowledge};
}
it('schedule/daily/read/unread coexist with announcement and device settings; never schedule ACK',async()=>{
 mount([sample({ack_required:true}),sample({id:'n2',title:'오늘 일정 4건이 있습니다.',deep_link_type:'SCHEDULE_DAY',read_at:'2026-09-30T10:00:00Z'}),sample({id:'n3',category:'ANNOUNCEMENT',announcement_id:'a1',deep_link_type:'ANNOUNCEMENT',title:'운영 공지',ack_required:true})]);
 await screen.findByText('새 일정이 등록되었습니다.');expect(screen.getByText('오늘 일정 4건이 있습니다.')).toBeTruthy();expect(screen.getAllByText('확인 필요')).toHaveLength(1);expect(document.querySelectorAll('.pn-read')).toHaveLength(1);expect(document.querySelectorAll('.pn-unread')).toHaveLength(2);expect(screen.getByText('이 기기에서 알림 받는 중')).toBeTruthy();expect(screen.getAllByText(/시간 미정/)).toHaveLength(3);
});
it('read precedes typed calendar navigation and never completes/ACKs schedule',async()=>{
 const x=mount([sample()]);fireEvent.click(await screen.findByRole('button',{name:/새 일정이 등록/}));await waitFor(()=>expect(x.navigate).toHaveBeenCalledWith('/operations/calendar?notification_date=2026-10-01'));expect(x.read).toHaveBeenCalledWith('n1');expect(x.read.mock.invocationCallOrder[0]).toBeLessThan(x.navigate.mock.invocationCallOrder[0]);expect(x.acknowledge).not.toHaveBeenCalled();
});
it('failed schedule read retains navigation',async()=>{
 const x=mount([sample()]);x.read.mockRejectedValueOnce(Error('거부'));fireEvent.click(await screen.findByRole('button',{name:/새 일정이 등록/}));await screen.findByText('읽음 상태를 저장하지 못했습니다. 알림센터에서 다시 확인해 주세요.');expect(x.navigate).toHaveBeenCalledTimes(1);
});
it.each(['2026-02-30','https://evil.test','2026-1-01','2026-09-30&x=1',null])('rejects invalid typed local date %s',date=>{expect(validScheduleDate(date)).toBe(false);expect(scheduleNotificationPath(sample({schedule_local_date:date}))).toBeNull();});
it('calendar path only accepts typed schedule links; preserves server KST day',()=>{
 expect(scheduleNotificationPath(sample())).toBe('/operations/calendar?notification_date=2026-10-01');expect(scheduleNotificationPath(sample({category:'ANNOUNCEMENT'}))).toBeNull();expect(scheduleNotificationPath(sample({deep_link_id:'https://evil.test'}))).toBeNull();
});

it('notification finalizer locks only FK-free notification state before canonical MVCC reads',()=>{
 const migration=readFileSync('supabase/migrations/202609300003_schedule_notifications_sprint3a.sql','utf8');
 const state=migration.split('CREATE TABLE public.notification_schedule_state (')[1].split(');')[0];
 expect(state).not.toMatch(/REFERENCES/i);
 expect(migration).not.toContain('notification_schedule_parent_lock');
 expect(migration).not.toContain('lock_schedule_notification_parent_v1');
 const finalizer=migration.split('CREATE FUNCTION public.finalize_schedule_notification_v1()')[1].split('END $$;')[0].replace(/--[^\n]*/g,'');
 const locks=finalizer.match(/SELECT[^;]*FOR (?:UPDATE|SHARE|KEY SHARE|NO KEY UPDATE)/gi) ?? [];
 expect(locks).toHaveLength(1);
 expect(locks[0]).toContain('FROM public.notification_schedule_state');
 expect(finalizer.indexOf('FROM public.notification_schedule_state')).toBeLessThan(finalizer.indexOf('FROM public.operation_schedules'));
 expect(finalizer).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM) public\.operation_schedule/);
 expect(finalizer).not.toMatch(/PERFORM public\.(?!emit_schedule_notification_v1)/);
 expect(finalizer).toContain("VALUES(sid,'null'::jsonb,'{}','scheduled',false)");
});
