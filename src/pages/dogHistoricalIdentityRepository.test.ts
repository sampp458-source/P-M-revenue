import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: db }));
import { fetchHistoricalDogIdentities, previewDogProfileRemoval } from "./dogHistoricalIdentityRepository";
import { fetchOperationSchedulesForRange, fetchLegacyHotelScheduleCandidates, fetchOperationScheduleOptions, type OperationSchedule, type OperationScheduleOptions } from "./operationsScheduleRepository";
vi.mock("./operationsSettingsRepository", () => ({ fetchOperationSettings: async () => ({ calendars: [], scheduleTypes: [] }) }));
const identity = { recordDogId: "inactive", displayName: "과거 반려견", profileStatus: "inactive", nameSource: "dog_master", canonicalDogId: null, profileReadable: true, customerId: "customer", breed: null, sex: null };
const options: OperationScheduleOptions = { calendars: [], scheduleTypes: [], assignees: [], dogs: [], customers: [] };
beforeEach(() => { db.rpc.mockReset(); db.from.mockReset(); });

describe("historical dog identity read", () => {
  it("batches distinct IDs once, retains inactive identity, and performs no table write", async () => {
    db.rpc.mockResolvedValue({ data: [identity], error: null });
    expect(await fetchHistoricalDogIdentities(["inactive", "inactive"])).toEqual([identity]);
    expect(db.rpc.mock.calls).toEqual([["get_historical_dog_identities", { p_dog_ids: ["inactive"] }]]);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("empty batch has no RPC", async () => {
    expect(await fetchHistoricalDogIdentities([])).toEqual([]);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([{ data: null, error: { code: "42501" } }, { data: [], error: null }, { data: [identity, identity], error: null }])("fails visibly rather than silently hiding a referenced dog", async (response) => {
    db.rpc.mockResolvedValue(response);
    await expect(fetchHistoricalDogIdentities(["inactive"])).rejects.toThrow();
  });
  it("read preview never invokes deletion and rejects a write-capable response", async () => {
    const preview = { dog: { recordDogId: "inactive" }, version: null, commandAvailable: false, contractVersion: "dog-profile-preview-v2a-1" };
    db.rpc.mockResolvedValue({ data: preview, error: null });
    expect(await previewDogProfileRemoval("inactive")).toEqual(preview);
    expect(db.rpc.mock.calls).toEqual([["preview_dog_profile_removal", { p_dog_id: "inactive" }]]);
    expect(db.from).not.toHaveBeenCalled();
    db.rpc.mockResolvedValue({ data: { ...preview, commandAvailable: true }, error: null });
    await expect(previewDogProfileRemoval("inactive")).rejects.toThrow();
  });
});

function setupCalendar() {
  const rows = ["one", "two"].map((id) => ({ id, calendar_id: "calendar", schedule_type_id: "type", title: id,
    created_at: "2026-09-01T00:00:00Z", status: "completed", starts_at: "2026-09-01T00:00:00Z", ends_at: "2026-09-01T01:00:00Z", archived_at: null }));
  const links = rows.map((row) => ({ schedule_id: row.id, dog_id: "inactive" }));
  db.from.mockImplementation((table) => {
    const result = { data: table === "operation_schedules" ? rows : table === "operation_schedule_dogs" ? links : [], error: null };
    const query = Object.assign(Promise.resolve(result), Object.fromEntries(["select", "in", "is", "lt", "gt", "order", "eq", "limit"].map((name) => [name, vi.fn(() => query)])));
    return query;
  });
  db.rpc.mockImplementation(async (name) => ({ data: name === "get_historical_dog_identities" ? [identity] : [], error: null }));
  return rows;
}

describe("Calendar historical adapter", () => {
  it("keeps inactive dogs without active selector options and deduplicates lookup across schedules", async () => {
    const rows = setupCalendar();
    const result = await fetchOperationSchedulesForRange("2026-09-01", "2026-09-02", options);
    expect(result.map((row) => row.dogs[0])).toEqual(rows.map(() => ({ id: "inactive", name: "과거 반려견", customerId: "customer", breed: null, sex: null })));
    expect(result.map((row) => [row.id, row.status, row.startsAt, row.endsAt])).toEqual(rows.map((row) => [row.id, row.status, row.starts_at, row.ends_at]));
    expect(db.rpc.mock.calls.filter(([name]) => name === "get_historical_dog_identities")).toHaveLength(1);
    expect(options.dogs).toEqual([]);
  });
  it("legacy schedule mapping also uses historical identities, not active options", async () => {
    setupCalendar();
    await fetchLegacyHotelScheduleCandidates({ calendarId: "calendar" } as OperationSchedule, options);
    expect(db.rpc.mock.calls.filter(([name]) => name === "get_historical_dog_identities")).toEqual([["get_historical_dog_identities", { p_dog_ids: ["inactive"] }]]);
  });
  it("new schedule options still require active dogs and never call historical RPC", async () => {
    const eq = vi.fn();
    db.from.mockImplementation(() => {
      const query = { select: () => query, eq: (...args: unknown[]) => { eq(...args); return query; }, order: async () => ({ data: [], error: null }) };
      return query;
    });
    db.rpc.mockResolvedValue({ data: [], error: null });
    const result = await fetchOperationScheduleOptions();
    expect(result.dogs).toEqual([]);
    expect(eq).toHaveBeenCalledWith("is_active", true);
    expect(db.rpc.mock.calls.some(([name]) => name === "get_historical_dog_identities")).toBe(false);
  });
});
