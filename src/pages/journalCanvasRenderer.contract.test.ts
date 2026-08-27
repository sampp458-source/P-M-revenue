// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildJournalReportScene,
  JOURNAL_REPORT_ASSET_SLOTS,
  JOURNAL_REPORT_HEIGHT,
  JOURNAL_REPORT_LAYOUT,
  JOURNAL_REPORT_TYPOGRAPHY,
  JOURNAL_REPORT_VISUAL_REGIONS,
  JOURNAL_REQUIRED_VISUAL_ELEMENT_IDS,
  JOURNAL_REPORT_WIDTH,
  journalActivityFontSize,
  journalBestFriendFontSize,
  journalCommentTypography,
  journalDogNameFontSize,
  journalTeacherCommentDogSlot,
} from "./journalReportScene";
import { JOURNAL_REQUIRED_TEXT_LANDMARK_IDS } from "./journalCanvasRenderer";
import { JOURNAL_REQUIRED_ASSET_IDS } from "./journalRenderContract";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

const model = { entryId: "entry", dogName: "가을", businessDate: "2026-08-26" } as JournalPreviewViewModel;

describe("Journal Canvas renderer contract", () => {
  it("builds one exact 1080×1440 typed scene shared by preview geometry and export", () => {
    const scene = buildJournalReportScene(model);
    expect(scene).toMatchObject({ width: 1080, height: 1440, viewModel: model });
    expect(JOURNAL_REPORT_WIDTH).toBe(1080);
    expect(JOURNAL_REPORT_HEIGHT).toBe(1440);
    expect(JOURNAL_REPORT_LAYOUT).toMatchObject({
      header: { x: 46, y: 46, width: 988, height: 235 },
      comment: { x: 46, y: 1003, width: 988, height: 391 },
    });
  });

  it("has one explicit Canvas slot for every approved illustration", () => {
    expect(JOURNAL_REQUIRED_ASSET_IDS.every((id) => id in JOURNAL_REPORT_ASSET_SLOTS)).toBe(true);
    expect(JOURNAL_REQUIRED_ASSET_IDS).toHaveLength(7);
  });

  it("fails visual completeness when any required DOM decoration is omitted", () => {
    expect(JOURNAL_REQUIRED_VISUAL_ELEMENT_IDS).toEqual(expect.arrayContaining([
      "official-logo",
      "header-underline",
      "condition-icon",
      "toilet-icon",
      "meal-icon",
      "relationship-icon",
      "manners-icon",
      "physical-icon",
      "comment-icon",
      "comment-quote",
      "best-friend-blue-underline",
      "best-friend-pink-accent",
      "selected-option-marks",
    ]));
    expect(Object.keys(JOURNAL_REPORT_VISUAL_REGIONS)).toHaveLength(JOURNAL_REQUIRED_VISUAL_ELEMENT_IDS.length);
  });

  it("shares the exact DOM typography metrics instead of using generic Canvas baselines", () => {
    expect(JOURNAL_REPORT_TYPOGRAPHY).toMatchObject({
      heading: { size: 26, weight: 900, lineHeight: 36, letterSpacing: -0.65 },
      compactOption: { size: 19, selectedWeight: 900, lineHeight: 21.66 },
      option: { size: 22, selectedWeight: 900, lineHeight: 25.08 },
      commentHeading: { size: 27, weight: 900, lineHeight: 40 },
    });
    expect(JOURNAL_REQUIRED_TEXT_LANDMARK_IDS).toHaveLength(16);
    expect(JOURNAL_REQUIRED_TEXT_LANDMARK_IDS).toEqual(expect.arrayContaining(["header-title", "best-friend-name", "comment-first-line"]));
  });

  it("shares canonical long-name, activity, and 500-character comment density thresholds", () => {
    expect(journalDogNameFontSize(21)).toBe(17);
    expect(journalBestFriendFontSize(19)).toBe(22);
    expect(journalActivityFontSize(51)).toBe(17);
    expect(journalCommentTypography(500)).toEqual({ density: "minimum-safe", size: 19, lineHeight: 1.32 });
    expect(journalTeacherCommentDogSlot(500)).toEqual({ x: 951, y: 1307, width: 72, height: 80 });
    expect(journalTeacherCommentDogSlot(20)).toEqual({ x: 865, y: 1213, width: 158, height: 174 });
  });

  it("contains no DOM rasterization, SVG foreignObject, or offscreen export renderer path", () => {
    const sources = [
      "journalExport.ts",
      "journalCanvasRenderer.ts",
      "JournalEditor.tsx",
      "JournalHome.tsx",
    ].map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
    expect(sources).not.toMatch(/html-to-image|foreignObject|cloneNode\(|journal-canonical-export-source|journal-export-template|journal-batch-export-template/);
    expect(sources).toContain("renderJournalReportToCanvas");
    expect(sources).toContain("renderJournalImageBlob(viewModel, \"png\",");
    expect(sources).toContain("actualBoundingBoxAscent");
    expect(sources).toContain("JOURNAL_EXPORT_ENCODED_VISUAL_MISSING");
  });
});
