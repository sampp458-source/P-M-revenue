// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOURNAL_AUTOSAVE_DELAY, JournalEditor } from "./JournalEditor";
import { JournalPersistenceError, type JournalPersistenceFailureKind } from "./journalPersistenceDiagnostics";
import { buildJournalPreviewViewModel } from "./journalPreviewViewModel";
import type { JournalDraft, JournalRosterEntry } from "./journalRepository";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  renderImage: vi.fn(),
  exportImage: vi.fn(),
  fontPreference: {
    status: "ready",
    fonts: [],
    activeFontId: null,
    activeFontFamily: "Pretendard, sans-serif",
    activeSource: "DEFAULT",
    activeSystemFont: null,
    systemFonts: [],
    systemFontStatus: "unsupported",
    fontSize: 20,
    error: "",
  },
}));

vi.mock("./journalCustomFont", () => ({
  JOURNAL_CUSTOM_FONT_ACCEPT: ".ttf,.otf,.woff,.woff2",
  useJournalCustomFontPreference: () => mocks.fontPreference,
  addJournalCustomFont: vi.fn(),
  deleteJournalCustomFont: vi.fn(),
  selectJournalCustomFont: vi.fn(),
  connectJournalSystemFonts: vi.fn(),
  selectJournalSystemFont: vi.fn(),
  selectJournalTeacherCommentFontSize: vi.fn(),
  journalCustomFontDisplayName: (value: string) => value,
  journalCustomFontPreviewFamily: () => undefined,
}));

vi.mock("./journalRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./journalRepository")>()),
  fetchJournalEntry: mocks.fetch,
  updateJournalEntryDraft: mocks.update,
  completeJournalEntry: mocks.complete,
}));

vi.mock("./journalExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./journalExport")>()),
  renderJournalImageBlob: mocks.renderImage,
  exportJournalImage: mocks.exportImage,
}));

const entry = (overrides: Partial<JournalRosterEntry> = {}): JournalRosterEntry => ({
  id: "entry-1",
  journalDayId: "day-1",
  businessDate: "2026-08-15",
  dog: { id: "dog-1", name: "크리미" },
  customer: { id: "customer-1", name: "박보호" },
  status: "NOT_STARTED",
  conditionCodes: [],
  urination: null,
  defecation: null,
  stoolCondition: null,
  mealCodes: [],
  teacherRelationship: null,
  friendRelationship: null,
  bestFriendDogId: null,
  mannersActivityName: null,
  mannersEvaluation: null,
  physicalActivityName: null,
  physicalEvaluation: null,
  teacherComment: null,
  version: 1,
  createdAt: "2026-08-15T00:00:00Z",
  updatedAt: "2026-08-15T00:00:00Z",
  ...overrides,
});

const roster = [
  entry(),
  entry({ id: "entry-2", dog: { id: "dog-2", name: "몽이" } }),
  entry({ id: "entry-3", dog: { id: "dog-3", name: "초코" }, status: "COMPLETED" }),
];

