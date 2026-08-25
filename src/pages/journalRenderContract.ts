import { journalCharacters, journalSectionIllustrations } from "../assets/journal/journalAssets";
import pmLogo from "../assets/pm-logo.png";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

export const JOURNAL_RENDERER_VERSION = "live-dom-v1";
export const JOURNAL_TEMPLATE_VERSION = "journal-template-v10";
export const JOURNAL_ASSET_VERSION = "approved-illustrations-v1";

export const JOURNAL_REQUIRED_ASSET_IDS = [
  "header-dog-a",
  "header-dog-b",
  "best-friend-duo",
  "meal",
  "manners",
  "physical",
  "teacher-comment-dog",
] as const;

export type JournalRequiredAssetId = typeof JOURNAL_REQUIRED_ASSET_IDS[number];

export function journalViewModelRevision(viewModel: JournalPreviewViewModel) {
  const serialized = JSON.stringify(viewModel);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export const JOURNAL_APPROVED_ASSET_SOURCE_KEY = [
  pmLogo,
  ...Object.values(journalCharacters),
  ...Object.values(journalSectionIllustrations),
].join("|");

export function isCurrentJournalTemplateRoot(root: HTMLElement) {
  return root.dataset.journalSource === "typed-view-model"
    && root.dataset.journalRendererVersion === JOURNAL_RENDERER_VERSION
    && root.dataset.journalTemplateVersion === JOURNAL_TEMPLATE_VERSION
    && root.dataset.journalAssetVersion === JOURNAL_ASSET_VERSION;
}
