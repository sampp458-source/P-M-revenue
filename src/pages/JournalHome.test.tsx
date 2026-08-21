// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalHomePage } from "./JournalHome";

const mocks = vi.hoisted(() => ({
  fetchRoster: vi.fn(),
  fetchDirectory: vi.fn(),
  fetchEntry: vi.fn(),
  register: vi.fn(),
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
    mocks.fetchRoster.mockResolvedValue({ ...roster, journalDayId: null, summary: { total: 0, notStarted: 0, inProgress: 0, completed: 0 }, entries: [] });
    render(<JournalHomePage />);
    expect(await screen.findByText("오늘 등원한 아이들을 등록해주세요.")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "오늘 등원 등록" }).length).toBeGreaterThan(0);
  });

  it("renders canonical summary, status filters, and removal only for NOT_STARTED", async () => {
    mocks.fetchRoster.mockResolvedValue(roster);
    render(<JournalHomePage />);
    expect(await screen.findByText("크리미")).not.toBeNull();
    expect(screen.getByLabelText("일지 요약").textContent).toContain("완료1");
    expect(screen.getByLabelText("일지 요약").textContent).toContain("작성중1");
    expect(screen.getByLabelText("일지 요약").textContent).toContain("1미작성");
    expect(screen.queryByRole("button", { name: "크리미 명단에서 제거" })).toBeNull();
    expect(screen.queryByRole("button", { name: "몽이 명단에서 제거" })).toBeNull();
    expect(screen.getByRole("button", { name: "초코 명단에서 제거" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "미작성" }));
    expect(screen.getByText("초코")).not.toBeNull();
    expect(screen.queryByText("크리미")).toBeNull();
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
    expect(mocks.downloadBatch.mock.calls[0][0]).toEqual([
      expect.objectContaining({ filename: "P&M_하루일지_크리미_2026-08-15.png", blob: expect.objectContaining({ type: "image/png" }) }),
    ]);
    expect(mocks.downloadBatch.mock.calls[0][1]).toBe("2026-08-15");
  });

  it("disables batch export instead of creating an empty ZIP", async () => {
    mocks.fetchRoster.mockResolvedValue({ ...roster, journalDayId: null, summary: { total: 0, notStarted: 0, inProgress: 0, completed: 0 }, entries: [] });
    render(<JournalHomePage />);
    await screen.findByText("오늘 등원한 아이들을 등록해주세요.");
    expect(screen.getByRole("button", { name: "2026-08-15 완료 일지 전체 저장" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.downloadBatch).not.toHaveBeenCalled();
  });

  it("reuses multi-search by Dog, Customer, and phone and registers selected Dogs", async () => {
    mocks.fetchRoster.mockResolvedValue({ ...roster, journalDayId: null, summary: { total: 0, notStarted: 0, inProgress: 0, completed: 0 }, entries: [] });
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
    fireEvent.click(within(dialog).getByRole("button", { name: "오늘 등원 등록" }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith("2026-08-15", ["dog-1"]));
  });

  it("keeps the layout overflow-safe for both required mobile widths", async () => {
    mocks.fetchRoster.mockResolvedValue(roster);
    const { container } = render(<JournalHomePage />);
    await screen.findByText("크리미");
    const root = container.querySelector("[aria-label='유치원 하루 일지']");
    expect(root?.className).toContain("overflow-x-hidden");
    expect(container.innerHTML).toContain("min-h-11");
    expect(container.innerHTML).toContain("sm:grid-cols-2");
  });
});
