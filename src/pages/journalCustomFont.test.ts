// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  JOURNAL_CUSTOM_FONT_ACCEPT,
  JOURNAL_CUSTOM_FONT_MAX_COUNT,
  JOURNAL_CUSTOM_FONT_MAX_FILE_SIZE,
  journalCustomFontInternalFamily,
  journalCustomFontDisplayName,
  journalTeacherCommentFontFamily,
  matchJournalSystemFontDescriptor,
  parseEntryOverride,
  resolveJournalTeacherCommentPresentationReferenceFrom,
  validateJournalCustomFontFile,
} from "./journalCustomFont";
import { JOURNAL_REPORT_FONT_FAMILY } from "./journalReportScene";

function memoryIndexedDb() {
  const stores = new Map<string, Map<IDBValidKey, unknown>>();
  const request = <T>(operation: () => T) => {
    const listeners = new Map<string, Array<() => void>>();
    const value = { result: undefined as T, error: null, addEventListener(type: string, listener: () => void) { listeners.set(type, [...listeners.get(type) ?? [], listener]); } };
    queueMicrotask(() => { value.result = operation(); for (const listener of listeners.get("success") ?? []) listener(); });
    return value;
  };
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore(name: string) { stores.set(name, new Map()); },
    transaction(names: string | string[]) {
      const selected = Array.isArray(names) ? names : [names];
      return { objectStore(name: string) {
        if (!selected.includes(name)) throw new Error(`Unexpected store ${name}`);
        const store = stores.get(name)!;
        return {
          getAll: () => request(() => [...store.values()]),
          get: (key: IDBValidKey) => request(() => store.get(key)),
          put: (value: Record<string, unknown>, key?: IDBValidKey) => request(() => { const resolved = key ?? value.journalEntryId ?? value.id; store.set(resolved as IDBValidKey, value); return resolved as IDBValidKey; }),
          delete: (key: IDBValidKey) => request(() => store.delete(key)),
        };
      } };
    },
    close() {},
  };
  return { open: () => {
    const listeners = new Map<string, Array<() => void>>();
    const value = { result: database, error: null, addEventListener(type: string, listener: () => void) { listeners.set(type, [...listeners.get(type) ?? [], listener]); } };
    queueMicrotask(() => { if (!stores.size) for (const listener of listeners.get("upgradeneeded") ?? []) listener(); for (const listener of listeners.get("success") ?? []) listener(); });
    return value;
  } } as unknown as IDBFactory;
}

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
    expect(source).toContain('source === "SYSTEM" ? "reconnect-required"');
    expect(source).toContain("reconnectActiveJournalSystemFont");
    expect(source).not.toMatch(/supabase|fetch\(|XMLHttpRequest|localStorage/);
  });

  it("matches a persisted system-font descriptor by PostScript identity before exact metadata fallback", () => {
    const descriptor = { postscriptName: "NanumPen-Regular", fullName: "나눔손글씨 펜", family: "Nanum Pen", style: "Regular" };
    const samePostscript = { ...descriptor, fullName: "표시 이름 변경" };
    expect(matchJournalSystemFontDescriptor(descriptor, [samePostscript])).toBe(samePostscript);
    const exactMetadata = { ...descriptor, postscriptName: "NanumPen-New" };
    expect(matchJournalSystemFontDescriptor(descriptor, [exactMetadata])).toBe(exactMetadata);
    expect(matchJournalSystemFontDescriptor(descriptor, [{ ...exactMetadata, style: "Bold" }])).toBeNull();
  });

  it("resolves A/B/C presentation across repeated navigation without cross-entry mutation", () => {
    const globalDefault = { fontSource: "DEFAULT" as const, fileFontId: null, systemFontDescriptor: null, fontSize: 20 as const };
    const systemFontDescriptor = { postscriptName: "System-C", fullName: "System C", family: "System C", style: "Regular" };
    const overrides = {
      "entry-a": { journalEntryId: "entry-a", fontSource: "FILE" as const, fileFontId: "font-x", systemFontDescriptor: null, fontSize: 18 as const, schemaVersion: 1 as const },
      "entry-c": { journalEntryId: "entry-c", fontSource: "SYSTEM" as const, fileFontId: null, systemFontDescriptor, fontSize: 22 as const, schemaVersion: 1 as const },
    };
    expect(["entry-a", "entry-b", "entry-c", "entry-a", "entry-b"].map((entryId) =>
      resolveJournalTeacherCommentPresentationReferenceFrom(entryId, globalDefault, overrides),
    )).toEqual([
      { fontSource: "FILE", fileFontId: "font-x", systemFontDescriptor: null, fontSize: 18 },
      globalDefault,
      { fontSource: "SYSTEM", fileFontId: null, systemFontDescriptor, fontSize: 22 },
      { fontSource: "FILE", fileFontId: "font-x", systemFontDescriptor: null, fontSize: 18 },
      globalDefault,
    ]);
    expect(globalDefault.fontSize).toBe(20);

    const { "entry-a": removed, ...afterAReset } = overrides;
    expect(removed.journalEntryId).toBe("entry-a");
    expect(resolveJournalTeacherCommentPresentationReferenceFrom("entry-a", globalDefault, afterAReset)).toEqual(globalDefault);
    expect(resolveJournalTeacherCommentPresentationReferenceFrom("entry-b", globalDefault, afterAReset)).toEqual(globalDefault);
    expect(resolveJournalTeacherCommentPresentationReferenceFrom("entry-c", globalDefault, afterAReset)).toMatchObject({ fontSource: "SYSTEM", fontSize: 22 });
  });

  it("fails corrupt or unsupported entry presentation records back to the global default", () => {
    expect(parseEntryOverride({ journalEntryId: "entry-a", fontSource: "FILE", fileFontId: null, fontSize: 18, schemaVersion: 1 })).toBeNull();
    expect(parseEntryOverride({ journalEntryId: "entry-a", fontSource: "SYSTEM", systemFontDescriptor: null, fontSize: 20, schemaVersion: 1 })).toBeNull();
    expect(parseEntryOverride({ journalEntryId: "entry-a", fontSource: "DEFAULT", fontSize: 19, schemaVersion: 1 })).toBeNull();
    expect(parseEntryOverride({ journalEntryId: "entry-a", fontSource: "DEFAULT", fontSize: 20, schemaVersion: 2 })).toBeNull();
  });

  it("keeps deleted file-font references fail-closed and system reconnect entry-scoped", () => {
    const source = readFileSync(resolve(import.meta.dirname, "journalCustomFont.ts"), "utf8");
    expect(source).toContain('throw new Error("JOURNAL_CUSTOM_FONT_NOT_READY")');
    expect(source).toContain('throw new Error("JOURNAL_SYSTEM_FONT_RECONNECT_REQUIRED")');
    expect(source).toContain("const reference = resolveJournalTeacherCommentPresentationReference(entryId);");
    expect(source).toContain("new Set(matches.flatMap");
  });

  it("persists A/B/C sizes across module reload and resets only A's IndexedDB record", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    const previousFontFace = Object.getOwnPropertyDescriptor(globalThis, "FontFace");
    const previousFonts = Object.getOwnPropertyDescriptor(document, "fonts");
    const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: memoryIndexedDb() });
    Object.defineProperty(globalThis, "FontFace", { configurable: true, value: class TestFontFace {} });
    Object.defineProperty(document, "fonts", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { subtle: {} } });
    try {
      vi.resetModules();
      const first = await import("./journalCustomFont");
      await first.selectJournalEntryTeacherCommentFontSize("entry-a", 18);
      await first.selectJournalEntryTeacherCommentFontSize("entry-b", 20);
      await first.selectJournalEntryTeacherCommentFontSize("entry-c", 22);
      expect(["entry-a", "entry-b", "entry-c", "entry-a", "entry-b"].map((id) => first.resolveJournalTeacherCommentPresentationReference(id).fontSize)).toEqual([18, 20, 22, 18, 20]);

      vi.resetModules();
      const reloaded = await import("./journalCustomFont");
      await reloaded.initializeJournalCustomFonts();
      expect(["entry-a", "entry-b", "entry-c"].map((id) => reloaded.resolveJournalTeacherCommentPresentationReference(id).fontSize)).toEqual([18, 20, 22]);
      await reloaded.resetJournalEntryTeacherCommentPresentation("entry-a");
      await reloaded.selectJournalTeacherCommentFontSize(24);
      expect(reloaded.resolveJournalTeacherCommentPresentationReference("entry-a").fontSize).toBe(24);
      expect(reloaded.resolveJournalTeacherCommentPresentationReference("entry-b").fontSize).toBe(20);
      expect(reloaded.resolveJournalTeacherCommentPresentationReference("entry-c").fontSize).toBe(22);
    } finally {
      if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
      else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (previousFontFace) Object.defineProperty(globalThis, "FontFace", previousFontFace);
      else delete (globalThis as { FontFace?: typeof FontFace }).FontFace;
      if (previousFonts) Object.defineProperty(document, "fonts", previousFonts);
      else delete (document as { fonts?: FontFaceSet }).fonts;
      if (previousCrypto) Object.defineProperty(globalThis, "crypto", previousCrypto);
      else delete (globalThis as { crypto?: Crypto }).crypto;
      vi.resetModules();
    }
  });
});
