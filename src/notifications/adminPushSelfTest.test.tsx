// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AdminPushSelfTest} from './AdminPushSelfTest';
import {buildPreview} from '../../supabase/functions/notification-push-dispatch/preview';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
vi.mock('../lib/supabase',()=>({supabase:{rpc:vi.fn()}}));
afterEach(cleanup);
const context={allowed:true,subscription:{id:'s',binding_id:'b',provider:'Apple 기기',last_seen_at:'2026-11-02T03:00:00Z'}};
function api(){return {context:vi.fn().mockResolvedValue(context),send:vi.fn().mockResolvedValue({request_id:'r',notification_id:'n',delivery_id:'d',status:'PENDING'})};}
it('non-admin has no send control',async()=>{const a=api();a.context.mockResolvedValue({allowed:false} as typeof context);render(<AdminPushSelfTest userId="u" api={a}/>);await waitFor(()=>expect(a.context).toHaveBeenCalled());expect(screen.queryByRole('button',{name:'테스트 알림 1건 보내기'})).toBeNull();});
it('ambiguous device blocks sending',async()=>{const a=api();a.context.mockResolvedValue({allowed:true,blocked:'연결 기기 확인 필요'} as unknown as typeof context);render(<AdminPushSelfTest userId="u" api={a}/>);expect(await screen.findByText('연결 기기 확인 필요')).toBeTruthy();expect(a.send).not.toHaveBeenCalled();});
it('explicit confirmation, fresh check and duplicate click protection',async()=>{const a=api();render(<AdminPushSelfTest userId="u" api={a}/>);const b=await screen.findByRole('button',{name:'테스트 알림 1건 보내기'});expect(b.hasAttribute('disabled')).toBe(true);fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(b);fireEvent.click(b);await waitFor(()=>expect(a.send).toHaveBeenCalledOnce());expect(a.send.mock.calls[0]).toHaveLength(3);expect(a.context).toHaveBeenCalledTimes(2);expect(b.hasAttribute('disabled')).toBe(true);});
it('stale subscription cannot execute',async()=>{const a=api();a.context.mockResolvedValueOnce(context).mockResolvedValue({...context,subscription:{...context.subscription,id:'other'}});render(<AdminPushSelfTest userId="u" api={a}/>);await screen.findByRole('checkbox');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'테스트 알림 1건 보내기'}));expect(await screen.findByRole('alert')).toBeTruthy();expect(a.send).not.toHaveBeenCalled();});
it('uncertain response keeps same request id rather than making a new notification',async()=>{const a=api();a.send.mockRejectedValueOnce(new Error('결과 확인 필요'));render(<AdminPushSelfTest userId="u" api={a}/>);fireEvent.click(await screen.findByRole('checkbox'));const b=screen.getByRole('button',{name:'테스트 알림 1건 보내기'});fireEvent.click(b);await screen.findByRole('alert');fireEvent.click(b);await waitFor(()=>expect(a.send).toHaveBeenCalledTimes(2));expect(a.send.mock.calls[0][0]).toBe(a.send.mock.calls[1][0]);});
it('fixed preview ignores arbitrary source; current and legacy SW safely route CENTER',()=>{
 const preview=buildPreview({category:'PUSH_SELF_TEST',event_type:'ADMIN_PUSH_SELF_TEST',preview_source:{title:'secret',body:'010-1234-5678'}});
 expect(preview.preview?.title).toBe('[테스트 알림] 새 미리보기 확인');expect(preview.preview?.body).toBe('P&M OS 알림 표시 테스트입니다. 실제 업무 처리는 필요하지 않습니다.');
 const payload={v:1,notification_id:'11111111-1111-4111-8111-111111111111',deep_link_id:'11111111-1111-4111-8111-111111111111',deep_link_type:'CENTER',event_type:'ADMIN_PUSH_SELF_TEST',...preview};
 const handlers:Record<string,(e:unknown)=>void>={};const show=vi.fn().mockResolvedValue(undefined);const open=vi.fn().mockResolvedValue(undefined);
 runInNewContext(readFileSync('public/notification-sw.js','utf8'),{self:{addEventListener:(n:string,f:(e:unknown)=>void)=>handlers[n]=f,registration:{showNotification:show},location:{origin:'https://example.test'},clients:{matchAll:async()=>[],openWindow:open}},URL});
 handlers.push({data:{json:()=>payload},waitUntil:()=>{}});expect(show.mock.calls[0][0]).toBe(preview.preview?.title);
 let pending:Promise<unknown>|undefined;handlers.notificationclick({notification:{close:()=>{},data:payload},waitUntil:(p:Promise<unknown>)=>{pending=p;}});return pending!.then(()=>expect(open.mock.calls[0][0]).toContain('/select-module?push_notification='));
});
