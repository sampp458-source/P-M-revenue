// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOURNAL_CUSTOM_FONT_ACCEPT,
  JOURNAL_CUSTOM_FONT_MAX_COUNT,
  JOURNAL_CUSTOM_FONT_MAX_FILE_SIZE,
  journalCustomFontInternalFamily,
  journalCustomFontDisplayName,
  journalTeacherCommentFontFamily,
  validateJournalCustomFontFile,
} from "./journalCustomFont";
import { JOURNAL_REPORT_FONT_FAMILY } from "./journalReportScene";

describe("Journal Teacher Comment custom font contract", () => {
  it("accepts the four browser font containers within 20MB", () => {
    expect(JOURNAL_CUSTOM_FONT_ACCEPT).toBe(".ttf,.otf,.woff,.woff2");
    expect(JOURNAL_CUSTOM_FONT_MAX_FILE_SIZE).toBe(20 * 1024 * 1024);
    expect(JOURNAL_CUSTOM_FONT_MAX_COUNT).toBe(5);
    for (const [name, type] of [["font.ttf", "font/ttf"], ["font.otf", "font/otf"], ["font.woff", "font/woff"], ["font.woff2", "font/woff2"]]) {
      expect(() => validateJournalCustomFontFile({ name, type, size: 1024 })).not.toThrow();
    }
  });

  it("rejects unsupported, empty, and oversized files", () => {
    expect(() => validateJournalCustomFontFile({ name: "font.txt", type: "text/plain", size: 10 })).toThrow();
    expect(() => validateJournalCustomFontFile({ name: "font.ttf", type: "font/ttf", size: 0 })).toThrow();
    expect(() => validateJournalCustomFontFile({ name: "font.ttf", type: "font/ttf", size: JOURNAL_CUSTOM_FONT_MAX_FILE_SIZE + 1 })).toThrow();
  });

  it("uses a byte-hash family and retains the approved default fallback", () => {
    expect(journalCustomFontInternalFamily("abcdef0123456789abcdef0123456789")).toBe("pnm-journal-user-font-abcdef0123456789abcd");
    expect(journalTeacherCommentFontFamily()).toBe(JOURNAL_REPORT_FONT_FAMILY);
    expect(journalTeacherCommentFontFamily("pnm-journal-user-font-test")).toBe(`"pnm-journal-user-font-test", ${JOURNAL_REPORT_FONT_FAMILY}`);
  });

  it("humanizes safe filename boundaries without exposing the generated family", () => {
    expect(journalCustomFontDisplayName("NanumBrushScript.ttf")).toBe("Nanum Brush Script");
    expect(journalCustomFontDisplayName("my_custom-font.woff2")).toBe("my custom font");
    expect(journalCustomFontDisplayName(".ttf")).toBe("사용자 글꼴");
  });

  it("keeps binary storage local and never introduces a backend transport", () => {
    const source = readFileSync(resolve(import.meta.dirname, "journalCustomFont.ts"), "utf8");
    expect(source).toContain("indexedDB.open");
    expect(source).toContain("crypto.subtle.digest(\"SHA-256\"");
    expect(source).toContain("new FontFace");
    expect(source).toContain("assertJournalCustomFontBasicMetrics");
    expect(source).toContain("queryLocalFonts");
    expect(source).toContain("JOURNAL_SYSTEM_FONT_RECONNECT_REQUIRED");
    expect(source).not.toMatch(/supabase|fetch\(|XMLHttpRequest|localStorage/);
  });
});
