const JOURNAL_DIRECTIONAL_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const JOURNAL_REMOVED_FORMATTING = /[\u00ad\ufeff]/g;
const POSTGRES_BTRIM_SPACES = /^ +| +$/g;

export const JOURNAL_TEACHER_COMMENT_MAX_LENGTH = 500;

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

/** Matches the V2 RPC's nullif(btrim(...), '') persistence boundary. */
export function canonicalJournalTeacherComment(value: string) {
  return normalizeJournalTeacherComment(value).replace(POSTGRES_BTRIM_SPACES, "");
}

/** PostgreSQL char_length counts Unicode code points, not UTF-16 code units. */
export function journalTeacherCommentLength(value: string) {
  return Array.from(canonicalJournalTeacherComment(value)).length;
}

export function constrainJournalTeacherCommentInput(current: string, next: string) {
  const normalized = normalizeJournalTeacherComment(next);
  return journalTeacherCommentLength(normalized) <= JOURNAL_TEACHER_COMMENT_MAX_LENGTH
    ? normalized
    : current;
}
