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
  const normalizedCurrent = normalizeJournalTeacherComment(current);
  const normalized = normalizeJournalTeacherComment(next);
  if (journalTeacherCommentLength(normalized) <= JOURNAL_TEACHER_COMMENT_MAX_LENGTH) return normalized;

  const currentCodePoints = Array.from(normalizedCurrent);
  const nextCodePoints = Array.from(normalized);
  let prefixLength = 0;
  while (
    prefixLength < currentCodePoints.length
    && prefixLength < nextCodePoints.length
    && currentCodePoints[prefixLength] === nextCodePoints[prefixLength]
  ) prefixLength += 1;

  let currentSuffixStart = currentCodePoints.length;
  let nextSuffixStart = nextCodePoints.length;
  while (
    currentSuffixStart > prefixLength
    && nextSuffixStart > prefixLength
    && currentCodePoints[currentSuffixStart - 1] === nextCodePoints[nextSuffixStart - 1]
  ) {
    currentSuffixStart -= 1;
    nextSuffixStart -= 1;
  }

  const prefix = nextCodePoints.slice(0, prefixLength);
  const inserted = nextCodePoints.slice(prefixLength, nextSuffixStart);
  const suffix = currentCodePoints.slice(currentSuffixStart);
  let low = 0;
  let high = inserted.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (journalTeacherCommentLength([...prefix, ...inserted.slice(0, middle), ...suffix].join("")) <= JOURNAL_TEACHER_COMMENT_MAX_LENGTH) low = middle;
    else high = middle - 1;
  }
  const constrained = [...prefix, ...inserted.slice(0, low), ...suffix].join("");
  return journalTeacherCommentLength(constrained) <= JOURNAL_TEACHER_COMMENT_MAX_LENGTH ? constrained : current;
}
