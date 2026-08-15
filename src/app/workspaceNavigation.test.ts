import { describe, expect, it } from "vitest";
import { journalMenus, workspaceOptions } from "./workspaceNavigation";

describe("P&M OS workspace navigation", () => {
  it("홈과 workspace switcher의 canonical 3개 업무 영역을 고정한다", () => {
    expect(workspaceOptions.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "operations", title: "스케줄 관리" },
      { id: "finance", title: "매출 관리" },
      { id: "journal", title: "일지 관리" },
    ]);
  });

  it("Journal workspace는 현재 오늘의 일지만 노출한다", () => {
    expect(journalMenus.map(({ to, label }) => ({ to, label }))).toEqual([
      { to: "/journal/today", label: "오늘의 일지" },
    ]);
  });
});
