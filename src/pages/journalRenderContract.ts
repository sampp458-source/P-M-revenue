import { journalCharacters, journalSectionIllustrations } from "../assets/journal/journalAssets";
import pmLogo from "../assets/pm-logo.png";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

export const JOURNAL_RENDERER_VERSION = "direct-raster-v2";
export const JOURNAL_TEMPLATE_VERSION = "journal-template-v10";
export const JOURNAL_ASSET_VERSION = "approved-illustrations-v1";

export const JOURNAL_APPROVED_ASSET_SOURCE_KEY = [
  pmLogo,
  ...Object.values(journalCharacters),
  ...Object.values(journalSectionIllustrations),
].join("|");

export type JournalRasterCacheEntry = {
  key: string;
  rendererVersion: string;
  templateVersion: string;
  assetVersion: string;
  assetSourceKey: string;
  blob: Blob;
  url: string;
};

export function buildJournalPreviewRenderKey(viewModel: JournalPreviewViewModel) {
  return JSON.stringify({
    rendererVersion: JOURNAL_RENDERER_VERSION,
    templateVersion: JOURNAL_TEMPLATE_VERSION,
    assetVersion: JOURNAL_ASSET_VERSION,
    assetSourceKey: JOURNAL_APPROVED_ASSET_SOURCE_KEY,
    viewModel,
  });
}

export function createCurrentJournalRasterCacheEntry(
  key: string,
  blob: Blob,
  url: string,
): JournalRasterCacheEntry {
  return {
    key,
    rendererVersion: JOURNAL_RENDERER_VERSION,
    templateVersion: JOURNAL_TEMPLATE_VERSION,
    assetVersion: JOURNAL_ASSET_VERSION,
    assetSourceKey: JOURNAL_APPROVED_ASSET_SOURCE_KEY,
    blob,
    url,
  };
}

export function isCurrentJournalRasterCacheEntry(
  entry: JournalRasterCacheEntry | null | undefined,
  expectedKey: string,
) {
  return Boolean(
    entry
    && entry.key === expectedKey
    && entry.rendererVersion === JOURNAL_RENDERER_VERSION
    && entry.templateVersion === JOURNAL_TEMPLATE_VERSION
    && entry.assetVersion === JOURNAL_ASSET_VERSION
    && entry.assetSourceKey === JOURNAL_APPROVED_ASSET_SOURCE_KEY,
  );
}

export function isCurrentJournalTemplateRoot(root: HTMLElement) {
  return root.dataset.journalSource === "typed-view-model"
    && root.dataset.journalRendererVersion === JOURNAL_RENDERER_VERSION
    && root.dataset.journalTemplateVersion === JOURNAL_TEMPLATE_VERSION
    && root.dataset.journalAssetVersion === JOURNAL_ASSET_VERSION;
}
