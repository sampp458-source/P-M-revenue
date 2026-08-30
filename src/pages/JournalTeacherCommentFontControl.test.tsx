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
  connect: vi.fn(),
  reconnect: vi.fn(),
  selectSystem: vi.fn(),
  selectSize: vi.fn(),
  preference: {
    status: "ready",
    fonts: [] as Array<{ id: string; displayName: string; family: string; fileName: string; mimeType: string; fileSize: number; createdAt: string }>,
    activeFontId: null as string | null,
    activeFontFamily: "Pretendard, sans-serif",
    activeSource: "DEFAULT",
    activeSystemFont: null as null | { postscriptName: string; fullName: string; family: string; style: string },
    systemFonts: [] as Array<{ postscriptName: string; fullName: string; family: string; style: string }>,
    systemFontStatus: "unsupported",
    fontSize: 20,
    error: "",
  },
}));

vi.mock("./journalCustomFont", () => ({
  JOURNAL_CUSTOM_FONT_ACCEPT: ".ttf,.otf,.woff,.woff2",
  addJournalCustomFont: mocks.add,
  deleteJournalCustomFont: mocks.remove,
  selectJournalCustomFont: mocks.select,
  connectJournalSystemFonts: mocks.connect,
  reconnectActiveJournalSystemFont: mocks.reconnect,
  selectJournalSystemFont: mocks.selectSystem,
  selectJournalTeacherCommentFontSize: mocks.selectSize,
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
  mocks.connect.mockReset().mockResolvedValue([]);
  mocks.reconnect.mockReset().mockResolvedValue(undefined);
  mocks.selectSystem.mockReset().mockResolvedValue(undefined);
  mocks.selectSize.mockReset().mockResolvedValue(undefined);
  mocks.preference.status = "ready";
  mocks.preference.fonts = [];
  mocks.preference.activeFontId = null;
  mocks.preference.activeFontFamily = "Pretendard, sans-serif";
  mocks.preference.activeSource = "DEFAULT";
  mocks.preference.activeSystemFont = null;
  mocks.preference.systemFonts = [];
  mocks.preference.systemFontStatus = "unsupported";
  mocks.preference.fontSize = 20;
  mocks.preference.error = "";
});

afterEach(cleanup);

describe("Journal Teacher Comment font control", () => {
  it("keeps the default state to one compact row and reveals management only on demand", () => {
    render(<JournalTeacherCommentFontControl />);
    const trigger = screen.getByRole("button", { name: "기본 글꼴" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "글꼴 파일 추가" })).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox", { name: "선생님의 한마디 글꼴" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "글꼴 파일 추가" })).toBeTruthy();
  });

  it("shows readable custom names, loaded previews, selected state, and per-font delete actions", () => {
    mocks.preference.fonts = [font("font-1", "NanumPenScript"), font("font-2", "My_Font")];
    mocks.preference.activeFontId = "font-1";
    mocks.preference.activeSource = "FILE";
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
    mocks.preference.activeSource = "FILE";
    mocks.preference.activeFontFamily = '"preview-font", sans-serif';
    render(<JournalTeacherCommentFontControl />);
    fireEvent.click(screen.getByRole("button", { name: "Nanum Pen Script" }));
    fireEvent.click(screen.getByRole("button", { name: "Nanum Pen Script 삭제" }));
    expect(mocks.remove).toHaveBeenCalledWith("font-1");
  });

  it("offers 18/20/22/24 presentation sizes without owning Journal persistence", () => {
    render(<JournalTeacherCommentFontControl />);
    expect(screen.getByRole("button", { name: "20" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "24" }));
    expect(mocks.selectSize).toHaveBeenCalledWith(24);
  });

  it("shows searchable system fonts only after explicit connection", () => {
    mocks.preference.systemFontStatus = "ready";
    mocks.preference.systemFonts = [{ postscriptName: "NanumPen", fullName: "나눔손글씨 펜", family: "Nanum Pen", style: "Regular" }];
    render(<JournalTeacherCommentFontControl />);
    fireEvent.click(screen.getByRole("button", { name: "기본 글꼴" }));
    fireEvent.change(screen.getByPlaceholderText("컴퓨터 글꼴 검색"), { target: { value: "나눔" } });
    fireEvent.click(screen.getByRole("option", { name: /나눔손글씨 펜/ }));
    expect(mocks.selectSystem).toHaveBeenCalledWith("NanumPen");
  });

  it.each([
    ["unsupported", "이 브라우저에서는 컴퓨터 글꼴 연결을 지원하지 않습니다"],
    ["denied", "컴퓨터 글꼴 권한이 허용되지 않았습니다"],
    ["missing", "이전에 사용한 컴퓨터 글꼴을 찾을 수 없습니다"],
    ["reconnect-required", "이전에 선택한 컴퓨터 글꼴을 사용하려면 다시 연결해 주세요"],
  ])("shows the %s system-font state without removing file-font fallback", (status, message) => {
    mocks.preference.systemFontStatus = status;
    render(<JournalTeacherCommentFontControl />);
    fireEvent.click(screen.getByRole("button", { name: "기본 글꼴" }));
    expect(screen.getByText(new RegExp(message))).toBeTruthy();
    expect(screen.getByRole("button", { name: "글꼴 파일 추가" })).toBeTruthy();
  });

  it("reconnects the persisted active system font from an explicit user action", () => {
    mocks.preference.activeSource = "SYSTEM";
    mocks.preference.activeSystemFont = { postscriptName: "NanumPen", fullName: "나눔손글씨 펜", family: "Nanum Pen", style: "Regular" };
    mocks.preference.systemFontStatus = "reconnect-required";
    render(<JournalTeacherCommentFontControl />);
    fireEvent.click(screen.getByRole("button", { name: "나눔손글씨 펜" }));
    fireEvent.click(screen.getByRole("button", { name: "컴퓨터 글꼴 다시 연결" }));
    expect(mocks.reconnect).toHaveBeenCalledTimes(1);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("does not own Journal persistence, version, audit, or request contracts", () => {
    const source = readFileSync(resolve(import.meta.dirname, "JournalTeacherCommentFontControl.tsx"), "utf8");
    expect(source).not.toMatch(/updateJournalEntryDraft|JournalAutosaveQueue|requestId|expectedVersion|entity_audit_events|supabase/);
  });
});
