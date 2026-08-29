import { describe, expect, it } from "vitest";
import {
  canonicalJournalTeacherComment,
  constrainJournalTeacherCommentInput,
  journalTeacherCommentLength,
  normalizeJournalTeacherComment,
} from "./journalTextNormalization";

const fixture = (kind: "ASCII" | "Korean" | "Emoji" | "Newline" | "CRLF" | "Mixed", length: number) => {
  if (kind === "ASCII") return "a".repeat(length);
  if (kind === "Korean") return "가".repeat(length);
  if (kind === "Emoji") return "🐶".repeat(length);
  const characters = Array.from({ length }, (_, index) => {
    if (kind === "Mixed") return index % 13 === 0 ? "🐶" : index % 7 === 0 ? "\n" : "가";
    return index % 11 === 0 || index === length - 1 ? "\n" : "가";
  }).join("");
  return kind === "CRLF" ? characters.replaceAll("\n", "\r\n") : characters;
};

describe("Journal teacher comment normalization", () => {
  it.each([
    ["Korean plain text", "오늘도 즐거웠어요.", "오늘도 즐거웠어요."],
    ["CRLF and CR", "첫째\r\n둘째\r셋째", "첫째\n둘째\n셋째"],
    ["Unicode line separators", "첫째\u2028둘째\u2029셋째", "첫째\n둘째\n셋째"],
    ["NBSP", "안녕\u00a0친구", "안녕 친구"],
    ["NFD Korean", "가을", "가을"],
    ["format controls", "\ufeff안\u00ad녕\u200e\u202e", "안녕"],
    ["emoji", "즐거워요 🐶✨", "즐거워요 🐶✨"],
    ["emoji ZWJ and variation selector", "가족 👨‍👩‍👧‍👦 ❤️", "가족 👨‍👩‍👧‍👦 ❤️"],
    ["mixed", "Hello, 가을! 123.", "Hello, 가을! 123."],
  ])("normalizes %s without losing intended text", (_fixture, input, expected) => {
    expect(normalizeJournalTeacherComment(input)).toBe(expected);
  });

  it("preserves intentional line breaks and a 500-character comment", () => {
    const input = `${"가".repeat(249)}\n${"나".repeat(250)}`;
    const result = normalizeJournalTeacherComment(input);
    expect(result).toBe(input);
    expect(result).toHaveLength(500);
  });

  it.each(["ASCII", "Korean", "Emoji", "Newline", "CRLF", "Mixed"] as const)(
    "uses the PostgreSQL char_length boundary for %s",
    (kind) => {
      const value499 = fixture(kind, 499);
      const value500 = fixture(kind, 500);
      const value501 = fixture(kind, 501);
      const current500 = normalizeJournalTeacherComment(value500);
      expect(journalTeacherCommentLength(value499)).toBe(499);
      expect(journalTeacherCommentLength(value500)).toBe(500);
      expect(journalTeacherCommentLength(value501)).toBe(501);
      expect(journalTeacherCommentLength(constrainJournalTeacherCommentInput("", value499))).toBe(499);
      expect(journalTeacherCommentLength(constrainJournalTeacherCommentInput("", value500))).toBe(500);
      const constrained501 = constrainJournalTeacherCommentInput(current500, value501);
      expect(journalTeacherCommentLength(constrained501)).toBe(500);
    },
  );

  it.each([
    ["simple emoji", "🐶"],
    ["emoji with variation selector", "❤️"],
    ["surrogate pair", "𠮷"],
    ["ZWJ emoji", "👨‍👩‍👧‍👦"],
    ["mixed Korean and emoji", "가🐶"],
  ])("accepts the remaining canonical capacity from an oversized %s paste", (_name, token) => {
    const current = "가".repeat(484);
    const result = constrainJournalTeacherCommentInput(current, `${current}${token.repeat(20)}`);
    expect(journalTeacherCommentLength(result)).toBe(500);
    expect(result.startsWith(current)).toBe(true);
  });

  it("blocks an insertion at the full boundary without dropping existing suffix content", () => {
    const current = `${"가".repeat(250)}${"나".repeat(250)}`;
    expect(constrainJournalTeacherCommentInput(current, `${"가".repeat(250)}🐶${"나".repeat(250)}`)).toBe(current);
  });

  it("matches server btrim semantics for leading and trailing spaces without removing newlines", () => {
    const input = `  ${"가".repeat(499)}\n  `;
    expect(canonicalJournalTeacherComment(input)).toBe(`${"가".repeat(499)}\n`);
    expect(journalTeacherCommentLength(input)).toBe(500);
    expect(constrainJournalTeacherCommentInput("", input)).toBe(normalizeJournalTeacherComment(input));
  });
});
