// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalEditor } from "./JournalEditor";
import { buildJournalPreviewViewModel } from "./journalPreviewViewModel";
import type { JournalDraft, JournalRosterEntry } from "./journalRepository";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  renderImage: vi.fn(),
  exportImage: vi.fn(),
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

vi.mock("./journalAssetSources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./journalAssetSources")>()),
  loadEmbeddedJournalAssetSources: vi.fn().mockResolvedValue({
    "header-dog-a": "data:image/png;base64,YQ==",
    "header-dog-b": "data:image/png;base64,Yg==",
    "best-friend-duo": "data:image/png;base64,Yw==",
    meal: "data:image/png;base64,ZA==",
    manners: "data:image/png;base64,ZQ==",
    physical: "data:image/png;base64,Zg==",
    "teacher-comment-dog": "data:image/png;base64,Zw==",
    "official-logo": "data:image/png;base64,aA==",
  }),
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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const renderEditor = (
  target = roster[0],
  options: { onNavigate?: (entryId: string) => void; onClose?: () => void; onDelete?: (expectedVersion: number) => Promise<void> } = {},
) => render(
  <JournalEditor
    entry={target}
    rosterEntries={roster}
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
    expect(container.querySelector("[aria-label='크리미 일지 편집기'] > div")?.className).toContain("xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]");
    expect(screen.getByTestId("journal-report-preview").className).toContain("aspect-[3/4]");
    expect(liveReport("크리미").getAttribute("style")).toContain("width: 1080px");
    expect(screen.queryByTestId("journal-canonical-export-source")).toBeNull();
    expect(screen.getByLabelText("크리미 결과 미리보기").className).toContain("hidden");
    expect(screen.getByLabelText("크리미 결과 미리보기").className).toContain("xl:block");
    expect(screen.getByRole("button", { name: "미리보기" })).toBeTruthy();
    expect(screen.queryByText("미리보기 준비 중")).toBeNull();
    expect(mocks.renderImage).not.toHaveBeenCalled();
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
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith("entry-1", 6));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]);
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
    expect(mocks.update).toHaveBeenCalledWith("entry-1", 1, expect.objectContaining({ teacherComment: "이동 직전 저장" }));
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
    expect((mocks.exportImage.mock.calls[0][0] as HTMLElement).dataset.testid).toBe("journal-export-template");
    expect(Array.from((mocks.exportImage.mock.calls[0][0] as HTMLElement).querySelectorAll<HTMLImageElement>("img")).every((image) => image.src.startsWith("data:image/png"))).toBe(true);
    expect(mocks.exportImage.mock.calls[0][1]).toMatchObject({ teacherComment: "아직 저장되지 않은 최신 내용" });
    expect(mocks.exportImage.mock.calls[0][2]).toBe("png");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
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
      expect.any(HTMLElement),
      expect.objectContaining({ status: "COMPLETED" }),
      "jpg",
    ));
    expect((mocks.exportImage.mock.calls[0][0] as HTMLElement).dataset.testid).toBe("journal-export-template");
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
