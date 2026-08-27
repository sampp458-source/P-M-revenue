import { describe, expect, it } from "vitest";
import {
  formatJournalBestFriendPhrase,
  formatJournalBestFriendVisualLines,
  hasKoreanFinalConsonant,
  journalBestFriendParticle,
  resolveJournalBestFriendLayout,
  type JournalBestFriendDisplayTarget,
} from "./journalBestFriendPresentation";

const dog = (label: string, dogId = label): JournalBestFriendDisplayTarget => ({ type: "DOG", dogId, label });
const teacher: JournalBestFriendDisplayTarget = { type: "TEACHER", dogId: null, label: "선생님" };

describe("Journal Best Friend Korean presentation", () => {
  it.each([
    ["가을", true, "이에요"],
    ["단추", false, "예요"],
    ["몽이", false, "예요"],
    ["건달", true, "이에요"],
    ["먼지", false, "예요"],
    ["개똥이", false, "예요"],
    ["선생님", true, "이에요"],
  ])("selects the canonical particle for %s", (name, finalConsonant, particle) => {
    expect(hasKoreanFinalConsonant(name)).toBe(finalConsonant);
    expect(journalBestFriendParticle(name)).toBe(particle);
  });

  it("uses the final displayed target for multi-target grammar", () => {
    expect(formatJournalBestFriendPhrase([dog("단추"), dog("가을")])).toBe("단추, 가을이에요 ♡");
    expect(formatJournalBestFriendPhrase([dog("단추"), teacher])).toBe("단추, 선생님이에요 ♡");
  });

  it("uses a deterministic consonant-safe fallback for English, digits, and symbols", () => {
    expect(journalBestFriendParticle("Buddy")).toBe("이에요");
    expect(journalBestFriendParticle("7")).toBe("이에요");
    expect(journalBestFriendParticle("P&M!" )).toBe("이에요");
  });

  it("emits no dangling particle for an empty selection", () => {
    expect(formatJournalBestFriendPhrase([])).toBe("");
    expect(formatJournalBestFriendVisualLines([])).toEqual([]);
  });

  it("keeps one and two targets on one line", () => {
    expect(formatJournalBestFriendVisualLines([dog("단추")])).toEqual(["단추예요 ♡"]);
    expect(formatJournalBestFriendVisualLines([dog("단추"), dog("가을")])).toEqual(["단추, 가을이에요 ♡"]);
  });

  it("uses two name-safe lines when two unusually long targets cannot stay readable on one line", () => {
    expect(formatJournalBestFriendVisualLines([
      dog("세상에서제일사랑스러운몽이왕자님"),
      dog("오늘도행복한크리미공주님"),
    ])).toEqual([
      "세상에서제일사랑스러운몽이왕자님,",
      "오늘도행복한크리미공주님이에요 ♡",
    ]);
  });

  it("balances three to five targets into two name-safe lines", () => {
    expect(formatJournalBestFriendVisualLines([dog("단추"), dog("가을"), teacher])).toEqual([
      "단추, 가을,",
      "선생님이에요 ♡",
    ]);
    expect(formatJournalBestFriendVisualLines([dog("단추"), dog("가을"), teacher, dog("건달"), dog("먼지")])).toEqual([
      "단추, 가을, 선생님,",
      "건달, 먼지예요 ♡",
    ]);
  });

  it("resolves canonical line, typography, and centering values for both DOM and Canvas", () => {
    expect(resolveJournalBestFriendLayout([dog("단추"), dog("가을"), teacher, dog("건달"), dog("먼지")])).toMatchObject({
      phrase: "단추, 가을, 선생님, 건달, 먼지예요 ♡",
      lines: ["단추, 가을, 선생님,", "건달, 먼지예요 ♡"],
      fontSize: 30,
      lineCount: 2,
      maxTextWidth: 460,
      centerY: 770,
    });
    expect(resolveJournalBestFriendLayout([
      dog("세상에서제일사랑스러운몽이왕자님"),
      teacher,
      dog("오늘도행복한크리미공주님"),
    ]).fontSize).toBe(28);
  });
});
