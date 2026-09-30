// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { PushSettings } from "./PushSettings";
import { type PushState, type webPushClient } from "./webPushClient";
vi.mock("../lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function client(state: PushState) {
  return { prepare: vi.fn().mockResolvedValue(undefined), status: vi.fn().mockResolvedValue(state), enable: vi.fn().mockResolvedValue(undefined), disable: vi.fn().mockResolvedValue(undefined), reconcile: vi.fn() } as unknown as typeof webPushClient;
}
describe("Push settings", () => {
  it.each([['off','휴대폰 알림 켜기'],['on','이 기기 알림 끄기'],['denied','알림이 차단되어 있습니다.'],['unsupported','이 기기에서는 휴대폰 알림이 지원되지 않습니다.'],['install','홈 화면에 추가한 P&M OS에서 알림을 켜주세요.']])("renders %s without permission on mount", async (state, text) => {
    const api=client(state as PushState);render(<PushSettings userId="u" client={api}/>);
    await waitFor(()=>expect(screen.getByText(new RegExp(text))).toBeTruthy());expect(api.enable).not.toHaveBeenCalled();
  });
  it("enable is explicit gesture and disable targets this device",async()=>{
    const api=client('off');render(<PushSettings userId="u" client={api}/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'휴대폰 알림 켜기'}).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'휴대폰 알림 켜기'}));expect(api.enable).toHaveBeenCalledWith('u');
    cleanup();const on=client('on');render(<PushSettings userId="u" client={on}/>);
    fireEvent.click(await screen.findByRole('button',{name:'이 기기 알림 끄기'}));expect(on.disable).toHaveBeenCalledOnce();
  });
});
function sw() {
  const listeners: Record<string,(event: unknown)=>void>={};
  const showNotification=vi.fn().mockResolvedValue(undefined), openWindow=vi.fn().mockResolvedValue(undefined),matchAll=vi.fn().mockResolvedValue([]);
  runInNewContext(readFileSync('public/notification-sw.js','utf8'),{self:{addEventListener:(type:string,cb:(e:unknown)=>void)=>listeners[type]=cb,registration:{showNotification},clients:{openWindow,matchAll},location:{origin:'https://example.test'}}, URL});
  return {listeners,showNotification,openWindow,matchAll};
}
const payload={v:1,notification_id:'00000000-0000-4000-8000-000000000001',deep_link_type:'ANNOUNCEMENT',deep_link_id:'00000000-0000-4000-8000-000000000002'};
describe('actual Service Worker script',()=>{
  it('valid minimal payload shows generic private notification',async()=>{
    const s=sw();let pending:Promise<unknown>|undefined;s.listeners.push({data:{json:()=>payload},waitUntil:(p:Promise<unknown>)=>pending=p});await pending;
    expect(s.showNotification).toHaveBeenCalledWith('P&M OS',expect.objectContaining({body:'새 공지가 도착했습니다.',renotify:false}));
  });
  it.each([null,{}, {...payload,url:'https://evil.test'}, {...payload,deep_link_type:'evil'}, {...payload,notification_id:'bad'}])('rejects malformed/external route payload',data=>{
    const s=sw();s.listeners.push({data:{json:()=>data},waitUntil:vi.fn()});expect(s.showNotification).not.toHaveBeenCalled();
  });
  it('click opens fixed same-origin typed context',async()=>{
    const s=sw();let pending:Promise<unknown>|undefined;s.listeners.notificationclick({notification:{close:vi.fn(),data:payload},waitUntil:(p:Promise<unknown>)=>pending=p});await pending;
    expect(s.openWindow).toHaveBeenCalledWith('https://example.test/select-module?push_notification='+payload.notification_id);
  });
  it('existing client focused and receives typed context without navigation',async()=>{
    const s=sw(),focus=vi.fn(),postMessage=vi.fn();s.matchAll.mockResolvedValue([{url:'https://example.test/operations/today',focus,postMessage}]);
    let pending:Promise<unknown>|undefined;s.listeners.notificationclick({notification:{close:vi.fn(),data:payload},waitUntil:(p:Promise<unknown>)=>pending=p});await pending;
    expect(focus).toHaveBeenCalledOnce();expect(postMessage).toHaveBeenCalledWith({type:'PNM_PUSH_OPEN',notificationId:payload.notification_id});expect(s.openWindow).not.toHaveBeenCalled();
  });
  it('no permission, cache, fetch interceptor or arbitrary payload text',()=>{
    const source=readFileSync('public/notification-sw.js','utf8');expect(source).not.toMatch(/requestPermission|caches\.|addEventListener\("fetch"/);expect(source).not.toContain('data.body');
  });
});

it('subscriptionchange retires unauthenticated replacement and notifies open client',async()=>{
  const s=sw(),unsubscribe=vi.fn().mockResolvedValue(true),postMessage=vi.fn();s.matchAll.mockResolvedValue([{postMessage}]);let pending:Promise<unknown>|undefined;
  s.listeners.pushsubscriptionchange({newSubscription:{unsubscribe},waitUntil:(p:Promise<unknown>)=>pending=p});await pending;expect(unsubscribe).toHaveBeenCalledOnce();expect(postMessage).toHaveBeenCalledWith({type:'PNM_PUSH_RECONCILE'});
});
it('invalid JSON push cannot surface arbitrary text',()=>{
  const s=sw();s.listeners.push({data:{json:()=>{throw Error('bad json');}},waitUntil:vi.fn()});expect(s.showNotification).not.toHaveBeenCalled();
});
