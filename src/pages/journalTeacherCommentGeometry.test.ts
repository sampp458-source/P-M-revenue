// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { measureJournalTeacherCommentGeometry } from "./journalTeacherCommentGeometry";
import { JOURNAL_REPORT_FONT_FAMILY } from "./journalReportScene";

describe("Journal Teacher Comment current-content geometry", () => {
  it("keeps the approved 20px ordinary content inside the 290px safe area", () => {
    const result = measureJournalTeacherCommentGeometry("오늘도 즐겁게 지냈어요.\n친구들과 사이좋게 놀았습니다.", JOURNAL_REPORT_FONT_FAMILY, 20);
    expect(result).toMatchObject({ available: true, overflow: false, dogCollision: false, recommendedSize: 20 });
  });

  it("detects current-content overflow and recommends a smaller approved size", () => {
    const result = measureJournalTeacherCommentGeometry("가".repeat(320), JOURNAL_REPORT_FONT_FAMILY, 24);
    expect(result.available).toBe(true);
    expect(result.overflow).toBe(true);
    expect(result.dogCollision).toBe(true);
    expect(result.recommendedSize).toBe(22);
  });

  it.each([
    [65, 24, false, 24],
    [320, 22, false, 22],
    [320, 24, true, 22],
    [420, 18, false, 18],
    [420, 20, true, 18],
    [500, 18, true, null],
    [500, 20, true, null],
  ] as const)("classifies %i Korean characters at %ipx", (length, size, overflow, recommendedSize) => {
    const result = measureJournalTeacherCommentGeometry("가".repeat(length), JOURNAL_REPORT_FONT_FAMILY, size);
    expect(result).toMatchObject({ available: true, overflow, recommendedSize });
  });

  it("normalizes CRLF before line geometry", () => {
    const crlf = measureJournalTeacherCommentGeometry("첫 줄\r\n둘째 줄", JOURNAL_REPORT_FONT_FAMILY, 20);
    const lf = measureJournalTeacherCommentGeometry("첫 줄\n둘째 줄", JOURNAL_REPORT_FONT_FAMILY, 20);
    expect(crlf.lineCount).toBe(lf.lineCount);
  });
});
