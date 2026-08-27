import type { JournalBestFriendTarget } from "./journalRepository";

export const JOURNAL_BEST_FRIEND_MAX_TARGETS = 5;
export const JOURNAL_BEST_FRIEND_TEACHER_LABEL = "선생님";

export type JournalBestFriendDisplayTarget = JournalBestFriendTarget & { label: string };

export type JournalBestFriendLayout = {
  phrase: string;
  lines: string[];
  fontSize: 24 | 28 | 30 | 44;
  lineHeight: number;
  lineCount: number;
  maxTextWidth: number;
  textBlockHeight: number;
  centerY: number;
};

export function hasKoreanFinalConsonant(value: string): boolean | null {
  const last = Array.from(value.trim()).at(-1);
  if (!last) return null;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28 !== 0;
}

export function journalBestFriendParticle(value: string) {
  return hasKoreanFinalConsonant(value) === false ? "예요" : "이에요";
}

export function formatJournalBestFriendNames(targets: readonly JournalBestFriendDisplayTarget[]) {
  return targets.map((target) => target.label).join(", ");
}

export function formatJournalBestFriendPhrase(targets: readonly JournalBestFriendDisplayTarget[]) {
  const names = formatJournalBestFriendNames(targets);
  return names ? `${names}${journalBestFriendParticle(names)} ♡` : "";
}

export function formatJournalBestFriendVisualLines(
  targets: readonly JournalBestFriendDisplayTarget[],
) {
  if (targets.length === 0) return [];
  if (targets.length === 1) return [formatJournalBestFriendPhrase(targets)];
  if (targets.length === 2) {
    const phrase = formatJournalBestFriendPhrase(targets);
    return phrase.length <= 22
      ? [phrase]
      : [`${targets[0].label},`, formatJournalBestFriendPhrase(targets.slice(1))];
  }

  let bestSplit = 1;
  let bestBalance = Number.POSITIVE_INFINITY;
  for (let split = 1; split < targets.length; split += 1) {
    const first = `${formatJournalBestFriendNames(targets.slice(0, split))},`;
    const second = formatJournalBestFriendPhrase(targets.slice(split));
    const balance = Math.max(first.length, second.length) + Math.abs(first.length - second.length) * 0.35;
    if (balance < bestBalance) {
      bestBalance = balance;
      bestSplit = split;
    }
  }

  return [
    `${formatJournalBestFriendNames(targets.slice(0, bestSplit))},`,
    formatJournalBestFriendPhrase(targets.slice(bestSplit)),
  ];
}

export function resolveJournalBestFriendLayout(
  targets: readonly JournalBestFriendDisplayTarget[],
): JournalBestFriendLayout {
  const phrase = formatJournalBestFriendPhrase(targets);
  const lines = formatJournalBestFriendVisualLines(targets);
  const longestLineLength = Math.max(0, ...lines.map((line) => line.length));
  const fontSize = (
    targets.length >= 3
      ? longestLineLength > 24 ? 24 : longestLineLength > 18 ? 28 : 30
      : longestLineLength > 24 ? 24 : longestLineLength > 18 ? 28 : longestLineLength > 10 ? 30 : 44
  ) as JournalBestFriendLayout["fontSize"];
  const lineHeight = fontSize * 1.04;
  return {
    phrase,
    lines,
    fontSize,
    lineHeight,
    lineCount: lines.length,
    maxTextWidth: 460,
    textBlockHeight: Math.max(fontSize, lines.length * lineHeight),
    centerY: 770,
  };
}

export function normalizedJournalBestFriendDisplayTargets(value: {
  bestFriendTargets?: readonly JournalBestFriendDisplayTarget[];
  bestFriendName?: string | null;
}): JournalBestFriendDisplayTarget[] {
  if (value.bestFriendTargets) return [...value.bestFriendTargets];
  return value.bestFriendName
    ? [{ type: "DOG", dogId: "legacy-display", label: value.bestFriendName }]
    : [];
}
