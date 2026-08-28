import { describe, expect, it } from "vitest";
import { JOURNAL_BINARY_OPTION_GEOMETRY } from "./journalCanvasRenderer";
import { JOURNAL_TEACHER_COMMENT_FIXED_TYPOGRAPHY, journalCommentTypography, journalTeacherCommentDogSlot } from "./journalReportScene";

describe("Journal report scene contracts", () => {
  it("allocates natural-width O/X labels without circle overlap", () => {
    const geometry = JOURNAL_BINARY_OPTION_GEOMETRY;
    const cellWidth = (geometry.areaWidth - geometry.columnGap) / 2;
    const circleRight = geometry.markCenterOffset + geometry.circleDiameter / 2;
    expect(cellWidth).toBe(49);
    expect(geometry.labelOffset - circleRight).toBeGreaterThanOrEqual(6);
    expect(cellWidth - geometry.labelOffset).toBeGreaterThanOrEqual(19);
    expect(geometry.labelFontSize).toBe(18);
    expect(geometry.selectedWeight).toBe(900);
  });

  it.each([1, 65, 182, 320, 420, 500])("keeps Teacher Comment typography fixed at %i characters", (length) => {
    expect(journalCommentTypography(length)).toEqual(JOURNAL_TEACHER_COMMENT_FIXED_TYPOGRAPHY);
  });

  it("keeps the verified fixed text and decorative-dog geometry", () => {
    expect(JOURNAL_TEACHER_COMMENT_FIXED_TYPOGRAPHY).toEqual({
      density: "fixed", size: 20, lineHeight: 1.36, textWidth: 724, availableHeight: 290,
    });
    expect(JOURNAL_TEACHER_COMMENT_FIXED_TYPOGRAPHY.textWidth).toBe(724);
    expect(journalTeacherCommentDogSlot(1)).toEqual({ x: 865, y: 1213, width: 158, height: 174 });
    expect(journalTeacherCommentDogSlot(500)).toEqual(journalTeacherCommentDogSlot(1));
  });
});
