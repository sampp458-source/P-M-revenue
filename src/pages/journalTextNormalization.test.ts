import { describe, expect, it } from "vitest";
import { normalizeJournalTeacherComment } from "./journalTextNormalization";

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
});
