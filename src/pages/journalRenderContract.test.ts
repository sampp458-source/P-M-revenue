// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  isCurrentJournalTemplateRoot,
  JOURNAL_APPROVED_ASSET_SOURCE_KEY,
  JOURNAL_ASSET_VERSION,
  JOURNAL_RENDERER_VERSION,
  JOURNAL_TEMPLATE_VERSION,
} from "./journalRenderContract";

describe("Journal render contract", () => {
  it("pins the current typed DOM renderer, template, and approved assets", () => {
    expect(JOURNAL_RENDERER_VERSION).toBeTruthy();
    expect(JOURNAL_TEMPLATE_VERSION).toBeTruthy();
    expect(JOURNAL_ASSET_VERSION).toBeTruthy();
    expect(JOURNAL_APPROVED_ASSET_SOURCE_KEY.split("|")).toHaveLength(8);
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
