// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalHomePage } from "./JournalHome";

const mocks = vi.hoisted(() => ({
  fetchRoster: vi.fn(),
  fetchDirectory: vi.fn(),
  fetchEntry: vi.fn(),
  register: vi.fn(),
  updateDefaults: vi.fn(),
  remove: vi.fn(),
  renderImage: vi.fn(),
  downloadBatch: vi.fn(),
}));

vi.mock("./operationsScheduleRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operationsScheduleRepository")>()),
  seoulDateKey: () => "2026-08-15",
}));
vi.mock("./journalRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./journalRepository")>()),
  fetchJournalRoster: mocks.fetchRoster,
  fetchJournalDogDirectory: mocks.fetchDirectory,
  fetchJournalEntry: mocks.fetchEntry,
  registerJournalRoster: mocks.register,
  updateJournalDayDefaultActivities: mocks.updateDefaults,
  removeJournalRosterEntry: mocks.remove,
}));
vi.mock("./journalExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./journalExport")>()),
  renderJournalImageBlob: mocks.renderImage,
}));
vi.mock("./journalBatchExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./journalBatchExport")>()),
  downloadJournalBatchZip: mocks.downloadBatch,
}));

const roster = {
  businessDate: "2026-08-15",
  journalDayId: "day-1",
  defaults: { mannersActivityName: "기다려", physicalActivityName: "밸런스볼", version: 3 },
  summary: { total: 3, notStarted: 1, inProgress: 1, completed: 1 },
  entries: [
    { id: "entry-1", journalDayId: "day-1", businessDate: "2026-08-15", dog: { id: "dog-1", name: "크리미" }, customer: { id: "customer-1", name: "박보호" }, status: "COMPLETED", version: 2, createdAt: "2026-08-15T00:00:00Z", updatedAt: "2026-08-15T00:00:00Z" },
    { id: "entry-2", journalDayId: "day-1", businessDate: "2026-08-15", dog: { id: "dog-2", name: "몽이" }, customer: { id: "customer-2", name: "김보호" }, status: "IN_PROGRESS", version: 2, createdAt: "2026-08-15T00:00:00Z", updatedAt: "2026-08-15T00:00:00Z" },
    { id: "entry-3", journalDayId: "day-1", businessDate: "2026-08-15", dog: { id: "dog-3", name: "초코" }, customer: { id: "customer-3", name: "이보호" }, status: "NOT_STARTED", version: 1, createdAt: "2026-08-15T00:00:00Z", updatedAt: "2026-08-15T00:00:00Z" },
  ],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Journal Home roster", () => {
  it("shows the empty-day registration state", async () => {
    mocks.fetchRoster.mockResolvedValue({ ...roster, journalDayId: null, defaults: { mannersActivityName: null, physicalActivityName: null, version: null }, summary: { total: 0, notStarted: 0, inProgress: 0, completed: 0 }, entries: [] });
    render(<JournalHomePage />);
    expect(await screen.findByText("오늘 등원한 아이들을 등록해주세요.")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "오늘 등원 등록" }).length).toBeGreaterThan(0);
  });

  it("renders canonical summary, status filters, and delete actions for every status", async () => {
    mocks.fetchRoster.mockResolvedValue(roster);
    render(<JournalHomePage />);
    expect(await screen.findByText("크리미")).not.toBeNull();
    expect(screen.getByLabelText("일지 요약").textContent).toContain("완료1");
    expect(screen.getByLabelText("일지 요약").textContent).toContain("작성중1");
    expect(screen.getByLabelText("일지 요약").textContent).toContain("1미작성");
    expect(screen.getByRole("button", { name: "크리미 일지 삭제" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "몽이 일지 삭제" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "초코 일지 삭제" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "미작성" }));
    expect(screen.getByText("초코")).not.toBeNull();
    expect(screen.queryByText("크리미")).toBeNull();
  });

  it("confirms and removes a COMPLETED entry, immediately updating summary and batch count", async () => {
    const afterDelete = {
      ...roster,
      summary: { total: 2, notStarted: 1, inProgress: 1, completed: 0 },
      entries: roster.entries.slice(1),
    };
    mocks.fetchRoster.mockResolvedValue(roster);
    mocks.remove.mockResolvedValue(afterDelete);
    render(<JournalHomePage />);
    await screen.findByText("크리미");
    fireEvent.click(screen.getByRole("button", { name: "크리미 일지 삭제" }));
    const dialog = screen.getByRole("dialog", { name: "일지 삭제" });
    expect(dialog.textContent).toContain("완료된 일지가 삭제되며 복구할 수 없습니다.");
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("entry-1", 2));
    await waitFor(() => expect(screen.queryByText("크리미")).toBeNull());
    expect(screen.getByLabelText("일지 요약").textContent).toContain("0완료");
    expect(screen.getByRole("button", { name: "2026-08-15 완료 일지 전체 저장" }).textContent).toContain("0건");
  });

  it("exports only the selected date's persisted COMPLETED entries as one PNG ZIP", async () => {
    mocks.fetchRoster.mockResolvedValue(roster);
    mocks.fetchEntry.mockResolvedValue(roster.entries[0]);
    mocks.renderImage.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    mocks.downloadBatch.mockResolvedValue({ blob: new Blob(), filename: "P&M_하루일지_2026-08-15.zip" });
    render(<JournalHomePage />);
    await screen.findByText("크리미");
    const batch = screen.getByRole("button", { name: "2026-08-15 완료 일지 전체 저장" });
    expect(batch.textContent).toContain("1건");
    fireEvent.click(batch);
    fireEvent.click(batch);
    await waitFor(() => expect(mocks.downloadBatch).toHaveBeenCalledTimes(1));
    expect(mocks.fetchEntry).toHaveBeenCalledTimes(1);
    expect(mocks.fetchEntry).toHaveBeenCalledWith("entry-1");
    expect(mocks.renderImage).toHaveBeenCalledTimes(1);
    expect((mocks.renderImage.mock.calls[0][0] as HTMLElement).dataset.testid).toBe("journal-batch-export-template");
    expect(mocks.renderImage.mock.calls[0][1]).toBe("png");
    expect(mocks.downloadBatch.mock.calls[0][0]).toEqual([
      expect.objectContaining({ filename: "P&M_하루일지_크리미_2026-08-15.png", blob: expect.objectContaining({ type: "image/png" }) }),
    ]);
    expect(mocks.downloadBatch.mock.calls[0][1]).toBe("2026-08-15");
  });

  it("disables batch export instead of creating an empty ZIP", async () => {
    mocks.fetchRoster.mockResolvedValue({ ...roster, journalDayId: null, defaults: { mannersActivityName: null, physicalActivityName: null, version: null }, summary: { total: 0, notStarted: 0, inProgress: 0, completed: 0 }, entries: [] });
    render(<JournalHomePage />);
    await screen.findByText("오늘 등원한 아이들을 등록해주세요.");
    expect(screen.getByRole("button", { name: "2026-08-15 완료 일지 전체 저장" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.downloadBatch).not.toHaveBeenCalled();
  });

  it("reuses multi-search by Dog, Customer, and phone and registers selected Dogs", async () => {
    mocks.fetchRoster.mockResolvedValue({ ...roster, journalDayId: null, defaults: { mannersActivityName: null, physicalActivityName: null, version: null }, summary: { total: 0, notStarted: 0, inProgress: 0, completed: 0 }, entries: [] });
    mocks.fetchDirectory.mockResolvedValue([
      { id: "dog-1", name: "크리미", customerId: "customer-1", customerName: "박보호", customerPhone: "01012345678", breed: null },
      { id: "dog-2", name: "몽이", customerId: "customer-2", customerName: "김보호", customerPhone: "01087654321", breed: null },
    ]);
    mocks.register.mockResolvedValue(roster);
    render(<JournalHomePage />);
    await screen.findByText("오늘 등원한 아이들을 등록해주세요.");
    fireEvent.click(screen.getAllByRole("button", { name: "오늘 등원 등록" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "오늘 등원 등록" });
    const search = within(dialog).getByPlaceholderText("반려견, 보호자 또는 전화번호 검색");
    fireEvent.change(search, { target: { value: "0101234" } });
    await waitFor(() => expect(within(dialog).getByText("크리미")).not.toBeNull());
    fireEvent.click(within(dialog).getByRole("option", { name: /크리미/ }));
    expect(within(dialog).getByText("선택 1마리")).not.toBeNull();
    fireEvent.change(within(dialog).getByPlaceholderText("예절교육 활동명 입력"), { target: { value: "  기다려  " } });
    fireEvent.change(within(dialog).getByPlaceholderText("체육활동 활동명 입력"), { target: { value: " 밸런스볼 " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "오늘 등원 등록" }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith("2026-08-15", ["dog-1"], {
      mannersActivityName: "기다려",
      physicalActivityName: "밸런스볼",
      expectedVersion: null,
    }));
  });

  it("loads and updates an existing day's defaults without changing existing entries", async () => {
    const updated = { ...roster, defaults: { mannersActivityName: "매트", physicalActivityName: "터널", version: 4 } };
    mocks.fetchRoster.mockResolvedValue(roster);
    mocks.fetchDirectory.mockResolvedValue([]);
    mocks.updateDefaults.mockResolvedValue(updated);
    render(<JournalHomePage />);
    await screen.findByText("크리미");
    fireEvent.click(screen.getByRole("button", { name: "등원 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "등원 추가" });
    expect((within(dialog).getByPlaceholderText("예절교육 활동명 입력") as HTMLInputElement).value).toBe("기다려");
    expect((within(dialog).getByPlaceholderText("체육활동 활동명 입력") as HTMLInputElement).value).toBe("밸런스볼");
    fireEvent.change(within(dialog).getByPlaceholderText("예절교육 활동명 입력"), { target: { value: " 매트 " } });
    fireEvent.change(within(dialog).getByPlaceholderText("체육활동 활동명 입력"), { target: { value: " 터널 " } });
    const saveDefaults = within(dialog).getByRole("button", { name: "공통 활동 저장" });
    await waitFor(() => expect(saveDefaults.hasAttribute("disabled")).toBe(false));
    fireEvent.click(saveDefaults);
    await waitFor(() => expect(mocks.updateDefaults).toHaveBeenCalledWith("day-1", 3, {
      mannersActivityName: "매트",
      physicalActivityName: "터널",
    }));
    expect(updated.entries).toEqual(roster.entries);
  });

  it("reloads isolated defaults when the selected Journal date changes", async () => {
    const previousDay = {
      ...roster,
      businessDate: "2026-08-14",
      defaults: { mannersActivityName: "매트", physicalActivityName: "터널", version: 2 },
      entries: roster.entries.map((entry) => ({ ...entry, businessDate: "2026-08-14" })),
    };
    mocks.fetchRoster.mockImplementation(async (date: string) => date === "2026-08-14" ? previousDay : roster);
    mocks.fetchDirectory.mockResolvedValue([]);
    render(<JournalHomePage />);
    await screen.findByText("크리미");
    fireEvent.change(screen.getByLabelText("일지 날짜"), { target: { value: "2026-08-14" } });
    await waitFor(() => expect(mocks.fetchRoster).toHaveBeenLastCalledWith("2026-08-14"));
    fireEvent.click(screen.getByRole("button", { name: "등원 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "등원 추가" });
    expect((within(dialog).getByPlaceholderText("예절교육 활동명 입력") as HTMLInputElement).value).toBe("매트");
    expect((within(dialog).getByPlaceholderText("체육활동 활동명 입력") as HTMLInputElement).value).toBe("터널");
  });

  it("keeps the layout overflow-safe for both required mobile widths", async () => {
    mocks.fetchRoster.mockResolvedValue(roster);
    const { container } = render(<JournalHomePage />);
    await screen.findByText("크리미");
    fireEvent.click(screen.getByRole("button", { name: "등원 추가" }));
    await screen.findByRole("dialog", { name: "등원 추가" });
    const root = container.querySelector("[aria-label='유치원 하루 일지']");
    expect(root?.className).toContain("overflow-x-hidden");
    expect(container.innerHTML).toContain("min-h-11");
    expect(container.innerHTML).toContain("sm:grid-cols-2");
    expect(container.innerHTML).toContain("grid-cols-1");
  });
});
