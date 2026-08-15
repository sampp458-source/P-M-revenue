import { describe, expect, it } from "vitest";
import {
  getModuleFromPath,
  isSafeModulePath,
  resolveModuleDestination,
  safePendingReturnTo,
} from "./moduleState";

describe("P&M OS module routing", () => {
  it("Finance, Operations, Journal, Module Gate 경로를 구분한다", () => {
    expect(getModuleFromPath("/dashboard")).toBe("finance");
    expect(getModuleFromPath("/sales/sale-1/edit")).toBe("finance");
    expect(getModuleFromPath("/operations/calendar")).toBe("operations");
    expect(getModuleFromPath("/operations/journal")).toBe("journal");
    expect(getModuleFromPath("/journal/today")).toBe("journal");
    expect(getModuleFromPath("/select-module")).toBe("gate");
    expect(getModuleFromPath("/unknown")).toBeNull();
  });

  it("모듈별 허용 경로와 query를 보존하고 외부·잘못된 경로를 거부한다", () => {
    expect(isSafeModulePath("/sales?detail=sale-1", "finance")).toBe(true);
    expect(
      isSafeModulePath("/operations/calendar?day=2026-07-28", "operations"),
    ).toBe(true);
    expect(isSafeModulePath("/operations/schedules", "operations")).toBe(true);
    expect(isSafeModulePath("/operations/hotel", "operations")).toBe(true);
    expect(
      isSafeModulePath(
        "/operations/customers?dogId=dog-1",
        "operations",
      ),
    ).toBe(true);
    expect(isSafeModulePath("/operations/staff", "operations")).toBe(true);
    expect(isSafeModulePath("/operations/journal", "operations")).toBe(false);
    expect(isSafeModulePath("/operations/journal", "journal")).toBe(true);
    expect(isSafeModulePath("/journal/today?day=2026-08-15", "journal")).toBe(true);
    expect(isSafeModulePath("/journal/history", "journal")).toBe(false);
    expect(isSafeModulePath("/operations/unknown", "operations")).toBe(false);
    expect(isSafeModulePath("https://example.com", "finance")).toBe(false);
    expect(safePendingReturnTo("//example.com")).toBeNull();
  });

  it("같은 모듈 pending 경로를 우선하고 다른 모듈이면 마지막 안전 경로를 사용한다", () => {
    expect(
      resolveModuleDestination({
        target: "finance",
        pendingReturnTo: "/sales?detail=sale-1",
        lastFinancePath: "/reports",
      }),
    ).toBe("/sales?detail=sale-1");
    expect(
      resolveModuleDestination({
        target: "operations",
        pendingReturnTo: "/reports",
        lastOperationsPath: "/operations/calendar",
      }),
    ).toBe("/operations/calendar");
    expect(
      resolveModuleDestination({
        target: "journal",
        pendingReturnTo: "/journal/today?day=2026-08-15",
        lastJournalPath: "/journal/today",
      }),
    ).toBe("/journal/today?day=2026-08-15");
  });

  it("저장 경로가 없거나 안전하지 않으면 모듈 홈으로 이동한다", () => {
    expect(resolveModuleDestination({ target: "finance" })).toBe("/dashboard");
    expect(
      resolveModuleDestination({
        target: "operations",
        lastOperationsPath: "/operations/not-found",
      }),
    ).toBe("/operations/today");
    expect(resolveModuleDestination({ target: "journal" })).toBe(
      "/journal/today",
    );
    expect(
      resolveModuleDestination({
        target: "operations",
        lastOperationsPath: "/operations/journal",
      }),
    ).toBe("/operations/today");
  });
});
