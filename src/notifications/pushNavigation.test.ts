// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { consumePushTarget, rememberPushTarget, installPushNavigation } from './pushNavigation';
const id='00000000-0000-4000-8000-000000000001';
afterEach(()=>{sessionStorage.clear();history.replaceState(null,'','/');vi.restoreAllMocks();delete (navigator as unknown as Record<string,unknown>).serviceWorker;});
it('typed context survives login redirect and consumes once',()=>{
  history.replaceState(null,'','/select-module?push_notification='+id);installPushNavigation();history.replaceState(null,'','/login');
  expect(consumePushTarget()).toBe(id);expect(consumePushTarget()).toBeNull();
});
it('external URL or malformed value never preserved',()=>{
  rememberPushTarget('https://evil.test');expect(consumePushTarget()).toBeNull();rememberPushTarget(null);expect(consumePushTarget()).toBeNull();
});
it('removes routing query after consume without losing other query',()=>{
  history.replaceState(null,'','/select-module?scope=operations&push_notification='+id);expect(consumePushTarget()).toBe(id);expect(location.search).toBe('?scope=operations');
});
it('existing logged out window retains SW click context',()=>{
  let callback:(e:MessageEvent)=>void=()=>{};Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{addEventListener:(_type:string,fn:typeof callback)=>callback=fn}});
  installPushNavigation();callback({data:{type:'PNM_PUSH_OPEN',notificationId:id}} as MessageEvent);expect(consumePushTarget()).toBe(id);
});
it('blocked session storage does not break launch',()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked');});vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('blocked');});
  expect(()=>rememberPushTarget(id)).not.toThrow();expect(()=>consumePushTarget()).not.toThrow();
});
