const JOURNAL_DIRECTIONAL_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const JOURNAL_REMOVED_FORMATTING = /[\u00ad\ufeff]/g;

export function normalizeJournalTeacherComment(value: string) {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .replaceAll("\u00a0", " ")
    .replace(JOURNAL_REMOVED_FORMATTING, "")
    .replace(JOURNAL_DIRECTIONAL_CONTROLS, "")
    .normalize("NFC");
}
