// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { RealtimeClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createNotificationRealtime } from "./notificationRealtime";
const session = (id = "A", token = "token-A") => ({ user: { id }, access_token: token, expires_at: Math.floor(Date.now()/1000)+3600 }) as Session;
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
const flush = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
function setup() {
  let current: Session | null = session();
  const listeners = new Set<(event: string, value: Session | null)=>void>();
  const channels: ReturnType<typeof makeChannel>[]=[];
  function makeChannel() { const c={on:vi.fn(),subscribe:vi.fn()};c.on.mockReturnValue(c);c.subscribe.mockReturnValue(c);return c; }
  const db={auth:{getSession:vi.fn(async()=>({data:{session:current},error:null})),onAuthStateChange:vi.fn((cb: (event:string,value:Session|null)=>void)=>{listeners.add(cb);return {data:{subscription:{unsubscribe:()=>listeners.delete(cb)}}};})},realtime:{setAuth:vi.fn(async()=>{})},channel:vi.fn(()=>{const c=makeChannel();channels.push(c);return c;}),removeChannel:vi.fn(async()=>"ok")};
  const subscribe=createNotificationRealtime(db as unknown as SupabaseClient);
  const emit=(event:string,value:Session|null)=>{current=value;for(const cb of listeners) cb(event,value);};
  return {db,subscribe,emit,channels};
}
describe("notification auth-before-subscribe",()=>{
 it("delayed session and setAuth block all tokenless joins",async()=>{
  const x=setup(),lookup=deferred<{data:{session:Session},error:null}>(),auth=deferred<void>();
  x.db.auth.getSession.mockReturnValueOnce(lookup.promise);x.db.realtime.setAuth.mockReturnValueOnce(auth.promise);
  const off=x.subscribe("A",vi.fn());await flush();expect(x.db.channel).not.toHaveBeenCalled();
  lookup.resolve({data:{session:session()},error:null});await flush();expect(x.db.realtime.setAuth).toHaveBeenCalledWith("token-A");expect(x.db.channel).not.toHaveBeenCalled();
  auth.resolve();await flush();expect(x.db.channel).toHaveBeenCalledTimes(1);expect(x.channels[0].subscribe).toHaveBeenCalledTimes(1);off();await flush();
 });
 it.each([null,session("B"),{...session(),access_token:""},{...session(),expires_at:1}])("does not join without a matching valid session",async value=>{
  const x=setup();x.emit("INITIAL_SESSION",value);const off=x.subscribe("A",vi.fn());await flush();expect(x.db.channel).not.toHaveBeenCalled();off();await flush();
 });
 it("preserves four filtered listeners, no DELETE, refresh updates auth without duplicate channels",async()=>{
  const x=setup(),refresh=vi.fn(),off=x.subscribe("A",refresh);await flush();const c=x.channels[0];
  expect(c.on.mock.calls.map(a=>a[1])).toEqual(["notifications","notification_inbox_revisions"].flatMap(table=>["INSERT","UPDATE"].map(event=>({event,schema:"public",table,filter:"recipient_id=eq.A"}))));
  c.subscribe.mock.calls[0][0]("SUBSCRIBED");expect(refresh).toHaveBeenCalledTimes(1);
  x.emit("TOKEN_REFRESHED",session("A","token-B"));await flush();expect(x.db.realtime.setAuth).toHaveBeenLastCalledWith("token-B");expect(x.db.channel).toHaveBeenCalledTimes(1);expect(x.db.removeChannel).not.toHaveBeenCalled();off();await flush();
 });
 it("coalesces rapid INITIAL_SESSION, SIGNED_IN, refresh and visibility",async()=>{
  const x=setup(),off=x.subscribe("A",vi.fn());x.emit("INITIAL_SESSION",session());x.emit("SIGNED_IN",session());x.emit("TOKEN_REFRESHED",session());window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange"));await flush();expect(x.db.channel).toHaveBeenCalledTimes(1);expect(x.channels[0].on).toHaveBeenCalledTimes(4);off();await flush();
 });
 it("signout while auth is pending cannot create an old channel",async()=>{
  const x=setup(),auth=deferred<void>();x.db.realtime.setAuth.mockReturnValueOnce(auth.promise);const off=x.subscribe("A",vi.fn());await flush();x.emit("SIGNED_OUT",null);auth.resolve();await flush();expect(x.db.channel).not.toHaveBeenCalled();off();await flush();
 });
 it("waits for complete A removal before B auth and join",async()=>{
  const x=setup(),refresh=vi.fn();const offA=x.subscribe("A",refresh);await flush();const removal=deferred<string>();x.db.removeChannel.mockReturnValueOnce(removal.promise);x.emit("SIGNED_OUT",null);offA();x.emit("SIGNED_IN",session("B","token-B"));const offB=x.subscribe("B",vi.fn());await flush();expect(x.db.channel).toHaveBeenCalledTimes(1);expect(x.db.realtime.setAuth).not.toHaveBeenCalledWith("token-B");x.channels[0].on.mock.calls[0][2]();expect(refresh).not.toHaveBeenCalled();removal.resolve("ok");await flush();expect(x.db.channel).toHaveBeenLastCalledWith("notification-inbox:B");offB();await flush();
 });
 it("auth failure never joins anonymously and retries on later auth event",async()=>{
  const x=setup();x.db.realtime.setAuth.mockRejectedValueOnce(Error("private failure"));const off=x.subscribe("A",vi.fn());await flush();expect(x.db.channel).not.toHaveBeenCalled();x.emit("SIGNED_IN",session());await flush();expect(x.db.channel).toHaveBeenCalledTimes(1);off();await flush();
 });
 it.each(["CHANNEL_ERROR","TIMED_OUT","CLOSED"])("%s retires without a retry storm and allows focus retry",async status=>{
  const x=setup(),off=x.subscribe("A",vi.fn());await flush();x.channels[0].subscribe.mock.calls[0][0](status);await flush();expect(x.db.removeChannel).toHaveBeenCalledTimes(1);expect(x.db.channel).toHaveBeenCalledTimes(1);window.dispatchEvent(new Event("focus"));await flush();expect(x.db.channel).toHaveBeenCalledTimes(2);off();await flush();
 });
 it("refresh auth failure removes the stale channel; later valid auth recovers",async()=>{
  const x=setup(),off=x.subscribe("A",vi.fn());await flush();
  x.db.realtime.setAuth.mockRejectedValueOnce(Error("auth failure"));x.emit("TOKEN_REFRESHED",session("A","token-B"));await flush();
  expect(x.db.removeChannel).toHaveBeenCalledTimes(1);expect(x.db.channel).toHaveBeenCalledTimes(1);
  x.emit("TOKEN_REFRESHED",session("A","token-C"));await flush();expect(x.db.channel).toHaveBeenCalledTimes(2);
  x.channels[0].subscribe.mock.calls[0][0]("CLOSED");await flush();expect(x.db.removeChannel).toHaveBeenCalledTimes(1);
  off();await flush();
 });
 it("signout during session lookup suppresses stale session resolution",async()=>{
  const x=setup(),lookup=deferred<{data:{session:Session},error:null}>();x.db.auth.getSession.mockReturnValueOnce(lookup.promise);
  const off=x.subscribe("A",vi.fn());await flush();x.emit("SIGNED_OUT",null);lookup.resolve({data:{session:session()},error:null});await flush();
  expect(x.db.realtime.setAuth).not.toHaveBeenCalled();expect(x.db.channel).not.toHaveBeenCalled();off();await flush();
 });
 it("uncertain removal blocks any new owner",async()=>{
  const x=setup(),off=x.subscribe("A",vi.fn());await flush();x.db.removeChannel.mockResolvedValueOnce("timed out");off();x.emit("SIGNED_IN",session("B"));const stop=x.subscribe("B",vi.fn());await flush();expect(x.db.channel).toHaveBeenCalledTimes(1);stop();await flush();
 });
});

