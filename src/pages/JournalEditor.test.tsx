// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalEditor } from "./JournalEditor";
import { buildJournalPreviewViewModel } from "./journalPreviewViewModel";
import type { JournalDraft, JournalRosterEntry } from "./journalRepository";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("./journalRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./journalRepository")>()),
  fetchJournalEntry: mocks.fetch,
  updateJournalEntryDraft: mocks.update,
  completeJournalEntry: mocks.complete,
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const renderEditor = (target = roster[0]) => render(
  <JournalEditor
    entry={target}
    rosterEntries={roster}
    onEntryUpdate={vi.fn()}
    onNavigate={vi.fn()}
    onClose={vi.fn()}
  />,
);

describe("Journal Editor", () => {
  it("renders the mobile-first typed controls and clears stool when defecation is NO", async () => {
    mocks.fetch.mockResolvedValue(entry());
    mocks.update.mockImplementation(async (_id, version, draft) => entry({ ...draft, status: "IN_PROGRESS", version: version + 1 }));
    const { container } = renderEditor();
    await screen.findByRole("heading", { name: "크리미" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "활발해요" }));
    const defecationSection = screen.getByText("대변").parentElement!;
    fireEvent.click(defecationSection.querySelectorAll("button")[1]);
    expect(screen.getByRole("button", { name: "좋아요" }).hasAttribute("disabled")).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][2]).toMatchObject({ conditionCodes: ["active"], defecation: false, stoolCondition: null });
    expect(container.querySelector("[aria-label='크리미 일지 편집기']")?.className).toContain("overflow-x-hidden");
    expect(container.innerHTML).toContain("min-h-11");
    expect(container.querySelector("[aria-label='크리미 일지 편집기'] > div")?.className).toContain("xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]");
    expect(screen.getByTestId("journal-preview-placeholder").className).toContain("aspect-[3/4]");
    expect(screen.getByLabelText("크리미 결과 미리보기").className).toContain("hidden");
    expect(screen.getByLabelText("크리미 결과 미리보기").className).toContain("xl:block");
    expect(screen.queryByRole("button", { name: "미리보기" })).toBeNull();
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
    expect(preview.draft.teacherComment).toBe("아직 저장되지 않은 최신 입력");
    expect(preview.draft.conditionCodes).toEqual(["active"]);
    expect(preview.entryId).toBe("entry-1");
  });
});
