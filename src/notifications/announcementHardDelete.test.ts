// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationRepository, NotificationFailure } from "./notificationRepository";
const db = vi.hoisted(() => ({ rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn().mockResolvedValue("ok"), realtime: { setAuth: vi.fn().mockResolvedValue(undefined) }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) } }));
vi.mock("../lib/supabase", () => ({ supabase: db }));
beforeEach(() => { vi.clearAllMocks(); db.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" }, access_token: "test", expires_at: Date.now()/1000+3600 } }, error: null }); });
const settle = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
describe("hard delete transport and invalidation", () => {
  it("uses only the author-protected RPC, never direct table deletion", async () => {
    db.rpc.mockResolvedValue({ data: null, error: null });
    await notificationRepository.deleteAnnouncement("a1");
    expect(db.rpc).toHaveBeenCalledTimes(1); expect(db.rpc).toHaveBeenCalledWith("delete_announcement_v1", { p_announcement_id: "a1" });
  });
  it.each(["ANNOUNCEMENT_REQUEST_DELETED", "ANNOUNCEMENT_NOT_FOUND"])("maps %s to a definite terminal failure", async message => {
    db.rpc.mockResolvedValue({ data: null, error: { code: message.endsWith("DELETED") ? "P0001" : "P0002", message } });
    await expect(notificationRepository.deleteAnnouncement("a1")).rejects.toMatchObject({ definite: true });
    await expect(notificationRepository.deleteAnnouncement("a1")).rejects.toBeInstanceOf(NotificationFailure);
  });
  it("subscribes only to recipient-filtered INSERT/UPDATE and reconnect", async () => {
    const c={ on:vi.fn(),subscribe:vi.fn() };c.on.mockReturnValue(c);c.subscribe.mockReturnValue(c);db.channel.mockReturnValue(c);
    const refresh=vi.fn();const off=notificationRepository.subscribe("u1",refresh);await settle();
    expect(c.on.mock.calls.map(call=>call[1])).toEqual([
      {event:"INSERT",schema:"public",table:"notifications",filter:"recipient_id=eq.u1"},
      {event:"UPDATE",schema:"public",table:"notifications",filter:"recipient_id=eq.u1"},
      {event:"INSERT",schema:"public",table:"notification_inbox_revisions",filter:"recipient_id=eq.u1"},
      {event:"UPDATE",schema:"public",table:"notification_inbox_revisions",filter:"recipient_id=eq.u1"},
    ]);
    c.on.mock.calls[1][2]({new:{recipient_id:"u1"}});expect(refresh).toHaveBeenCalledTimes(1);
    c.on.mock.calls[2][2]({new:{recipient_id:"u1",revision:1}});
    c.on.mock.calls[3][2]({new:{recipient_id:"u1",revision:2}});
    expect(refresh).toHaveBeenCalledTimes(3);
    c.subscribe.mock.calls[0][0]("SUBSCRIBED");expect(refresh).toHaveBeenCalledTimes(4);
    off();await settle();expect(db.removeChannel).toHaveBeenCalledWith(c);
  });
  it("removes A before B and suppresses callbacks from A", async () => {
    const bindings: { filter: { table: string; filter: string }; callback: () => void }[]=[];
    db.channel.mockImplementation(() => {
      const c={on:vi.fn((_kind,filter,callback)=>{bindings.push({filter,callback});return c;}),subscribe:vi.fn()};
      c.subscribe.mockReturnValue(c);return c;
    });
    const setUser=(id:string)=>db.auth.getSession.mockResolvedValue({data:{session:{user:{id},access_token:id,expires_at:Date.now()/1000+3600}},error:null});
    const a=vi.fn(),b=vi.fn();setUser("A");const offA=notificationRepository.subscribe("A",a);await settle();
    setUser("B");const offB=notificationRepository.subscribe("B",b);await settle();
    for(const binding of bindings) binding.callback();
    expect(a).not.toHaveBeenCalled();expect(b).toHaveBeenCalledTimes(4);
    expect(db.removeChannel).toHaveBeenCalledTimes(1);offA();offB();await settle();
  });
});
