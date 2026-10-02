import { describe, expect, it, vi } from "vitest";
import { announcementExpiryError, announcementExpiryLocal, announcementExpiryMin, announcementExpiryUtc } from "./announcementExpiry";
import { notificationRepository } from "./notificationRepository";
const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: db }));
describe("Seoul expiry boundaries", () => {
  it.each([
    ["2026-10-01T14:59:00Z", "2026-10-01T23:59"],
    ["2026-10-01T15:00:00Z", "2026-10-02T00:00"],
    ["2026-09-30T15:30:00Z", "2026-10-01T00:30"],
  ])("roundtrips %s as KST %s", (utc, local) => {
    expect(announcementExpiryLocal(utc)).toBe(local);
    expect(announcementExpiryUtc(local, 0)).toBe(new Date(utc).toISOString());
  });
  it("min crosses midnight without using UTC calendar date", () => {
    expect(announcementExpiryMin(Date.parse("2026-10-01T14:59:30Z"))).toBe("2026-10-02T00:00");
  });
  it.each(["bad", "2026-02-30T12:30", "2026-10-01T25:30"])("rejects invalid input %s", value => {
    expect(() => announcementExpiryUtc(value, 0)).toThrow(announcementExpiryError);
  });
});
describe("publish server mapping", () => {
  const payload = { requestId: "test", title: "test", body: "test", priority: "NORMAL" as const, ackRequired: false, targetKind: "ALL" as const, userIds: [], expiresAt: null };
  it("maps only the exact publish INVALID_EXPIRY contract to a definite Korean error", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "INVALID_EXPIRY" } });
    await expect(notificationRepository.publish(payload)).rejects.toMatchObject({ message: announcementExpiryError, definite: true });
  });
  it.each([
    { code: "22023", message: "INVALID_TARGET" },
    { code: "42501", message: "INVALID_EXPIRY" },
    { code: "500", message: "network" },
  ])("does not mislabel unrelated failure $code/$message", async error => {
    db.rpc.mockResolvedValue({ data: null, error });
    await expect(notificationRepository.publish(payload)).rejects.not.toMatchObject({ message: announcementExpiryError });
  });
  it("classifies exact 21000 as definite rejection without expiry wording", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: "21000", message: "UPDATE requires a WHERE clause" } });
    await expect(notificationRepository.publish(payload)).rejects.toMatchObject({
      definite: true, message: "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
  });
  it.each(["", "500", "400", "AbortError"])("preserves uncertain transport failure %s", async code => {
    db.rpc.mockResolvedValue({ data: null, error: { code, message: "Failed to fetch" }, status: 0 });
    await expect(notificationRepository.publish(payload)).rejects.toMatchObject({ definite: false });
  });

});
