import { journalCharacters, journalSectionIllustrations } from "../assets/journal/journalAssets";
import pmLogoExport from "../assets/journal/export/pm-logo-512.png";
import pmLogo from "../assets/pm-logo.png";
import type { JournalRequiredAssetId } from "./journalRenderContract";

export type JournalAssetSourceId = JournalRequiredAssetId | "official-logo";
export type JournalAssetSourceMap = Record<JournalAssetSourceId, string>;

export const JOURNAL_BUNDLED_ASSET_SOURCES: JournalAssetSourceMap = {
  "header-dog-a": journalCharacters.dogAWaving,
  "header-dog-b": journalCharacters.dogBPeeking,
  "best-friend-duo": journalCharacters.bestFriendDuo,
  meal: journalSectionIllustrations.meal,
  manners: journalSectionIllustrations.manners,
  physical: journalSectionIllustrations.physical,
  "teacher-comment-dog": journalCharacters.dogAHeartLetter,
  "official-logo": pmLogo,
};

export const JOURNAL_CANVAS_ASSET_SOURCES: JournalAssetSourceMap = {
  ...JOURNAL_BUNDLED_ASSET_SOURCES,
  "official-logo": pmLogoExport,
};
