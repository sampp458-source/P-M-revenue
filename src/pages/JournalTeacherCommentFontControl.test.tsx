// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalTeacherCommentFontControl } from "./JournalTeacherCommentFontControl";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  select: vi.fn(),
  preference: {
    status: "ready",
    fonts: [] as Array<{ id: string; displayName: string; family: string; fileName: string; mimeType: string; fileSize: number; createdAt: string }>,
    activeFontId: null as string | null,
    activeFontFamily: "Pretendard, sans-serif",
    error: "",
  },
}));

vi.mock("./journalCustomFont", () => ({
  JOURNAL_CUSTOM_FONT_ACCEPT: ".ttf,.otf,.woff,.woff2",
  addJournalCustomFont: mocks.add,
  deleteJournalCustomFont: mocks.remove,
  selectJournalCustomFont: mocks.select,
  journalCustomFontDisplayName: (value: string) => value.replace(/([a-z\d])([A-Z])/g, "$1 $2"),
  journalCustomFontPreviewFamily: (id: string) => id === "font-1" ? '"preview-font", sans-serif' : undefined,
  useJournalCustomFontPreference: () => mocks.preference,
}));

const font = (id: string, displayName: string) => ({
  id,
  displayName,
  family: `family-${id}`,
  fileName: `${displayName}.ttf`,
  mimeType: "font/ttf",
  fileSize: 1024,
  createdAt: "2026-08-28T00:00:00.000Z",
});

beforeEach(() => {
  mocks.add.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.select.mockReset().mockResolvedValue(undefined);
  mocks.preference.status = "ready";
  mocks.preference.fonts = [];
  mocks.preference.activeFontId = null;
  mocks.preference.activeFontFamily = "Pretendard, sans-serif";
  mocks.preference.error = "";
});

afterEach(cleanup);

describe("Journal Teacher Comment font control", () => {
  it("keeps the default state to one compact row and reveals management only on demand", () => {
    render(<JournalTeacherCommentFontControl />);
    const trigger = screen.getByRole("button", { name: "기본 글꼴" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "내 글꼴 추가" })).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox", { name: "선생님의 한마디 글꼴" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "내 글꼴 추가" })).toBeTruthy();
  });

  it("shows readable custom names, loaded previews, selected state, and per-font delete actions", () => {
    mocks.preference.fonts = [font("font-1", "NanumPenScript"), font("font-2", "My_Font")];
    mocks.preference.activeFontId = "font-1";
    mocks.preference.activeFontFamily = '"preview-font", sans-serif';
    render(<JournalTeacherCommentFontControl />);

    fireEvent.click(screen.getByRole("button", { name: "Nanum Pen Script" }));
    expect(screen.getByRole("option", { name: /Nanum Pen Script/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("오늘도 즐거운 하루였어요.").getAttribute("style")).toContain("preview-font");
    expect(screen.getByRole("button", { name: "Nanum Pen Script 삭제" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "My_Font 삭제" })).toBeTruthy();
  });

  it("keeps active deletion inside the menu and delegates the safe fallback to the existing engine", async () => {
    mocks.preference.fonts = [font("font-1", "NanumPenScript")];
    mocks.preference.activeFontId = "font-1";
    mocks.preference.activeFontFamily = '"preview-font", sans-serif';
    render(<JournalTeacherCommentFontControl />);
    fireEvent.click(screen.getByRole("button", { name: "Nanum Pen Script" }));
    fireEvent.click(screen.getByRole("button", { name: "Nanum Pen Script 삭제" }));
    expect(mocks.remove).toHaveBeenCalledWith("font-1");
  });

  it("does not own Journal persistence, version, audit, or request contracts", () => {
    const source = readFileSync(resolve(import.meta.dirname, "JournalTeacherCommentFontControl.tsx"), "utf8");
    expect(source).not.toMatch(/updateJournalEntryDraft|JournalAutosaveQueue|requestId|expectedVersion|entity_audit_events|supabase/);
  });
});
