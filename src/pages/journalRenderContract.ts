import { journalCharacters, journalSectionIllustrations } from "../assets/journal/journalAssets";
import pmLogo from "../assets/pm-logo.png";

export const JOURNAL_RENDERER_VERSION = "live-dom-v1";
export const JOURNAL_TEMPLATE_VERSION = "journal-template-v10";
export const JOURNAL_ASSET_VERSION = "approved-illustrations-v1";

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
