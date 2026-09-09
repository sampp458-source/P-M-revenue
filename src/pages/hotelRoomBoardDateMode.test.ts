import { afterEach, describe, expect, it, vi } from "vitest";
import { hotelRoomBoardDateMode } from "./hotelRoomBoardDateMode";
afterEach(() => { vi.useRealTimers(); });
describe("hotel board application timezone date mode", () => {
  it.each([["2032-01-01", "PAST"], ["2032-01-02", "TODAY"], ["2032-01-03", "FUTURE"]] as const)("classifies %s", (date, mode) => {
    expect(hotelRoomBoardDateMode(date, "2032-01-02")).toBe(mode);
  });
  it("uses the existing Seoul date at a UTC day boundary", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2032-01-01T15:01:00Z"));
    expect(hotelRoomBoardDateMode("2032-01-02")).toBe("TODAY");
    expect(hotelRoomBoardDateMode("2032-01-01")).toBe("PAST");
  });
});
