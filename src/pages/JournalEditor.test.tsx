// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalEditor } from "./JournalEditor";
import {
  JOURNAL_ASSET_VERSION,
  JOURNAL_RENDERER_VERSION,
  JOURNAL_TEMPLATE_VERSION,
} from "./journalRenderContract";
import { buildJournalPreviewViewModel } from "./journalPreviewViewModel";
import type { JournalDraft, JournalRosterEntry } from "./journalRepository";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  renderImage: vi.fn(),
  exportPreview: vi.fn(),
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
  exportJournalPreviewImage: mocks.exportPreview,
}));

const previewBlob = new Blob(["canonical-preview"], { type: "image/png" });

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
  mocks.renderImage.mockReset().mockResolvedValue(previewBlob);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:canonical-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const renderEditor = (
  target = roster[0],
  options: { onNavigate?: (entryId: string) => void; onClose?: () => void } = {},
) => render(
  <JournalEditor
    entry={target}
    rosterEntries={roster}
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

describe("Journal Editor", () => {
  it("renders the mobile-first typed controls and clears stool when defecation is NO", async () => {
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...draft, status: "IN_PROGRESS", version: version + 1 }));
    const { container } = renderEditor();
    await screen.findByRole("heading", { name: "크리미" });
    await screen.findByRole("img", { name: "크리미 하루일지 미리보기" });
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
    expect(screen.getByTestId("journal-raster-preview").className).toContain("aspect-[3/4]");
    expect(screen.getByTestId("journal-report-template").getAttribute("style")).toContain("width: 1080px");
    expect(screen.getByTestId("journal-canonical-preview-source").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByLabelText("크리미 결과 미리보기").className).toContain("hidden");
    expect(screen.getByLabelText("크리미 결과 미리보기").className).toContain("xl:block");
    expect(screen.getByRole("button", { name: "미리보기" })).toBeTruthy();
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
    const report = screen.getByTestId("journal-report-template");
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

  it("starts next navigation without waiting for an in-flight preview raster", async () => {
    const onNavigate = vi.fn();
    mocks.fetch.mockResolvedValue(entry());
    mocks.renderImage.mockImplementation(() => new Promise(() => undefined));
    renderEditor(roster[0], { onNavigate });
    await screen.findByRole("heading", { name: "크리미" });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("entry-2"));
    expect(mocks.update).not.toHaveBeenCalled();
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

  it("keeps editor navigation available when preview generation fails", async () => {
    const onClose = vi.fn();
    mocks.fetch.mockResolvedValue(entry());
    mocks.renderImage.mockRejectedValue(new Error("preview failed"));
    renderEditor(roster[0], { onClose });
    await screen.findByRole("heading", { name: "크리미" });
    expect((await screen.findByRole("alert")).textContent).toBe("미리보기를 만들지 못했습니다. 다시 시도해 주세요.");
    expect(screen.getByRole("button", { name: "재시도" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("returns every navigated entry from preparing to ready across A to B to A", async () => {
    mocks.fetch.mockImplementation(async (id: string) => roster.find((item) => item.id === id)!);
    render(<JournalEditorNavigationHarness />);
    await screen.findByRole("img", { name: "크리미 하루일지 미리보기" });

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByRole("img", { name: "몽이 하루일지 미리보기" });

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await screen.findByRole("img", { name: "크리미 하루일지 미리보기" });
    expect(screen.queryByText("미리보기 준비 중")).toBeNull();
  });

  it("lets a newly active B entry reach ready while the unmounted A render is still pending", async () => {
    mocks.fetch.mockImplementation(async (id: string) => roster.find((item) => item.id === id)!);
    mocks.renderImage
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(previewBlob);
    render(<JournalEditorNavigationHarness />);
    await screen.findByRole("heading", { name: "크리미" });
    expect(screen.getByText("미리보기 준비 중")).toBeTruthy();
    await waitFor(() => expect(mocks.renderImage).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByRole("img", { name: "몽이 하루일지 미리보기" });
    expect(screen.queryByText("미리보기 준비 중")).toBeNull();
  });

  it("moves from preview error through retry to ready", async () => {
    mocks.fetch.mockResolvedValue(entry());
    mocks.renderImage.mockRejectedValueOnce(new Error("raster failed")).mockResolvedValueOnce(previewBlob);
    renderEditor();
    expect((await screen.findByRole("alert")).textContent).toBe("미리보기를 만들지 못했습니다. 다시 시도해 주세요.");
    expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "재시도" }));
    await screen.findByRole("img", { name: "크리미 하루일지 미리보기" });
    expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(false);
  });

  it("settles delayed asset and raster work as ready", async () => {
    let finishPreview!: (value: Blob) => void;
    const delayedPreview = new Promise<Blob>((resolve) => { finishPreview = resolve; });
    mocks.fetch.mockResolvedValue(entry());
    mocks.renderImage.mockReturnValue(delayedPreview);
    renderEditor();
    await screen.findByRole("heading", { name: "크리미" });
    await waitFor(() => expect(mocks.renderImage).toHaveBeenCalledTimes(1));
    expect(screen.getByText("미리보기 준비 중")).toBeTruthy();
    finishPreview(previewBlob);
    await screen.findByRole("img", { name: "크리미 하루일지 미리보기" });
  });

  it("allows navigation from an errored A preview and makes B ready", async () => {
    mocks.fetch.mockImplementation(async (id: string) => roster.find((item) => item.id === id)!);
    mocks.renderImage.mockRejectedValueOnce(new Error("A failed")).mockResolvedValueOnce(previewBlob);
    render(<JournalEditorNavigationHarness />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByRole("img", { name: "몽이 하루일지 미리보기" });
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

  it("opens the canonical report in the mobile and tablet preview modal", async () => {
    mocks.fetch.mockResolvedValue(entry());
    renderEditor();
    await screen.findByRole("heading", { name: "크리미" });
    await screen.findByRole("img", { name: "크리미 하루일지 미리보기" });
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));
    expect(screen.getByRole("dialog", { name: "결과 미리보기" })).toBeTruthy();
    expect(screen.getAllByTestId("journal-report-template")).toHaveLength(1);
    expect(screen.getAllByRole("img", { name: "크리미 하루일지 미리보기" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog", { name: "결과 미리보기" })).toBeNull();
  });

  it("exports the latest local draft as PNG without waiting for autosave or changing status", async () => {
    mocks.fetch.mockResolvedValue(entry({ teacherComment: "저장된 내용" }));
    mocks.exportPreview.mockResolvedValue(undefined);
    renderEditor();
    const comment = await screen.findByRole("textbox", { name: "선생님의 한마디" });
    fireEvent.change(comment, { target: { value: "아직 저장되지 않은 최신 내용" } });
    const save = screen.getByRole("button", { name: "PNG 저장" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(mocks.exportPreview).toHaveBeenCalledTimes(1));
    expect(mocks.exportPreview.mock.calls[0][0]).toMatchObject({
      blob: previewBlob,
      rendererVersion: JOURNAL_RENDERER_VERSION,
      templateVersion: JOURNAL_TEMPLATE_VERSION,
      assetVersion: JOURNAL_ASSET_VERSION,
    });
    expect(mocks.exportPreview.mock.calls[0][1]).toMatchObject({ teacherComment: "아직 저장되지 않은 최신 내용" });
    expect(mocks.exportPreview.mock.calls[0][2]).toBe("png");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("guards duplicate export clicks, exposes loading, and recovers after an error", async () => {
    mocks.fetch.mockResolvedValue(entry());
    let rejectExport!: (error: Error) => void;
    mocks.exportPreview.mockImplementation(() => new Promise((_resolve, reject) => { rejectExport = reject; }));
    renderEditor();
    await screen.findByRole("heading", { name: "크리미" });
    const png = screen.getByRole("button", { name: "PNG 저장" });
    await waitFor(() => expect(png.hasAttribute("disabled")).toBe(false));
    fireEvent.click(png);
    fireEvent.click(png);
    expect(mocks.exportPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "이미지 만드는 중..." }).hasAttribute("disabled")).toBe(true);
    rejectExport(new Error("raster failed"));
    expect((await screen.findByRole("alert")).textContent).toBe("이미지를 저장하지 못했습니다. 다시 시도해 주세요.");
    expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(false);
  });

  it("does not cache or export an incomplete preview when an approved illustration cannot be embedded", async () => {
    mocks.fetch.mockResolvedValue(entry());
    mocks.renderImage.mockRejectedValue(new Error("JOURNAL_EXPORT_ASSET_INLINE_FAILED"));
    renderEditor();
    await screen.findByRole("heading", { name: "크리미" });
    expect((await screen.findByRole("alert")).textContent).toBe("미리보기를 만들지 못했습니다. 다시 시도해 주세요.");
    expect(screen.queryByRole("img", { name: "크리미 하루일지 미리보기" })).toBeNull();
    expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "JPG 저장" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.exportPreview).not.toHaveBeenCalled();
  });

  it("offers PNG and JPG export inside the mobile preview for completed journals", async () => {
    mocks.fetch.mockResolvedValue(entry({ status: "COMPLETED" }));
    mocks.exportPreview.mockResolvedValue(undefined);
    renderEditor(entry({ status: "COMPLETED" }));
    await screen.findByRole("heading", { name: "크리미" });
    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));
    const dialog = screen.getByRole("dialog", { name: "결과 미리보기" });
    const jpg = within(dialog).getByRole("button", { name: "JPG 저장" });
    await waitFor(() => expect(jpg.hasAttribute("disabled")).toBe(false));
    fireEvent.click(jpg);
    await waitFor(() => expect(mocks.exportPreview).toHaveBeenCalledWith(
      expect.objectContaining({ blob: previewBlob }),
      expect.objectContaining({ status: "COMPLETED" }),
      "jpg",
    ));
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
