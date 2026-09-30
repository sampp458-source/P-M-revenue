import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationRepository } from "./notificationRepository";
const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: db }));
beforeEach(() => vi.clearAllMocks());
function query(data: unknown, error: unknown = null) {
  const q = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve) };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.order.mockReturnValue(q); q.range.mockReturnValue(q);
  db.from.mockReturnValue(q); return q;
}
describe("existing RLS read paths", () => {
  it("loads canonical USER audience, never inferred from receipt names or counts", async () => {
    const q = query([{ target_kind: "USER", target_user_id: "u2" }]);
    expect(await notificationRepository.audience("a1")).toEqual({ targetKind: "USER", userIds: ["u2"] });
    expect(db.from).toHaveBeenCalledWith("announcement_targets");
    expect(q.eq).toHaveBeenCalledWith("announcement_id", "a1");
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("preserves ALL as ALL, not a snapshot recipient list", async () => {
    query([{ target_kind: "ALL", target_user_id: null }]);
    expect(await notificationRepository.audience("a1")).toEqual({ targetKind: "ALL", userIds: [] });
  });
  it.each([[], [{ target_kind: "ALL", target_user_id: "u2" }], [{ target_kind: "USER", target_user_id: null }], [{ target_kind: "USER", target_user_id: "u2" }, { target_kind: "ALL", target_user_id: null }]].map(data => ({ data })))("fails closed on absent or inconsistent audience $data", async ({ data }) => {
    query(data); await expect(notificationRepository.audience("a1")).rejects.toThrow();
  });
  it("does not fall back after RLS/network read failure", async () => {
    query(null, { code: "42501" }); await expect(notificationRepository.audience("a1")).rejects.toThrow();
  });
  it("receipt-only list stays own-author scoped and uses existing receipt RPC", async () => {
    const q = query([{ id: "a1", title: "공지" }]);
    db.rpc.mockResolvedValue({ data: [{ read_at: "now", acknowledged_at: "now" }], error: null });
    const result = await notificationRepository.sentForReceiptViewer("u1", 50);
    expect(q.eq).toHaveBeenCalledWith("author_id", "u1");
    expect(q.range).toHaveBeenCalledWith(50, 99);
    expect(q.select.mock.calls[0][0]).not.toContain("request_payload");
    expect(db.rpc).toHaveBeenCalledWith("get_announcement_receipts_v1", { p_announcement_id: "a1" });
    expect(result[0].stats).toEqual({ total: 1, read: 1, ack: 1, unack: 0 });
  });
  it("does not label failed receipts as zero", async () => {
    query([{ id: "a1" }]); db.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(notificationRepository.sentForReceiptViewer("u1")).rejects.toThrow();
  });
});
