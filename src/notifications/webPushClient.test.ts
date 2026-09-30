// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:{rpc:mocks.rpc}}));
let sub: PushSubscription;
let register=vi.fn(),getRegistration=vi.fn(),subscribe=vi.fn(),requestPermission=vi.fn();
beforeEach(()=>{
  vi.resetModules();vi.stubEnv('VITE_WEB_PUSH_ENABLED','true');vi.stubEnv('VITE_WEB_PUSH_PUBLIC_KEY','B'+'a'.repeat(86));
  mocks.rpc.mockReset();mocks.rpc.mockImplementation(()=>({abortSignal:()=>Promise.resolve({error:null})}));
  sub={endpoint:'https://fcm.googleapis.com/x',expirationTime:null,toJSON:()=>({keys:{p256dh:'key',auth:'auth'}}),unsubscribe:vi.fn().mockResolvedValue(true)} as unknown as PushSubscription;
  subscribe=vi.fn().mockResolvedValue(sub);const reg={pushManager:{getSubscription:vi.fn().mockResolvedValue(sub),subscribe},getNotifications:vi.fn().mockResolvedValue([])};
  register=vi.fn().mockResolvedValue(reg);getRegistration=vi.fn().mockResolvedValue(reg);requestPermission=vi.fn().mockResolvedValue('granted');
  vi.stubGlobal('isSecureContext',true);vi.stubGlobal('PushManager',class {});vi.stubGlobal('PushSubscriptionOptions',class {get applicationServerKey(){return null;}});
  vi.stubGlobal('Notification',{permission:'granted',requestPermission});
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register,getRegistration,ready:Promise.resolve(reg)}});
  Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:0});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();delete (navigator as unknown as Record<string,unknown>).serviceWorker;});
it('prepare and login reconcile never request permission; binds current browser keys only',async()=>{
  const {webPushClient}=await import('./webPushClient');await webPushClient.prepare();await webPushClient.reconcile('a');
  expect(requestPermission).not.toHaveBeenCalled();expect(mocks.rpc).toHaveBeenCalledWith('register_web_push_subscription_v1',expect.not.objectContaining({profile_id:expect.anything()}));
});
it('permission starts synchronously on explicit enable',async()=>{
  const {webPushClient}=await import('./webPushClient');const pending=webPushClient.enable('a');expect(requestPermission).toHaveBeenCalledOnce();await pending;
});
it('logout server failure still unsubscribes browser',async()=>{
  const {cleanupPushBeforeLogout}=await import('./webPushClient');mocks.rpc.mockImplementation(()=>({abortSignal:()=>Promise.reject(Error('offline'))}));
  await cleanupPushBeforeLogout();expect(sub.unsubscribe).toHaveBeenCalled();
});
it('account switch rebinds through auth RPC without a caller supplied user id',async()=>{
  const {webPushClient}=await import('./webPushClient');await webPushClient.reconcile('a');await webPushClient.reconcile('b');expect(mocks.rpc).toHaveBeenCalledTimes(2);
  for(const [,args] of mocks.rpc.mock.calls)expect(Object.keys(args)).toEqual(['p_endpoint','p_p256dh','p_auth','p_expiration_time']);
});
it('account switches while permission pending abort old registration',async()=>{
  let allow:(v:string)=>void=()=>{};requestPermission.mockReturnValue(new Promise<string>(r=>allow=r));
  const {webPushClient,notePushIdentity}=await import('./webPushClient');const pending=webPushClient.enable('a');notePushIdentity('b');allow('granted');await expect(pending).rejects.toThrow('계정');expect(mocks.rpc).not.toHaveBeenCalled();
});
it('registration failure invalidates local endpoint',async()=>{
  mocks.rpc.mockImplementation(()=>({abortSignal:()=>Promise.resolve({error:{code:'42501'}})}));const {webPushClient}=await import('./webPushClient');await expect(webPushClient.reconcile('a')).rejects.toThrow();expect(sub.unsubscribe).toHaveBeenCalled();
});
it('feature detection install/unsupported/denied without UA sniffing',async()=>{
  const {detectPushSupport}=await import('./webPushClient');vi.stubGlobal('Notification',{permission:'denied'});expect(detectPushSupport()).toBe('denied');
  vi.stubGlobal('isSecureContext',false);expect(detectPushSupport()).toBe('unsupported');Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:5});expect(detectPushSupport()).toBe('install');
});
it('badge support and failure are non-blocking',async()=>{
  const {syncAppBadge}=await import('./webPushClient');await syncAppBadge(1);Object.defineProperty(navigator,'setAppBadge',{configurable:true,value:vi.fn().mockRejectedValue(Error('no'))});await expect(syncAppBadge(3)).resolves.toBeUndefined();delete (navigator as unknown as Record<string,unknown>).setAppBadge;
});

it('network failure during account reconciliation also unsubscribes old endpoint',async()=>{
  mocks.rpc.mockImplementation(()=>({abortSignal:()=>Promise.reject(Error('offline'))}));const {webPushClient}=await import('./webPushClient');await expect(webPushClient.reconcile('b')).rejects.toThrow();expect(sub.unsubscribe).toHaveBeenCalled();
});
it('feature rollback does not bypass logout cleanup',async()=>{
  vi.stubEnv('VITE_WEB_PUSH_ENABLED','false');const {cleanupPushBeforeLogout}=await import('./webPushClient');await cleanupPushBeforeLogout();expect(sub.unsubscribe).toHaveBeenCalled();
});

it('pending OS permission cannot hold logout or a new account reconciliation',async()=>{
  let allow:(v:string)=>void=()=>{};requestPermission.mockReturnValue(new Promise<string>(resolve=>allow=resolve));
  const {webPushClient,cleanupPushBeforeLogout}=await import('./webPushClient');const oldEnable=webPushClient.enable('a');
  await cleanupPushBeforeLogout();expect(sub.unsubscribe).toHaveBeenCalled();await webPushClient.reconcile('b');
  allow('granted');await expect(oldEnable).rejects.toThrow('계정');
});
