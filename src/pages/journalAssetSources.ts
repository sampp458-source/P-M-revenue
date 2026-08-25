import { journalCharacters, journalSectionIllustrations } from "../assets/journal/journalAssets";
import pmLogo from "../assets/pm-logo.png";
import { JOURNAL_ASSET_VERSION, JOURNAL_REQUIRED_ASSET_IDS, type JournalRequiredAssetId } from "./journalRenderContract";

export type JournalAssetSourceId = JournalRequiredAssetId | "official-logo";
export type JournalAssetSourceMap = Record<JournalAssetSourceId, string>;

const JOURNAL_EMBEDDED_ASSET_IDS: readonly JournalAssetSourceId[] = [...JOURNAL_REQUIRED_ASSET_IDS, "official-logo"];

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

const embeddedAssetMapCache = new Map<string, Promise<JournalAssetSourceMap>>();

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("JOURNAL_EXPORT_ASSET_EMBED_FAILED"));
    reader.readAsDataURL(blob);
  });
}

export function assertEmbeddedJournalAssetSources(sources: JournalAssetSourceMap) {
  const invalid = JOURNAL_EMBEDDED_ASSET_IDS.filter((id) => !sources[id].startsWith("data:image/png"));
  if (invalid.length) throw new Error(`JOURNAL_EXPORT_EMBEDDED_ASSET_MISSING:${invalid.join(",")}`);
  return sources;
}

export function loadEmbeddedJournalAssetSources() {
  const cached = embeddedAssetMapCache.get(JOURNAL_ASSET_VERSION);
  if (cached) return cached;
  const loading = Promise.all(JOURNAL_EMBEDDED_ASSET_IDS.map(async (id) => {
    const response = await fetch(JOURNAL_BUNDLED_ASSET_SOURCES[id], { cache: "force-cache", credentials: "same-origin" });
    if (!response.ok) throw new Error(`JOURNAL_EXPORT_ASSET_FETCH_FAILED:${id}`);
    const blob = await response.blob();
    if (blob.type !== "image/png") throw new Error(`JOURNAL_EXPORT_ASSET_MIME_INVALID:${id}`);
    const dataUrl = await blobToDataUrl(blob);
    if (!dataUrl.startsWith("data:image/png")) throw new Error(`JOURNAL_EXPORT_ASSET_MIME_INVALID:${id}`);
    return [id, dataUrl] as const;
  })).then((entries) => assertEmbeddedJournalAssetSources(Object.fromEntries(entries) as JournalAssetSourceMap))
    .catch((error) => {
      embeddedAssetMapCache.delete(JOURNAL_ASSET_VERSION);
      throw error;
    });
  embeddedAssetMapCache.set(JOURNAL_ASSET_VERSION, loading);
  return loading;
}
