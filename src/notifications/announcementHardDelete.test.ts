import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationRepository, NotificationFailure } from "./notificationRepository";
const db = vi.hoisted(() => ({ rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: db }));
beforeEach(() => vi.clearAllMocks());
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
  it("subscribes only to recipient-filtered INSERT/UPDATE and reconnect", () => {
    const c={ on:vi.fn(),subscribe:vi.fn() };c.on.mockReturnValue(c);c.subscribe.mockReturnValue(c);db.channel.mockReturnValue(c);
    const refresh=vi.fn();const off=notificationRepository.subscribe("u1",refresh);
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
    off();expect(db.removeChannel).toHaveBeenCalledWith(c);
  });
  it("models recipient filter routing: another recipient never invokes this callback", () => {
    const bindings: { filter: { event: string; table: string; filter: string }; callback: () => void }[]=[];
    db.channel.mockImplementation(() => {
      const c={on:vi.fn((_kind,filter,callback)=>{bindings.push({filter,callback});return c;}),subscribe:vi.fn()};
      c.subscribe.mockReturnValue(c);return c;
    });
    const a=vi.fn(),b=vi.fn();notificationRepository.subscribe("A",a);notificationRepository.subscribe("B",b);
    // Subscription-contract test only; real service RLS delivery is separately audited.
    for(const binding of bindings) if(binding.filter.table==="notification_inbox_revisions" && binding.filter.event==="UPDATE" && binding.filter.filter==="recipient_id=eq.A") binding.callback();
    expect(a).toHaveBeenCalledTimes(1);expect(b).not.toHaveBeenCalled();
    expect(bindings.every(binding=>["INSERT","UPDATE"].includes(binding.filter.event))).toBe(true);
  });

});