beforeEach(() => {
  mocks.renderImage.mockReset();
  mocks.exportImage.mockReset();
  mocks.fontPreference.fontSize = 20;
  mocks.fontPreference.activeSource = "DEFAULT";
  mocks.fontPreference.systemFontStatus = "unsupported";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const renderEditor = (
  target = roster[0],
  options: { onNavigate?: (entryId: string) => void; onClose?: () => void; onDelete?: (expectedVersion: number) => Promise<void>; rosterEntries?: JournalRosterEntry[] } = {},
) => render(
  <JournalEditor
    entry={target}
    rosterEntries={options.rosterEntries ?? roster}
    onDelete={options.onDelete}
    onEntryUpdate={vi.fn()}
    onNavigate={options.onNavigate ?? vi.fn()}
    onClose={options.onClose ?? vi.fn()}
  />,
);

function JournalEditorNavigationHarness({ initialEntryId = "entry-1" }: { initialEntryId?: string }) {
  const [activeEntryId, setActiveEntryId] = useState(initialEntryId);
  const activeEntry = roster.find((item) => item.id === activeEntryId) ?? roster[0];
  return (
    <JournalEditor
      key={activeEntry.id}
      entry={activeEntry}
      rosterEntries={roster}
      onEntryUpdate={vi.fn()}
      onNavigate={setActiveEntryId}
      onClose={vi.fn()}
    />
  );
}

function liveReport(dogName: string) {
  return within(screen.getByLabelText(`${dogName} 결과 미리보기`)).getByLabelText(`${dogName} 하루 일지 결과지`);
}

describe("Journal Editor", () => {
  it("hydrates server-created default selections without scheduling an initial autosave", async () => {
    const initialized = entry({
      conditionCodes: ["active"],
      urination: true,
      defecation: true,
      stoolCondition: "good",
      mealCodes: ["brought_food"],
      teacherRelationship: "loves_teacher",
      friendRelationship: "loves_friends",
      bestFriendTargets: [],
      bestFriendDogId: null,
      mannersActivityName: "기다려 교육",
      mannersEvaluation: "excellent",
      physicalActivityName: "공놀이",
      physicalEvaluation: "champion",
      teacherComment: null,
      status: "NOT_STARTED",
      version: 1,
    });
    mocks.fetch.mockResolvedValue(initialized);
    renderEditor(initialized);

    await screen.findByRole("heading", { name: "크리미" });
    await waitFor(() => expect(liveReport("크리미")).toBeTruthy());
    expect(screen.getByRole("button", { name: "활발해요" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "가져온 사료" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "선생님 너무 좋아요" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "친구 너무 좋아요" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "참 잘했어요" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "나는야 체육왕" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /선택 해제/ })).toBeNull();
    expect((screen.getByRole("textbox", { name: "선생님의 한마디" }) as HTMLTextAreaElement).value).toBe("");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, JOURNAL_AUTOSAVE_DELAY + 50));
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("never queues a 501-character snapshot after showing 500 / 500", async () => {
    const loaded = entry({ status: "IN_PROGRESS", version: 2 });
    mocks.fetch.mockResolvedValue(loaded);
    mocks.update.mockImplementation(async (_id, version, savedDraft) => entry({
      ...loaded,
      teacherComment: savedDraft.teacherComment,
      version: version + 1,
    }));
    renderEditor(loaded);
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });

    fireEvent.change(comment, { target: { value: "🐶".repeat(500) } });
    expect(screen.getByText("500 / 500")).toBeTruthy();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1), { timeout: JOURNAL_AUTOSAVE_DELAY + 1_000 });
    expect(mocks.update.mock.calls[0][2].teacherComment).toBe("🐶".repeat(500));

    fireEvent.change(comment, { target: { value: "🐶".repeat(501) } });
    expect((comment as HTMLTextAreaElement).value).toBe("🐶".repeat(500));
    expect(screen.getByText("500 / 500")).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, JOURNAL_AUTOSAVE_DELAY + 50));
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("fills the remaining canonical capacity from an emoji-heavy paste without native maxlength", async () => {
    const loaded = entry({ status: "IN_PROGRESS", version: 2, teacherComment: "가".repeat(484) });
    mocks.fetch.mockResolvedValue(loaded);
    mocks.update.mockImplementation(async (_id, version, savedDraft) => entry({
      ...loaded,
      teacherComment: savedDraft.teacherComment,
      version: version + 1,
    }));
    renderEditor(loaded);
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" }) as HTMLTextAreaElement;

    expect(comment.hasAttribute("maxlength")).toBe(false);
    fireEvent.change(comment, { target: { value: `${"가".repeat(484)}${"👨‍👩‍👧‍👦❤️🐶".repeat(10)}` } });

    expect(screen.getByText("500 / 500")).toBeTruthy();
    expect(Array.from(comment.value).length).toBe(500);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1), { timeout: JOURNAL_AUTOSAVE_DELAY + 1_000 });
    expect(Array.from(mocks.update.mock.calls[0][2].teacherComment).length).toBe(500);
  });

  it("keeps IME composition out of business autosave until the canonical value is committed", async () => {
    const loaded = entry({ status: "IN_PROGRESS", version: 2, teacherComment: "가".repeat(499) });
    mocks.fetch.mockResolvedValue(loaded);
    mocks.update.mockImplementation(async (_id, version, savedDraft) => entry({ ...loaded, ...savedDraft, version: version + 1 }));
    renderEditor(loaded);
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" }) as HTMLTextAreaElement;

    fireEvent.compositionStart(comment);
    fireEvent.change(comment, { target: { value: `${"가".repeat(499)}한글` } });
    expect(comment.value).toBe(`${"가".repeat(499)}한글`);
    expect(screen.getByText("499 / 500")).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();

    fireEvent.compositionEnd(comment, { data: "글" });
    expect(comment.value).toBe(`${"가".repeat(499)}한`);
    expect(screen.getByText("500 / 500")).toBeTruthy();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1), { timeout: JOURNAL_AUTOSAVE_DELAY + 1_000 });
    expect(mocks.update.mock.calls[0][2].teacherComment).toBe(`${"가".repeat(499)}한`);
  });

  it("renders the mobile-first typed controls and clears stool when defecation is NO", async () => {
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...draft, status: "IN_PROGRESS", version: version + 1 }));
    const { container } = renderEditor();
    await screen.findByRole("heading", { name: "크리미" });
    await waitFor(() => expect(liveReport("크리미")).toBeTruthy());
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "활발해요" }));
    const toiletEditor = screen.getByRole("heading", { name: "배변" }).closest("section")!;
    const defecationSection = within(toiletEditor).getByText("대변").parentElement!;
    fireEvent.click(defecationSection.querySelectorAll("button")[1]);
    expect(screen.getByRole("button", { name: "좋아요" }).hasAttribute("disabled")).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][2]).toMatchObject({ conditionCodes: ["active"], defecation: false, stoolCondition: null });
    expect(container.querySelector("[aria-label='크리미 일지 편집기']")?.className).toContain("overflow-x-hidden");
    expect(container.innerHTML).toContain("min-h-11");
    expect(container.querySelector("[aria-label='크리미 일지 편집기'] > div")?.className).toContain("xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,1fr)]");
    expect(screen.getByTestId("journal-report-preview").className).toContain("aspect-[3/4]");
    expect(liveReport("크리미").getAttribute("style")).toContain("width: 1080px");
    expect(screen.queryByTestId("journal-canonical-export-source")).toBeNull();
    expect(screen.getByLabelText("크리미 결과 미리보기").className).toContain("hidden");
    expect(screen.getByLabelText("크리미 결과 미리보기").className).toContain("xl:flex");
    expect(screen.getByRole("button", { name: "미리보기" })).toBeTruthy();
    expect(screen.queryByText("미리보기 준비 중")).toBeNull();
    expect(mocks.renderImage).not.toHaveBeenCalled();
  });

  it("builds a desktop sticky workspace with an independently scrolling form and ordered controls", async () => {
    const completed = entry({ status: "COMPLETED", version: 8 });
    mocks.fetch.mockResolvedValue(completed);
    renderEditor(completed, { onDelete: vi.fn().mockResolvedValue(undefined) });
    await screen.findByRole("heading", { name: "크리미" });

    const editor = screen.getByLabelText("크리미 일지 편집기");
    const formScroll = screen.getByTestId("journal-editor-form-scroll");
    const formGrid = screen.getByTestId("journal-editor-form-grid");
    const controlPanel = screen.getByTestId("journal-editor-control-panel");
    const previewViewport = screen.getByTestId("journal-editor-preview-viewport");
    const finalActions = screen.getByTestId("journal-editor-final-actions");

    expect(editor.className).toContain("max-w-[1600px]");
    expect(editor.className).toContain("xl:h-[calc(100dvh-110px)]");
    expect(formScroll.className).toContain("xl:overflow-y-auto");
    expect(formScroll.className).toContain("xl:pb-8");
    expect(formScroll.className).toContain("journal-editor-form-scrollbar");
    expect(formGrid.className).toContain("xl:grid-cols-2");
    expect(formGrid.className).toContain("xl:gap-2");
    expect(controlPanel.className).toContain("xl:sticky");
    expect(controlPanel.className).toContain("xl:overflow-hidden");
    expect(controlPanel.className).toContain("xl:grid-rows-[auto_auto_minmax(0,1fr)_auto]");
    expect(controlPanel.className).toContain("xl:gap-0.5");
    expect(controlPanel.className).toContain("journal-editor-control-panel");
    expect(previewViewport.className).toContain("min-h-0");
    expect(previewViewport.className).toContain("overflow-hidden");
    expect(previewViewport.className).toContain("journal-editor-preview-stage");
    expect(screen.getByTestId("journal-editor-preview-frame").className).toContain("journal-editor-preview-frame");
    expect(finalActions.className).toContain("xl:static");
    expect(finalActions.className).toContain("xl:p-1.5");
    expect(within(controlPanel).getByRole("button", { name: "목록" })).toBeTruthy();
    const navigationExport = screen.getByTestId("journal-editor-navigation-export");
    expect(navigationExport.className).toContain("xl:absolute");
    expect(within(navigationExport).getByLabelText("일지 이미지 저장").className).toContain("xl:mb-0");
    expect(within(navigationExport).getByRole("button", { name: "PNG 저장" }).className).toContain("min-h-11");
    expect(within(navigationExport).getByRole("button", { name: "JPG 저장" }).className).toContain("min-h-11");
    expect(within(controlPanel).getByRole("button", { name: "일지 삭제" })).toBeTruthy();
    expect(within(controlPanel).getByRole("button", { name: "작성 완료" })).toBeTruthy();
    expect(within(controlPanel).getByText("크리미 일지 완료")).toBeTruthy();
    const fullWidthHeadings = ["컨디션", "배변", "먹은 것", "관계", "제일 친한 친구", "선생님의 한마디"];
    fullWidthHeadings.forEach((heading) => {
      expect(within(formScroll).getByRole("heading", { name: heading }).parentElement?.className).toContain("xl:col-span-2");
    });
    const bestFriendSection = within(formScroll).getByRole("heading", { name: "제일 친한 친구" }).parentElement;
    const commentSection = within(formScroll).getByRole("heading", { name: "선생님의 한마디" }).parentElement;
    expect(bestFriendSection?.className).toContain("xl:col-span-2");
    expect(commentSection?.className).toContain("xl:col-span-2");
    expect(within(formScroll).getByRole("heading", { name: "관계" }).parentElement?.innerHTML).toContain("xl:grid-cols-2");
    expect(within(formScroll).getByRole("heading", { name: "배변" }).parentElement?.innerHTML).toContain("xl:grid-cols-4");
    expect(within(formScroll).getByRole("button", { name: "활발해요" }).className).toContain("xl:whitespace-nowrap");
    expect(within(formScroll).getByRole("button", { name: "선생님 너무 좋아요" }).className).toContain("xl:whitespace-nowrap");
  });

  it("uses a light selected state with a non-color check indicator", async () => {
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...draft, version: version + 1 }));
    renderEditor();
    const condition = await screen.findByRole("button", { name: "활발해요" });
    fireEvent.click(condition);
    expect(condition.getAttribute("aria-pressed")).toBe("true");
    expect(condition.className).toContain("bg-primary-soft");
    expect(condition.className).toContain("text-primary");
    expect(condition.className).not.toContain("bg-primary text-white");
    expect(condition.querySelector("svg")).toBeTruthy();
    const report = liveReport("크리미");
    expect(within(report).getByText("활발해요").closest("[data-selected]")?.getAttribute("data-selected")).toBe("true");
  });

  it("selects ordered same-day Dogs and Teacher through the searchable multi-select", async () => {
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockImplementation(async (_id, version, nextDraft) => entry({ ...nextDraft, version: version + 1 }));
    renderEditor();
    const search = await screen.findByRole("combobox", { name: "제일 친한 친구 검색" });
    fireEvent.focus(search);
    const results = await screen.findByRole("listbox", { name: "제일 친한 친구 검색 검색 결과" });
    const options = await within(results).findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["선생님", "몽이", "초코"]);
    expect(options.some((option) => option.textContent?.includes("크리미"))).toBe(false);
    fireEvent.click(within(results).getByRole("option", { name: "몽이" }));
    fireEvent.click(within(results).getByRole("option", { name: "선생님" }));
    expect(screen.getByRole("button", { name: "몽이 선택 해제" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "선생님 선택 해제" })).toBeTruthy();
    expect(screen.getByTestId("journal-best-friend-name").textContent).toBe("몽이, 선생님이에요 ♡");
    expect(screen.getByTestId("journal-best-friend-suffix").textContent).toContain("이에요");
  });

  it("searches only the current roster and fails closed after five selected targets", async () => {
    const extendedRoster = [
      entry(),
      entry({ id: "entry-2", dog: { id: "dog-2", name: "몽이" } }),
      entry({ id: "entry-3", dog: { id: "dog-3", name: "초코" } }),
      entry({ id: "entry-4", dog: { id: "dog-4", name: "먼지" } }),
      entry({ id: "entry-5", dog: { id: "dog-5", name: "건달" } }),
      entry({ id: "entry-6", dog: { id: "dog-6", name: "개똥이" } }),
    ];
    const loaded = entry({
      bestFriendTargets: [
        { type: "TEACHER", dogId: null },
        { type: "DOG", dogId: "dog-2" },
        { type: "DOG", dogId: "dog-3" },
        { type: "DOG", dogId: "dog-4" },
        { type: "DOG", dogId: "dog-5" },
      ],
    });
    mocks.fetch.mockResolvedValue(loaded);
    renderEditor(loaded, { rosterEntries: extendedRoster });
    const search = await screen.findByRole("combobox", { name: "제일 친한 친구 검색" });
    fireEvent.focus(search);
    const blocked = await screen.findByRole("option", { name: "개똥이" });
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("5/5 · 추가하려면 선택을 해제해 주세요.");
    fireEvent.change(search, { target: { value: "초코" } });
    await waitFor(() => expect(screen.getAllByRole("option").filter((option) => option.tagName === "BUTTON")).toHaveLength(1));
    expect(screen.getByRole("option", { name: "초코" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("option", { name: "크리미" })).toBeNull();
  });

  it("edits completed-entry targets through the same canonical autosave queue", async () => {
    const completed = entry({ status: "COMPLETED", version: 8, bestFriendTargets: [] });
    mocks.fetch.mockResolvedValue(completed);
    mocks.update.mockImplementation(async (_id, version, nextDraft) => entry({ ...completed, ...nextDraft, status: "COMPLETED", version: version + 1 }));
    renderEditor(completed);
    const search = await screen.findByRole("combobox", { name: "제일 친한 친구 검색" });
    fireEvent.focus(search);
    fireEvent.click(await screen.findByRole("option", { name: "선생님" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(
        completed.id,
        8,
        expect.objectContaining({ bestFriendTargets: [{ type: "TEACHER", dogId: null }] }),
        expect.any(String),
        expect.any(AbortSignal),
        "COMPLETED",
      ), { timeout: 2_000 });
  });

  it("hydrates the server-cleaned canonical targets after an editor reload", async () => {
    const stale = entry({ status: "COMPLETED", version: 8, bestFriendTargets: [{ type: "DOG", dogId: "dog-2" }, { type: "TEACHER", dogId: null }] });
    const refreshed = entry({ status: "COMPLETED", version: 9, bestFriendTargets: [{ type: "TEACHER", dogId: null }] });
    mocks.fetch.mockResolvedValueOnce(stale);
    const first = renderEditor(stale);
    expect(await screen.findByRole("button", { name: "몽이 선택 해제" })).toBeTruthy();
    first.unmount();
    mocks.fetch.mockResolvedValueOnce(refreshed);
    renderEditor(refreshed, { rosterEntries: [refreshed, roster[2]] });
    expect(await screen.findByRole("button", { name: "선생님 선택 해제" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "몽이 선택 해제" })).toBeNull();
    expect(screen.getByText("오늘의 일지를 모두 작성했습니다.")).toBeTruthy();
  });

  it("flushes the final local snapshot before completion and uses its latest version", async () => {
    const loaded = entry({
      status: "IN_PROGRESS", version: 5, conditionCodes: ["active"], urination: true,
      defecation: false, teacherRelationship: "loves_teacher", friendRelationship: "loves_friends",
      teacherComment: "기존 한마디",
    });
    mocks.fetch.mockResolvedValue(loaded);
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...loaded, ...draft, version: version + 1 }));
    mocks.complete.mockImplementation(async (_id, version) => entry({ ...loaded, teacherComment: "마지막 입력", status: "COMPLETED", version: version + 1 }));
    renderEditor(loaded);
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "마지막 입력" } });
    fireEvent.click(screen.getByRole("button", { name: "작성 완료" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith("entry-1", 6, expect.any(String), expect.any(AbortSignal)));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]);
  });

  it("persists and completes an exact 500-code-point emoji comment", async () => {
    const loaded = entry({
      status: "IN_PROGRESS", version: 5, conditionCodes: ["active"], urination: true,
      defecation: false, teacherRelationship: "loves_teacher", friendRelationship: "loves_friends",
      teacherComment: "기존 한마디",
    });
    mocks.fetch.mockResolvedValue(loaded);
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...loaded, ...draft, version: version + 1 }));
    mocks.complete.mockImplementation(async (_id, version) => entry({ ...loaded, teacherComment: "🐶".repeat(500), status: "COMPLETED", version: version + 1 }));
    renderEditor(loaded);
    fireEvent.change(await screen.findByRole("textbox", { name: "선생님의 한마디" }), { target: { value: "🐶".repeat(500) } });
    fireEvent.click(screen.getByRole("button", { name: "작성 완료" }));

    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith("entry-1", 6, expect.any(String), expect.any(AbortSignal)));
    expect(mocks.update.mock.calls[0][2].teacherComment).toBe("🐶".repeat(500));
    expect(screen.getByText("크리미 일지 완료")).toBeTruthy();
  });

  it("settles completion with an explicit save failure when repository validation throws synchronously", async () => {
    const loaded = entry({
      status: "IN_PROGRESS", version: 5, conditionCodes: ["active"], urination: true,
      defecation: false, teacherRelationship: "loves_teacher", friendRelationship: "loves_friends",
      teacherComment: "기존 한마디",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.fetch.mockResolvedValue(loaded);
    mocks.update.mockImplementation(() => { throw new Error("COMMENT_TOO_LONG"); });
    renderEditor(loaded);
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "가".repeat(500) } });
    fireEvent.click(screen.getByRole("button", { name: "작성 완료" }));

    expect(await screen.findByText("저장 중 오류가 발생했습니다.")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "작성 완료" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getAllByText(/저장 실패/).length).toBeGreaterThan(0);
    expect(mocks.complete).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("bounds a permanently pending completion request, unlocks the editor, and exposes a diagnostic ID", async () => {
    const loaded = entry({
      status: "IN_PROGRESS", version: 5, conditionCodes: ["active"], urination: true,
      defecation: false, teacherRelationship: "loves_teacher", friendRelationship: "loves_friends",
      teacherComment: "완료 직전 한마디",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.fetch.mockResolvedValue(loaded);
    mocks.complete
      .mockImplementationOnce((_id, _version, _requestId, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }))
      .mockResolvedValueOnce(entry({ ...loaded, status: "COMPLETED", version: 6 }));
    renderEditor(loaded);
    await screen.findByRole("heading", { name: "크리미" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "작성 완료" }));
    expect((screen.getByRole("button", { name: "작성 완료" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("완료 처리 중...").length).toBeGreaterThan(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByText(/작성 완료 요청 시간이 초과되었습니다. · JRN-COMPLETE-/)).toBeTruthy();
    expect(screen.getAllByText("완료 처리 시간 초과 · 다시 시도").length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "작성 완료" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("textbox", { name: "선생님의 한마디" }) as HTMLTextAreaElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "다음" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: /진단 정보 복사/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "작성 완료" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText("크리미 일지 완료")).toBeTruthy();
    expect(mocks.complete.mock.calls[1][2]).toBe(mocks.complete.mock.calls[0][2]);
    consoleError.mockRestore();
  });

  it("coalesces rapid completion clicks into one RPC and one request ID", async () => {
    let resolveCompletion!: (value: JournalRosterEntry) => void;
    const pending = new Promise<JournalRosterEntry>((resolve) => { resolveCompletion = resolve; });
    const loaded = entry({ status: "IN_PROGRESS", version: 5, teacherComment: "완료할 내용" });
    mocks.fetch.mockResolvedValue(loaded);
    mocks.complete.mockReturnValue(pending);
    renderEditor(loaded);
    await screen.findByRole("heading", { name: "크리미" });
    const completeButton = screen.getByRole("button", { name: "작성 완료" });
    fireEvent.click(completeButton);
    fireEvent.click(completeButton);
    fireEvent.click(completeButton);
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(1));
    expect(mocks.complete.mock.calls[0][2]).toEqual(expect.any(String));
    resolveCompletion(entry({ ...loaded, status: "COMPLETED", version: 6 }));
    await waitFor(() => expect(screen.getByText("크리미 일지 완료")).toBeTruthy());
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it("aborts an outstanding completion on unmount without applying its late result", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let requestSignal: AbortSignal | undefined;
    let resolveLate!: (value: JournalRosterEntry) => void;
    const pending = new Promise<JournalRosterEntry>((resolve) => { resolveLate = resolve; });
    const loaded = entry({ status: "IN_PROGRESS", version: 5, teacherComment: "완료할 내용" });
    const onEntryUpdate = vi.fn();
    mocks.fetch.mockResolvedValue(loaded);
    mocks.complete.mockImplementation((_id, _version, _requestId, signal: AbortSignal) => {
      requestSignal = signal;
      return pending;
    });
    const rendered = render(
      <JournalEditor entry={loaded} rosterEntries={roster} onEntryUpdate={onEntryUpdate} onNavigate={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: "크리미" });
    fireEvent.click(screen.getByRole("button", { name: "작성 완료" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(1));
    rendered.unmount();
    expect(requestSignal?.aborted).toBe(true);
    resolveLate(entry({ ...loaded, status: "COMPLETED", version: 6 }));
    await act(async () => { await Promise.resolve(); });
    expect(onEntryUpdate).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps autosave and business completion available while blocking image export on presentation overflow", async () => {
    const loaded = entry({ status: "IN_PROGRESS", version: 5, teacherComment: "가".repeat(500) });
    mocks.fontPreference.fontSize = 24;
    mocks.fetch.mockResolvedValue(loaded);
    mocks.complete.mockResolvedValue(entry({ ...loaded, status: "COMPLETED", version: 6 }));
    renderEditor(loaded);
    expect(await screen.findByText(/현재 내용이 일지 영역을/)).toBeTruthy();
    expect(screen.getByText(/작성 내용 저장과 작성 완료는 가능하지만 이미지 저장은/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "작성 완료" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "PNG 저장" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "JPG 저장" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "작성 완료" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith("entry-1", 5, expect.any(String), expect.any(AbortSignal)));
  });

  it("keeps business completion available while a selected system font requires reconnection", async () => {
    const loaded = entry({ status: "IN_PROGRESS", version: 7, teacherComment: "오늘도 즐겁게 지냈어요." });
    mocks.fontPreference.activeSource = "SYSTEM";
    mocks.fontPreference.systemFontStatus = "reconnect-required";
    mocks.fetch.mockResolvedValue(loaded);
    mocks.complete.mockResolvedValue(entry({ ...loaded, status: "COMPLETED", version: 8 }));
    renderEditor(loaded);
    expect(await screen.findByText(/작성 내용 저장과 작성 완료는 계속 사용할 수 있습니다/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "작성 완료" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "PNG 저장" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "작성 완료" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith("entry-1", 7, expect.any(String), expect.any(AbortSignal)));
  });

  it("locks editing during completion so a stale draft cannot overwrite the completed result", async () => {
    let finishCompletion!: (value: JournalRosterEntry) => void;
    const completing = new Promise<JournalRosterEntry>((resolve) => { finishCompletion = resolve; });
    const loaded = entry({ status: "IN_PROGRESS", version: 3, teacherComment: "저장 전" });
    mocks.fetch.mockResolvedValue(loaded);
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...loaded, ...draft, version: version + 1 }));
    mocks.complete.mockReturnValue(completing);
    renderEditor(loaded);
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "완료할 내용" } });
    fireEvent.click(screen.getByRole("button", { name: "작성 완료" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith("entry-1", 4, expect.any(String), expect.any(AbortSignal)));
    expect((comment.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.change(comment, { target: { value: "완료 중 stale 입력" } });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    finishCompletion(entry({ ...loaded, teacherComment: "완료할 내용", status: "COMPLETED", version: 5 }));
    await waitFor(() => expect(screen.getByText("크리미 일지 완료")).toBeTruthy());
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["NOT_STARTED", "등록된 일지가 삭제되며 복구할 수 없습니다."],
    ["IN_PROGRESS", "작성 중인 내용이 함께 삭제되며 복구할 수 없습니다."],
    ["COMPLETED", "완료된 일지가 삭제되며 복구할 수 없습니다."],
  ] as const)("offers an exact destructive confirmation for %s entries", async (status, detail) => {
    const target = entry({ status });
    const onDelete = vi.fn().mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue(target);
    renderEditor(target, { onDelete });
    await screen.findByRole("heading", { name: "크리미" });
    fireEvent.click(screen.getByRole("button", { name: "일지 삭제" }));
    const dialog = screen.getByRole("dialog", { name: "일지 삭제" });
    expect(dialog.textContent).toContain("크리미의 2026. 08. 15. 일지를 삭제할까요?");
    expect(dialog.textContent).toContain(detail);
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(1));
  });

  it("flushes an in-flight edit before deleting and passes the latest version", async () => {
    const target = entry({ status: "IN_PROGRESS", version: 4 });
    const onDelete = vi.fn().mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue(target);
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...target, ...draft, version: version + 1 }));
    renderEditor(target, { onDelete });
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "삭제 직전 저장" } });
    fireEvent.click(screen.getByRole("button", { name: "일지 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "일지 삭제" })).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(5));
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(onDelete.mock.invocationCallOrder[0]);
  });

  it("locks editing during deletion so no autosave can resurrect the removed entry", async () => {
    let finishDelete!: () => void;
    const deleting = new Promise<void>((resolve) => { finishDelete = resolve; });
    const target = entry({ status: "IN_PROGRESS", version: 4 });
    const onDelete = vi.fn().mockReturnValue(deleting);
    mocks.fetch.mockResolvedValue(target);
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...target, ...draft, version: version + 1 }));
    renderEditor(target, { onDelete });
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "삭제 전 마지막 저장" } });
    fireEvent.click(screen.getByRole("button", { name: "일지 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "일지 삭제" })).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(5));
    expect((comment.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.change(comment, { target: { value: "삭제 중 stale 입력" } });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    finishDelete();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "일지 삭제" })).toBeNull());
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("flushes before moving to the next Dog", async () => {
    const onNavigate = vi.fn();
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...draft, version: version + 1 }));
    render(<JournalEditor entry={roster[0]} rosterEntries={roster} onEntryUpdate={vi.fn()} onNavigate={onNavigate} onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "크리미" });
    fireEvent.click(screen.getByRole("button", { name: "평온해요" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("entry-2"));
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("navigates without invoking any preview rasterizer", async () => {
    const onNavigate = vi.fn();
    mocks.fetch.mockResolvedValue(entry());
    renderEditor(roster[0], { onNavigate });
    await screen.findByRole("heading", { name: "크리미" });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("entry-2"));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.renderImage).not.toHaveBeenCalled();
  });

  it("accepts navigation during an autosave, shows immediate feedback, and waits only for save integrity", async () => {
    let finishSave!: (value: JournalRosterEntry) => void;
    const saving = new Promise<JournalRosterEntry>((resolve) => { finishSave = resolve; });
    const onNavigate = vi.fn();
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockReturnValue(saving);
    renderEditor(roster[0], { onNavigate });
    await screen.findByRole("heading", { name: "크리미" });
    fireEvent.change(screen.getByRole("textbox", { name: "선생님의 한마디" }), { target: { value: "이동 직전 저장" } });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    const nextButton = screen.getByRole("button", { name: "다음" });
    expect(nextButton.getAttribute("aria-busy")).toBe("true");
    expect(nextButton.hasAttribute("disabled")).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
    finishSave(entry({ teacherComment: "이동 직전 저장", status: "IN_PROGRESS", version: 2 }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("entry-2"));
    expect(mocks.update).toHaveBeenCalledWith(
      "entry-1",
      1,
      expect.objectContaining({ teacherComment: "이동 직전 저장" }),
      expect.any(String),
      expect.any(AbortSignal),
      "NOT_STARTED",
    );
  });

  it("stops navigation after 20 seconds, preserves input, and exposes recoverable actions", async () => {
    const onClose = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockImplementation(() => new Promise(() => undefined));
    renderEditor(roster[0], { onClose });
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    vi.useFakeTimers();
    fireEvent.change(comment, { target: { value: "사라지면 안 되는 입력" } });
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("저장을 완료하지 못했습니다.")).toBeTruthy();
    expect(screen.getByText("입력 내용은 현재 화면에 유지됩니다.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "선생님의 한마디" }) as HTMLTextAreaElement).value).toBe("사라지면 안 되는 입력");
    expect(screen.getByRole("button", { name: "목록" }).getAttribute("aria-busy")).toBe("false");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "계속 작성" })).toBeTruthy();
    expect(screen.getAllByText(/TIMEOUT · JRN-SAVE-[A-F0-9]{8}/).length).toBeGreaterThan(0);
    consoleError.mockRestore();
  });

  it("copies a bounded validation snapshot without Journal business content", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const onClose = vi.fn();
    const target = entry({
      status: "COMPLETED", version: 17, conditionCodes: ["active"], urination: true,
      defecation: true, stoolCondition: "good", teacherRelationship: "loves_teacher",
      friendRelationship: "loves_friends", mannersActivityName: "private manners activity",
      mannersEvaluation: null, physicalActivityName: "private physical activity",
      physicalEvaluation: "fun", teacherComment: "private teacher comment",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.fetch.mockResolvedValue(target);
    mocks.update.mockRejectedValue(new JournalPersistenceError(
      "VALIDATION", "update_journal_entry_draft", "entry-1", "COMPLETED", 17, "request-runtime",
      { httpStatus: 400, postgresCode: "22023", message: "활동명과 평가는 함께 입력해 주세요.", details: "private details", hint: "private hint" },
    ));
    renderEditor(target, { onClose });
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "unsaved private content" } });
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    await screen.findByText("저장을 완료하지 못했습니다.");
    fireEvent.click(screen.getAllByRole("button", { name: /진단 정보 복사/ })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("POSTGRES_CODE: 22023");
    expect(copied).toContain("SERVER_MESSAGE: 활동명과 평가는 함께 입력해 주세요.");
    expect(copied).toContain("ASSERTION_KEY: ACTIVITY_PAIR_INVALID");
    expect(copied).toContain("MANNERS_ACTIVITY_LENGTH:");
    expect(copied).not.toContain("private manners activity");
    expect(copied).not.toContain("private physical activity");
    expect(copied).not.toContain("unsaved private content");
    expect(copied).not.toContain("private details");
    expect(copied).not.toContain("private hint");
    consoleError.mockRestore();
  });

  it("retries a timed-out revision with the same request ID and then navigates", async () => {
    const onClose = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.fetch.mockResolvedValue(entry());
    mocks.update
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(entry({ status: "IN_PROGRESS", teacherComment: "보존", version: 2 }));
    renderEditor(roster[0], { onClose });
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    vi.useFakeTimers();
    fireEvent.change(comment, { target: { value: "보존" } });
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    const firstRequestId = mocks.update.mock.calls[0][3];
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[1][3]).toBe(firstRequestId);
    expect(onClose).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it.each([
    ["VERSION_CONFLICT", "PT409", 409],
    ["PERMISSION", "42501", 403],
    ["SERVER", "P0001", 500],
  ] as const)("shows safe %s evidence, preserves input, and blocks navigation", async (kind, postgresCode, httpStatus) => {
    const onClose = vi.fn();
    const target = entry({ status: "COMPLETED", version: 17, teacherComment: "saved" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.fetch.mockResolvedValue(target);
    mocks.update.mockRejectedValue(new JournalPersistenceError(
      kind as JournalPersistenceFailureKind,
      "update_journal_entry_draft",
      "entry-1",
      "COMPLETED",
      17,
      "request-runtime",
      { httpStatus, postgresCode, message: "raw server message", details: "raw details", hint: "raw hint" },
    ));
    renderEditor(target, { onClose });
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "unsaved local content" } });
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    await screen.findByText("저장을 완료하지 못했습니다.");
    expect(onClose).not.toHaveBeenCalled();
    expect((comment as HTMLTextAreaElement).value).toBe("unsaved local content");
    expect(screen.getByRole("button", { name: "목록" }).getAttribute("aria-busy")).toBe("false");
    expect(screen.getAllByText(new RegExp(`${kind} · JRN-SAVE-[A-F0-9]{8}`)).length).toBeGreaterThan(0);
    expect(screen.queryByText("raw server message")).toBeNull();
    expect(screen.queryByText("raw details")).toBeNull();
    const retry = screen.getByRole("button", { name: kind === "VERSION_CONFLICT" ? "최신 상태 확인 필요" : "다시 시도" });
    expect((retry as HTMLButtonElement).disabled).toBe(kind === "VERSION_CONFLICT");
    if (kind === "VERSION_CONFLICT") {
      fireEvent.click(retry);
      expect(mocks.update).toHaveBeenCalledTimes(1);
    }
    expect(mocks.update.mock.calls[0][1]).toBe(17);
    expect(mocks.update.mock.calls[0][5]).toBe("COMPLETED");
    consoleError.mockRestore();
  });

  it.each([
    ["ABORT", new DOMException("aborted", "AbortError")],
    ["NETWORK", new TypeError("Failed to fetch")],
    ["UNKNOWN", new Error("unclassified")],
  ] as const)("classifies client failure as %s without losing local input", async (kind, failure) => {
    const onClose = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockRejectedValue(failure);
    renderEditor(roster[0], { onClose });
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "preserved" } });
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    await screen.findByText("저장을 완료하지 못했습니다.");
    expect((comment as HTMLTextAreaElement).value).toBe("preserved");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getAllByText(new RegExp(`${kind} · JRN-SAVE-[A-F0-9]{8}`)).length).toBeGreaterThan(0);
    consoleError.mockRestore();
  });

  it("saves an edit made during navigation flush before moving", async () => {
    let finishFirst!: (value: JournalRosterEntry) => void;
    const firstSave = new Promise<JournalRosterEntry>((resolve) => { finishFirst = resolve; });
    const onClose = vi.fn();
    mocks.fetch.mockResolvedValue(entry());
    mocks.update
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(entry({ teacherComment: "최신 두 번째 입력", version: 3 }));
    renderEditor(roster[0], { onClose });
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "첫 입력" } });
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    fireEvent.change(comment, { target: { value: "최신 두 번째 입력" } });
    finishFirst(entry({ teacherComment: "첫 입력", version: 2 }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[1][2]).toMatchObject({ teacherComment: "최신 두 번째 입력" });
    expect(mocks.update.mock.calls[1][1]).toBe(2);
  });

  it("joins duplicate List clicks without starting another save", async () => {
    let finishSave!: (value: JournalRosterEntry) => void;
    const saving = new Promise<JournalRosterEntry>((resolve) => { finishSave = resolve; });
    const onClose = vi.fn();
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockReturnValue(saving);
    renderEditor(roster[0], { onClose });
    fireEvent.change(await screen.findByRole("textbox", { name: "선생님의 한마디" }), { target: { value: "한 번만 저장" } });
    const list = screen.getByRole("button", { name: "목록" });
    fireEvent.click(list);
    fireEvent.click(list);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    finishSave(entry({ teacherComment: "한 번만 저장", version: 2 }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["이전", roster[1], "entry-1"],
    ["목록", roster[0], null],
  ] as const)("flushes pending input before %s navigation", async (buttonName, target, destination) => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    mocks.fetch.mockResolvedValue(target);
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...target, ...draft, version: version + 1 }));
    renderEditor(target, { onNavigate, onClose });
    await screen.findByRole("heading", { name: target.dog.name });
    fireEvent.change(screen.getByRole("textbox", { name: "선생님의 한마디" }), { target: { value: `${buttonName} 직전 저장` } });
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
    if (destination) await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(destination));
    else await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("flushes the last selected option before List navigation", async () => {
    const onClose = vi.fn();
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...draft, version: version + 1 }));
    renderEditor(roster[0], { onClose });
    await screen.findByRole("heading", { name: "크리미" });
    fireEvent.click(screen.getByRole("button", { name: "활발해요" }));
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][2]).toMatchObject({ conditionCodes: ["active"] });
  });

  it("renders each navigated entry immediately across A to B to A", async () => {
    mocks.fetch.mockImplementation(async (id: string) => roster.find((item) => item.id === id)!);
    render(<JournalEditorNavigationHarness />);
    await waitFor(() => expect(liveReport("크리미")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(liveReport("몽이")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await waitFor(() => expect(liveReport("크리미")).toBeTruthy());
    expect(screen.queryByText("미리보기 준비 중")).toBeNull();
    expect(mocks.renderImage).not.toHaveBeenCalled();
  });

  it("keeps text and layout visible when one approved illustration fails", async () => {
    mocks.fetch.mockResolvedValue(entry());
    renderEditor();
    await waitFor(() => expect(liveReport("크리미")).toBeTruthy());
    const report = liveReport("크리미");
    const illustration = within(report).getByTestId("journal-character-dogAWaving");
    fireEvent.error(illustration);
    expect(illustration.style.visibility).toBe("hidden");
    expect(within(report).getByText("크리미")).toBeTruthy();
    expect(report.getAttribute("style")).toContain("height: 1440px");
    expect(mocks.renderImage).not.toHaveBeenCalled();
  });

  it("reopens a completed entry for valid editing and offers the next unfinished Dog", async () => {
    const completed = entry({
      status: "COMPLETED", version: 8, conditionCodes: ["calm"], urination: true,
      defecation: true, stoolCondition: "good", teacherRelationship: "loves_teacher",
      friendRelationship: "loves_friends", teacherComment: "완료 일지",
    });
    mocks.fetch.mockResolvedValue(completed);
    renderEditor(completed);
    expect(await screen.findByText("크리미 일지 완료")).toBeTruthy();
    expect(screen.getByRole("button", { name: /다음 미작성 · 몽이/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "선생님의 한마디" }).hasAttribute("disabled")).toBe(false);
  });

  it("builds the future preview model from the latest local draft without waiting for persistence", () => {
    const initial = entry({ teacherComment: "저장된 내용", conditionCodes: ["calm"] });
    const latestDraft: JournalDraft = {
      conditionCodes: ["active"],
      urination: true,
      defecation: false,
      stoolCondition: null,
      mealCodes: ["daycare_food"],
      teacherRelationship: "loves_teacher",
      friendRelationship: "loves_friends",
      bestFriendDogId: null,
      mannersActivityName: "기다려",
      mannersEvaluation: "excellent",
      physicalActivityName: "노즈워크",
      physicalEvaluation: "fun",
      teacherComment: "아직 저장되지 않은 최신 입력",
    };
    const preview = buildJournalPreviewViewModel(initial, latestDraft);
    expect(preview.teacherComment).toBe("아직 저장되지 않은 최신 입력");
    expect(preview.conditionOptions.find((option) => option.code === "active")?.selected).toBe(true);
    expect(preview.entryId).toBe("entry-1");
  });

  it("reflects a local Teacher Comment in the live DOM before autosave or export", async () => {
    mocks.fetch.mockResolvedValue(entry({ teacherComment: "저장된 내용" }));
    renderEditor();
    await waitFor(() => expect(liveReport("크리미")).toBeTruthy());
    fireEvent.change(screen.getByRole("textbox", { name: "선생님의 한마디" }), {
      target: { value: "즉시 보이는 최신 입력" },
    });
    expect(within(liveReport("크리미")).getByText("즉시 보이는 최신 입력")).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.renderImage).not.toHaveBeenCalled();
    expect(mocks.exportImage).not.toHaveBeenCalled();
  });

  it("opens the canonical report in the mobile and tablet preview modal", async () => {
    mocks.fetch.mockResolvedValue(entry());
    renderEditor();
    await screen.findByRole("heading", { name: "크리미" });
    await waitFor(() => expect(liveReport("크리미")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));
    expect(screen.getByRole("dialog", { name: "결과 미리보기" })).toBeTruthy();
    expect(screen.getAllByTestId("journal-report-preview")).toHaveLength(2);
    expect(screen.getAllByLabelText("크리미 하루 일지 결과지")).toHaveLength(2);
    expect(mocks.renderImage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog", { name: "결과 미리보기" })).toBeNull();
  });

  it("exports the latest local draft as PNG without waiting for autosave or changing status", async () => {
    mocks.fetch.mockResolvedValue(entry({ teacherComment: "저장된 내용" }));
    mocks.exportImage.mockResolvedValue(undefined);
    renderEditor();
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "아직 저장되지 않은 최신 내용" } });
    const save = screen.getByRole("button", { name: "PNG 저장" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(mocks.exportImage).toHaveBeenCalledTimes(1));
    expect(mocks.exportImage.mock.calls[0][0]).toMatchObject({ teacherComment: "아직 저장되지 않은 최신 내용" });
    expect(mocks.exportImage.mock.calls[0][1]).toBe("png");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("keeps autosave and List navigation independent while a Canvas export is in flight", async () => {
    const loaded = entry({ status: "IN_PROGRESS", version: 4, teacherComment: "저장 전" });
    mocks.fetch.mockResolvedValue(loaded);
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...loaded, ...draft, version: version + 1 }));
    let finishExport!: () => void;
    mocks.exportImage.mockImplementation(() => new Promise<void>((resolve) => { finishExport = resolve; }));
    const onClose = vi.fn();
    renderEditor(loaded, { onClose });
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.click(screen.getByRole("button", { name: "PNG 저장" }));
    await waitFor(() => expect(mocks.exportImage).toHaveBeenCalledTimes(1));
    fireEvent.change(comment, { target: { value: "export 중 저장할 최신 입력" } });
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(
      "entry-1",
      4,
      expect.objectContaining({ teacherComment: "export 중 저장할 최신 입력" }),
      expect.any(String),
      expect.any(AbortSignal),
      "IN_PROGRESS",
    ));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    finishExport();
    await waitFor(() => expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(false));
  });

  it("guards duplicate export clicks, exposes loading, and recovers after an error", async () => {
    mocks.fetch.mockResolvedValue(entry());
    let rejectExport!: (error: Error) => void;
    mocks.exportImage.mockImplementation(() => new Promise((_resolve, reject) => { rejectExport = reject; }));
    renderEditor();
    await screen.findByRole("heading", { name: "크리미" });
    const png = screen.getByRole("button", { name: "PNG 저장" });
    await waitFor(() => expect(png.hasAttribute("disabled")).toBe(false));
    fireEvent.click(png);
    fireEvent.click(png);
    await waitFor(() => expect(mocks.exportImage).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "이미지 만드는 중..." }).hasAttribute("disabled")).toBe(true);
    rejectExport(new Error("raster failed"));
    expect((await screen.findByRole("alert")).textContent).toBe("이미지를 저장하지 못했습니다. 다시 시도해 주세요.");
    expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps the DOM preview visible but fails export closed when an approved illustration cannot be embedded", async () => {
    mocks.fetch.mockResolvedValue(entry());
    mocks.exportImage.mockRejectedValue(new Error("JOURNAL_EXPORT_ASSET_INLINE_FAILED"));
    renderEditor();
    await screen.findByRole("heading", { name: "크리미" });
    expect(liveReport("크리미")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "PNG 저장" }));
    expect((await screen.findByRole("alert")).textContent).toBe("이미지를 저장하지 못했습니다. 다시 시도해 주세요.");
    expect(liveReport("크리미")).toBeTruthy();
  });

  it("offers PNG and JPG export inside the mobile preview for completed journals", async () => {
    mocks.fetch.mockResolvedValue(entry({ status: "COMPLETED" }));
    mocks.exportImage.mockResolvedValue(undefined);
    renderEditor(entry({ status: "COMPLETED" }));
    await screen.findByRole("heading", { name: "크리미" });
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));
    const dialog = screen.getByRole("dialog", { name: "결과 미리보기" });
    const jpg = within(dialog).getByRole("button", { name: "JPG 저장" });
    await waitFor(() => expect(jpg.hasAttribute("disabled")).toBe(false));
    fireEvent.click(jpg);
    await waitFor(() => expect(mocks.exportImage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "COMPLETED" }),
      "jpg",
    ));
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