it("installed SDK sends its first postgres join only with authenticated token", async()=>{
 const sent: {event:string;payload:{access_token?:string}}[]=[];
 class Socket {
  readyState=0; onopen?:()=>void;
  constructor(){setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
  send(value:string){sent.push(JSON.parse(value));}
  close(){this.readyState=3;}
 }
 const sdk=new RealtimeClient("wss://local.invalid/realtime/v1",{params:{apikey:"public-test-placeholder"},transport:Socket as unknown as typeof WebSocket,accessToken:async()=>"token-A"});
 const x=setup(),lookup=deferred<{data:{session:Session},error:null}>(),gate=deferred<void>();
 x.db.auth.getSession.mockReturnValueOnce(lookup.promise);
 const original=sdk.setAuth.bind(sdk);
 vi.spyOn(sdk,"setAuth").mockImplementation(async(token)=>{await gate.promise;await original(token);});
 const client={auth:x.db.auth,realtime:sdk,channel:sdk.channel.bind(sdk),removeChannel:sdk.removeChannel.bind(sdk)} as unknown as SupabaseClient;
 const off=createNotificationRealtime(client)("A",vi.fn());
 try {
  await flush();expect(sent).toEqual([]);
  lookup.resolve({data:{session:session()},error:null});await flush();expect(sent).toEqual([]);
  gate.resolve();await vi.waitFor(()=>expect(sent.filter(p=>p.event==="phx_join")).toHaveLength(1));
  expect(sent.find(p=>p.event==="phx_join")?.payload.access_token).toBe("token-A");
 } finally {off();sdk.disconnect();}
});
