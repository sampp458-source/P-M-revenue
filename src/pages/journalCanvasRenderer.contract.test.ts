// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildJournalReportScene,
  JOURNAL_REPORT_ASSET_SLOTS,
  JOURNAL_REPORT_HEIGHT,
  JOURNAL_REPORT_LAYOUT,
  JOURNAL_REPORT_WIDTH,
  journalActivityFontSize,
  journalBestFriendFontSize,
  journalCommentTypography,
  journalDogNameFontSize,
} from "./journalReportScene";
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

  it("shares canonical long-name, activity, and 500-character comment density thresholds", () => {
    expect(journalDogNameFontSize(21)).toBe(17);
    expect(journalBestFriendFontSize(19)).toBe(22);
    expect(journalActivityFontSize(51)).toBe(17);
    expect(journalCommentTypography(500)).toEqual({ density: "minimum-safe", size: 19, lineHeight: 1.32 });
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
    expect(sources).toContain("renderJournalImageBlob(viewModel, \"png\")");
  });
});
