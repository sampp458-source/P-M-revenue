import { describe, expect, it } from "vitest";
import { JOURNAL_BINARY_OPTION_GEOMETRY } from "./journalCanvasRenderer";
import { journalCommentTypography } from "./journalReportScene";

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

  it.each([[119, 120, 121], [219, 220, 221], [319, 320, 321], [419, 420, 421]])(
    "keeps typography transitions smooth around %i/%i/%i characters",
    (before, boundary, after) => {
      const values = [before, boundary, after].map((length) => journalCommentTypography(length).size);
      expect(values[0]).toBeGreaterThanOrEqual(values[1]);
      expect(values[1]).toBeGreaterThanOrEqual(values[2]);
      expect(Math.abs(values[0] - values[1])).toBeLessThanOrEqual(0.3);
      expect(Math.abs(values[1] - values[2])).toBeLessThanOrEqual(0.3);
    },
  );

  it("keeps the 500-character minimum-safe contract", () => {
    expect(journalCommentTypography(500)).toMatchObject({ density: "minimum-safe", size: 19, lineHeight: 1.32 });
  });
});
