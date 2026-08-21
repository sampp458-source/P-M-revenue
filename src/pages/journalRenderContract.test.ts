// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  buildJournalPreviewRenderKey,
  createCurrentJournalRasterCacheEntry,
  isCurrentJournalRasterCacheEntry,
  isCurrentJournalTemplateRoot,
  JOURNAL_APPROVED_ASSET_SOURCE_KEY,
  JOURNAL_ASSET_VERSION,
  JOURNAL_RENDERER_VERSION,
  JOURNAL_TEMPLATE_VERSION,
} from "./journalRenderContract";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

const viewModel = {
  entryId: "entry-1",
  dogName: "크리미",
  businessDate: "2026-08-21",
} as JournalPreviewViewModel;

describe("Journal render contract", () => {
  it("keys a preview from typed data plus the current renderer, template, and approved assets", () => {
    const key = buildJournalPreviewRenderKey(viewModel);
    expect(key).toContain(JOURNAL_RENDERER_VERSION);
    expect(key).toContain(JOURNAL_TEMPLATE_VERSION);
    expect(key).toContain(JOURNAL_ASSET_VERSION);
    expect(key).toContain("entry-1");
    expect(buildJournalPreviewRenderKey({ ...viewModel, dogName: "몽이" })).not.toBe(key);
    expect(JOURNAL_APPROVED_ASSET_SOURCE_KEY.split("|")).toHaveLength(8);
  });

  it("accepts only a cache entry created by the complete current render contract", () => {
    const key = buildJournalPreviewRenderKey(viewModel);
    const current = createCurrentJournalRasterCacheEntry(
      key,
      new Blob(["preview"], { type: "image/png" }),
      "blob:preview",
    );
    expect(isCurrentJournalRasterCacheEntry(current, key)).toBe(true);
    expect(isCurrentJournalRasterCacheEntry({ ...current, rendererVersion: "legacy" }, key)).toBe(false);
    expect(isCurrentJournalRasterCacheEntry({ ...current, templateVersion: "legacy" }, key)).toBe(false);
    expect(isCurrentJournalRasterCacheEntry({ ...current, assetVersion: "legacy" }, key)).toBe(false);
    expect(isCurrentJournalRasterCacheEntry({ ...current, assetSourceKey: "legacy" }, key)).toBe(false);
    expect(isCurrentJournalRasterCacheEntry(current, "different-view-model")).toBe(false);
    expect(isCurrentJournalRasterCacheEntry(null, key)).toBe(false);
  });

  it("rejects legacy snapshot roots and accepts only the current typed ViewModel template root", () => {
    const root = document.createElement("article");
    expect(isCurrentJournalTemplateRoot(root)).toBe(false);

    root.dataset.journalSource = "typed-view-model";
    root.dataset.journalRendererVersion = JOURNAL_RENDERER_VERSION;
    root.dataset.journalTemplateVersion = JOURNAL_TEMPLATE_VERSION;
    root.dataset.journalAssetVersion = JOURNAL_ASSET_VERSION;
    expect(isCurrentJournalTemplateRoot(root)).toBe(true);

    root.dataset.journalAssetVersion = "legacy";
    expect(isCurrentJournalTemplateRoot(root)).toBe(false);
  });
});
