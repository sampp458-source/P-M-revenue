// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { inspectJournalExportPresentation, journalExportOverflowMessage } from "./journalExportReadiness";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

const viewModel = (teacherComment: string): JournalPreviewViewModel => ({
  entryId: "entry-1",
  dogName: "감자",
  businessDate: "2026-08-30",
  displayDate: "2026. 08. 30.",
  customerName: null,
  status: "COMPLETED",
  conditionOptions: [],
  urinationOptions: [],
  defecationOptions: [],
  stoolOptions: [],
  mealOptions: [],
  teacherRelationshipOptions: [],
  friendRelationshipOptions: [],
  bestFriendTargets: [],
  manners: { title: "예절교육", activityName: "", options: [] },
  physical: { title: "체육", activityName: "", options: [] },
  teacherComment,
});

describe("journal export presentation readiness", () => {
  it("returns no issue for a safe comment", () => {
    expect(inspectJournalExportPresentation({
      ordinal: 1,
      entryId: "entry-1",
      dogId: "dog-1",
      viewModel: viewModel("오늘도 즐겁게 지냈어요."),
      presentation: { fontFamily: "Pretendard, sans-serif", fontSize: 20, source: "DEFAULT", fontFingerprint: "DEFAULT" },
    })).toBeNull();
  });

  it("reports exact non-content geometry and the largest safe size", () => {
    const issue = inspectJournalExportPresentation({
      ordinal: 2,
      entryId: "entry-2",
      dogId: "dog-2",
      viewModel: viewModel("가".repeat(420)),
      presentation: { fontFamily: "Pretendard, sans-serif", fontSize: 20, source: "SYSTEM", fontFingerprint: "pnm-journal-system-font-safe" },
    });
    expect(issue).toMatchObject({
      ordinal: 2,
      entryId: "entry-2",
      dogId: "dog-2",
      dogName: "감자",
      fontSource: "SYSTEM",
      fontFingerprint: "pnm-journal-system-font-safe",
      fontSize: 20,
      commentLength: 420,
      measuredLines: 11,
      maxLines: 10,
      availableHeight: 290,
      overflowAmount: 10,
      recommendedSize: 18,
    });
    expect(issue?.requiredHeight).toBeCloseTo(299.2);
    expect(journalExportOverflowMessage(issue!)).toBe("18px로 줄이면 이미지를 저장할 수 있습니다.");
  });

  it("does not invent a recommendation when 18px also overflows", () => {
    const issue = inspectJournalExportPresentation({
      ordinal: 1,
      entryId: "entry-1",
      dogId: "dog-1",
      viewModel: viewModel("가".repeat(500)),
      presentation: { fontFamily: "Pretendard, sans-serif", fontSize: 20, source: "FILE", fontFingerprint: "font-file-1" },
    });
    expect(issue?.recommendedSize).toBeNull();
    expect(journalExportOverflowMessage(issue!)).toContain("18px에서도 영역을 초과합니다");
  });
});
