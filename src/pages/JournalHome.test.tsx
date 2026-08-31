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
  ensurePresentation: vi.fn().mockResolvedValue({ fontFamily: "Pretendard, sans-serif", fontSize: 20 }),
  reconnectSystemFont: vi.fn().mockResolvedValue(undefined),
  fontPreference: {
    status: "ready",
    fonts: [],
    activeFontId: null,
    activeFontFamily: "Pretendard, sans-serif",
    activeSource: "DEFAULT",
    activeSystemFont: null,
    systemFonts: [],
    systemFontStatus: "idle",
    fontSize: 20,
    error: "",
  },
}));

vi.mock("./operationsScheduleRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operationsScheduleRepository")>()),
  seoulDateKey: () => "2026-08-15",
}));
vi.mock("./JournalEditor", () => ({
  JournalEditor: ({ entry, focusTeacherComment }: { entry: { dog: { name: string } }; focusTeacherComment?: boolean }) => (
    <section>
      <h1>{entry.dog.name}</h1>
      <textarea aria-label="선생님의 한마디" autoFocus={focusTeacherComment} />
    </section>
  ),
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
vi.mock("./journalCustomFont", () => ({
  resolveJournalTeacherCommentPresentation: mocks.ensurePresentation,
  reconnectJournalSystemFontsForEntries: mocks.reconnectSystemFont,
  useJournalCustomFontPreference: () => mocks.fontPreference,
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.ensurePresentation.mockResolvedValue({ fontFamily: "Pretendard, sans-serif", fontSize: 20 });
  mocks.reconnectSystemFont.mockResolvedValue(undefined);
  mocks.fontPreference.activeSource = "DEFAULT";
  mocks.fontPreference.systemFontStatus = "idle";
});

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
    expect(mocks.renderImage.mock.calls[0][0]).toMatchObject({ entryId: "entry-1", dogName: "크리미" });
    expect(mocks.renderImage.mock.calls[0][1]).toBe("png");
    expect(mocks.downloadBatch.mock.calls[0][0]).toEqual([
      expect.objectContaining({ filename: "P&M_하루일지_크리미_2026-08-15.png", blob: expect.objectContaining({ type: "image/png" }) }),
    ]);
    expect(mocks.downloadBatch.mock.calls[0][1]).toBe("2026-08-15");
  });

  it("fails batch presentation preflight before entry fetch and offers an explicit system-font reconnect", async () => {
    mocks.fetchRoster.mockResolvedValue(roster);
    mocks.fontPreference.activeSource = "SYSTEM";
    mocks.fontPreference.systemFontStatus = "reconnect-required";
    mocks.ensurePresentation.mockRejectedValue(new Error("JOURNAL_SYSTEM_FONT_RECONNECT_REQUIRED"));
    render(<JournalHomePage />);
    await screen.findByText("크리미");
    fireEvent.click(screen.getByRole("button", { name: "2026-08-15 완료 일지 전체 저장" }));
    expect(await screen.findByText("사용 중인 컴퓨터 글꼴을 다시 연결해야 이미지를 저장할 수 있습니다.")).not.toBeNull();
    expect(mocks.fetchEntry).not.toHaveBeenCalled();
    expect(mocks.renderImage).not.toHaveBeenCalled();
    expect(mocks.downloadBatch).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.updateDefaults).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "컴퓨터 글꼴 다시 연결" }));
    await waitFor(() => expect(mocks.reconnectSystemFont).toHaveBeenCalledTimes(1));
  });

  it("resolves every completed entry presentation before rendering", async () => {
    const completed = Array.from({ length: 5 }, (_, index) => ({ ...roster.entries[0], id: `entry-${index + 1}`, dog: { id: `dog-${index + 1}`, name: `강아지${index + 1}` } }));
    mocks.fetchRoster.mockResolvedValue({ ...roster, summary: { total: 5, notStarted: 0, inProgress: 0, completed: 5 }, entries: completed });
    mocks.fetchEntry.mockImplementation(async (id: string) => completed.find((entry) => entry.id === id));
    const sizes = [18, 20, 22, 18, 20] as const;
    mocks.ensurePresentation.mockImplementation(async (entryId: string) => ({ fontFamily: `font-${entryId}`, fontSize: sizes[Number(entryId.split("-")[1]) - 1] }));
    mocks.renderImage.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    mocks.downloadBatch.mockResolvedValue({ blob: new Blob(), filename: "P&M_하루일지_2026-08-15.zip" });
    render(<JournalHomePage />);
    await screen.findByText("강아지1");
    fireEvent.click(screen.getByRole("button", { name: "2026-08-15 완료 일지 전체 저장" }));
    await waitFor(() => expect(mocks.downloadBatch).toHaveBeenCalledTimes(1));
    expect(mocks.ensurePresentation).toHaveBeenCalledTimes(5);
    expect(mocks.ensurePresentation.mock.calls.map(([entryId]) => entryId)).toEqual(completed.map((entry) => entry.id));
    expect(mocks.fetchEntry).toHaveBeenCalledTimes(5);
    expect(mocks.renderImage).toHaveBeenCalledTimes(5);
    expect(mocks.renderImage.mock.calls.map((call) => call[3]?.fontSize)).toEqual(sizes);
    expect(mocks.renderImage.mock.calls.map((call) => call[3]?.fontFamily)).toEqual(completed.map((entry) => `font-${entry.id}`));
    expect(mocks.downloadBatch.mock.calls[0][0]).toHaveLength(5);
  });

  it("discovers every overflowing completed entry before rendering and opens the selected Dog editor", async () => {
    const completed = [
      { ...roster.entries[0], id: "entry-safe", dog: { id: "dog-safe", name: "가을" }, teacherComment: "오늘도 즐거웠어요." },
      { ...roster.entries[0], id: "entry-recommended", dog: { id: "dog-recommended", name: "감자" }, teacherComment: "가".repeat(420) },
      { ...roster.entries[0], id: "entry-too-long", dog: { id: "dog-too-long", name: "먼지" }, teacherComment: "가".repeat(500) },
    ];
    mocks.fetchRoster.mockResolvedValue({ ...roster, summary: { total: 3, notStarted: 0, inProgress: 0, completed: 3 }, entries: completed });
    mocks.fetchEntry.mockImplementation(async (id: string) => completed.find((entry) => entry.id === id));
    mocks.ensurePresentation.mockResolvedValue({ fontFamily: "Pretendard, sans-serif", fontSize: 20, source: "SYSTEM", fontFingerprint: "pnm-journal-system-font-safe" });
    render(<JournalHomePage />);
    await screen.findByText("가을");
    fireEvent.click(screen.getByRole("button", { name: "2026-08-15 완료 일지 전체 저장" }));
    expect(await screen.findByText("이미지에 글이 모두 들어가지 않는 일지가 있습니다.")).not.toBeNull();
    const repairList = screen.getByLabelText("이미지 저장 수정 대상");
    expect(within(repairList).getByText("수정이 필요한 일지 2건")).not.toBeNull();
    expect(within(repairList).getByText("감자").parentElement?.textContent).toContain("18px로 줄이면 이미지를 저장할 수 있습니다.");
    expect(within(repairList).getByText("먼지").parentElement?.textContent).toContain("18px에서도 영역을 초과합니다");
    expect(mocks.fetchEntry).toHaveBeenCalledTimes(3);
    expect(mocks.renderImage).not.toHaveBeenCalled();
    expect(mocks.downloadBatch).not.toHaveBeenCalled();
    const repairButtons = screen.getAllByRole("button", { name: "일지 수정하기" });
    fireEvent.click(repairButtons[0]);
    expect(await screen.findByRole("heading", { name: "감자" })).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("선생님의 한마디")));
  });

  it("requires system-font reconnect before geometry preflight and performs no partial render", async () => {
    const completed = [{ ...roster.entries[0], teacherComment: "가".repeat(420) }];
    mocks.fetchRoster.mockResolvedValue({ ...roster, entries: completed });
    mocks.fontPreference.activeSource = "SYSTEM";
    mocks.fontPreference.systemFontStatus = "reconnect-required";
    mocks.ensurePresentation.mockRejectedValueOnce(new Error("JOURNAL_SYSTEM_FONT_RECONNECT_REQUIRED"));
    render(<JournalHomePage />);
    await screen.findByText("크리미");
    fireEvent.click(screen.getByRole("button", { name: "2026-08-15 완료 일지 전체 저장" }));
    expect(await screen.findByText("사용 중인 컴퓨터 글꼴을 다시 연결해야 이미지를 저장할 수 있습니다.")).not.toBeNull();
    expect(mocks.fetchEntry).not.toHaveBeenCalled();
    expect(mocks.renderImage).not.toHaveBeenCalled();
    expect(mocks.downloadBatch).not.toHaveBeenCalled();
  });

  it.each(["RENDER", "ENCODE", "VALIDATION"] as const)(
    "classifies an injected %s failure and exposes safe diagnostic copy",
    async (stage) => {
      const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
      mocks.fetchRoster.mockResolvedValue(roster);
      mocks.fetchEntry.mockResolvedValue(roster.entries[0]);
      mocks.renderImage.mockImplementation(async (_viewModel, _format, onStage) => {
        onStage?.({ stage, state: "START", canvasWidth: 1080, canvasHeight: 1440 });
        throw new Error(`JOURNAL_${stage}_FAILED`);
      });
      render(<JournalHomePage />);
      await screen.findByText("크리미");
      fireEvent.click(screen.getByRole("button", { name: "2026-08-15 완료 일지 전체 저장" }));
      expect(await screen.findByText("1번째 일지 이미지 생성 중 문제가 발생했습니다.")).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "진단 정보 복사" }));
      await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(1));
      const copied = clipboard.writeText.mock.calls[0][0] as string;
      expect(copied).toContain(`FAILURE_STAGE: ${stage}`);
      expect(copied).toContain("FAILURE_ENTRY_ID: entry-1");
      expect(copied).toContain("FAILURE_DOG_ID: dog-1");
      expect(copied).not.toContain("크리미");
    },
  );

  it.each(["ZIP", "DOWNLOAD"] as const)("classifies an injected %s archive failure", async (stage) => {
    mocks.fetchRoster.mockResolvedValue(roster);
    mocks.fetchEntry.mockResolvedValue(roster.entries[0]);
    mocks.renderImage.mockImplementation(async (_viewModel, _format, onStage) => {
      onStage?.({ stage: "RENDER", state: "START" });
      onStage?.({ stage: "RENDER", state: "ACK", canvasWidth: 1080, canvasHeight: 1440 });
      onStage?.({ stage: "ENCODE", state: "START" });
      onStage?.({ stage: "ENCODE", state: "ACK", encodedByteSize: 3 });
      onStage?.({ stage: "VALIDATION", state: "START" });
      onStage?.({ stage: "VALIDATION", state: "ACK", encodedByteSize: 3 });
      return new Blob(["png"], { type: "image/png" });
    });
    mocks.downloadBatch.mockImplementation(async (_files, _date, onStage) => {
      onStage?.({ stage: "ZIP", state: "START" });
      if (stage === "ZIP") throw new Error("JOURNAL_ZIP_FAILED");
      onStage?.({ stage: "ZIP", state: "ACK", encodedByteSize: 100 });
      onStage?.({ stage: "DOWNLOAD", state: "START", encodedByteSize: 100 });
      throw new Error("JOURNAL_DOWNLOAD_FAILED");
    });
    render(<JournalHomePage />);
    await screen.findByText("크리미");
    fireEvent.click(screen.getByRole("button", { name: "2026-08-15 완료 일지 전체 저장" }));
    const message = stage === "ZIP"
      ? "일지 파일 묶음을 만드는 중 문제가 발생했습니다."
      : "일지 파일 다운로드를 준비하는 중 문제가 발생했습니다.";
    expect(await screen.findByText(message)).not.toBeNull();
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
      { id: "dog-1", name: "크리미", customerId: "customer-1", customerName: "박보호", customerPhone: "01012345678", breed: null, isDaycareStudent: true },
      { id: "dog-2", name: "몽이", customerId: "customer-2", customerName: "김보호", customerPhone: "01087654321", breed: null, isDaycareStudent: false },
    ]);
    mocks.register.mockResolvedValue(roster);
    render(<JournalHomePage />);
    await screen.findByText("오늘 등원한 아이들을 등록해주세요.");
    fireEvent.click(screen.getAllByRole("button", { name: "오늘 등원 등록" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "오늘 등원 등록" });
    expect(within(dialog).getByRole("button", { name: "등원 등록" }).hasAttribute("disabled")).toBe(true);
    const search = within(dialog).getByPlaceholderText("반려견, 보호자 또는 전화번호 검색");
    fireEvent.change(search, { target: { value: "0101234" } });
    await waitFor(() => expect(within(dialog).getByText("크리미")).not.toBeNull());
    expect(within(dialog).getByText("유치원생")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("option", { name: /크리미/ }));
    expect(within(dialog).getByText("선택 1마리")).not.toBeNull();
    fireEvent.change(within(dialog).getByPlaceholderText("예절교육 활동명 입력"), { target: { value: "  기다려  " } });
    fireEvent.change(within(dialog).getByPlaceholderText("체육활동 활동명 입력"), { target: { value: " 밸런스볼 " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "1마리 등원 등록" }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith("2026-08-15", ["dog-1"], {
      mannersActivityName: "기다려",
      physicalActivityName: "밸런스볼",
      expectedVersion: null,
    }));
  });

  it("separates default-only editing from registration without changing existing entries", async () => {
    const updated = { ...roster, defaults: { mannersActivityName: "매트", physicalActivityName: "터널", version: 4 } };
    mocks.fetchRoster.mockResolvedValue(roster);
    mocks.fetchDirectory.mockResolvedValue([]);
    mocks.updateDefaults.mockResolvedValue(updated);
    render(<JournalHomePage />);
    await screen.findByText("크리미");
    const summary = screen.getByLabelText("오늘의 공통 활동 요약");
    expect(summary.textContent).toContain("예절 기다려");
    expect(summary.textContent).toContain("체육 밸런스볼");
    fireEvent.click(screen.getByRole("button", { name: "등원 추가" }));
    const registration = await screen.findByRole("dialog", { name: "오늘 등원 등록" });
    expect(within(registration).queryByRole("button", { name: "공통 활동만 저장" })).toBeNull();
    fireEvent.click(within(registration).getByRole("button", { name: "취소" }));
    fireEvent.click(within(summary).getByRole("button", { name: "수정" }));
    const edit = await screen.findByRole("dialog", { name: "오늘의 공통 활동 수정" });
    expect((within(edit).getByPlaceholderText("예절교육 활동명 입력") as HTMLInputElement).value).toBe("기다려");
    expect((within(edit).getByPlaceholderText("체육활동 활동명 입력") as HTMLInputElement).value).toBe("밸런스볼");
    fireEvent.change(within(edit).getByPlaceholderText("예절교육 활동명 입력"), { target: { value: " 매트 " } });
    fireEvent.change(within(edit).getByPlaceholderText("체육활동 활동명 입력"), { target: { value: " 터널 " } });
    fireEvent.click(within(edit).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mocks.updateDefaults).toHaveBeenCalledWith("day-1", 3, {
      mannersActivityName: "매트",
      physicalActivityName: "터널",
    }));
    expect(updated.entries).toEqual(roster.entries);
  });

  it("shows a compact setup entry when an existing day has no defaults", async () => {
    mocks.fetchRoster.mockResolvedValue({ ...roster, defaults: { mannersActivityName: null, physicalActivityName: null, version: 1 } });
    render(<JournalHomePage />);
    const summary = await screen.findByLabelText("오늘의 공통 활동 요약");
    expect(summary.textContent).toContain("설정 안 됨");
    expect(within(summary).getByRole("button", { name: "설정" })).not.toBeNull();
  });

  it("uses edited current defaults only for a subsequently registered Dog", async () => {
    const updated = { ...roster, defaults: { mannersActivityName: "매트", physicalActivityName: "터널", version: 4 } };
    const dog = { id: "dog-4", name: "보리", customerId: "customer-4", customerName: "최보호", customerPhone: "01022223333", breed: null, isDaycareStudent: false };
    mocks.fetchRoster.mockResolvedValue(roster);
    mocks.fetchDirectory.mockResolvedValue([dog]);
    mocks.updateDefaults.mockResolvedValue(updated);
    mocks.register.mockResolvedValue({
      ...updated,
      summary: { ...updated.summary, total: 4, notStarted: 2 },
      entries: [...updated.entries, { ...updated.entries[2], id: "entry-4", dog: { id: dog.id, name: dog.name } }],
    });
    render(<JournalHomePage />);
    const summary = await screen.findByLabelText("오늘의 공통 활동 요약");
    fireEvent.click(within(summary).getByRole("button", { name: "수정" }));
    const edit = await screen.findByRole("dialog", { name: "오늘의 공통 활동 수정" });
    fireEvent.change(within(edit).getByPlaceholderText("예절교육 활동명 입력"), { target: { value: "매트" } });
    fireEvent.change(within(edit).getByPlaceholderText("체육활동 활동명 입력"), { target: { value: "터널" } });
    fireEvent.click(within(edit).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "오늘의 공통 활동 수정" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "등원 추가" }));
    const registration = await screen.findByRole("dialog", { name: "오늘 등원 등록" });
    fireEvent.click(await within(registration).findByRole("option", { name: /보리/ }));
    fireEvent.click(within(registration).getByRole("button", { name: "1마리 등원 등록" }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith("2026-08-15", ["dog-4"], {
      mannersActivityName: "매트",
      physicalActivityName: "터널",
      expectedVersion: 4,
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
    const dialog = await screen.findByRole("dialog", { name: "오늘 등원 등록" });
    expect((within(dialog).getByPlaceholderText("예절교육 활동명 입력") as HTMLInputElement).value).toBe("매트");
    expect((within(dialog).getByPlaceholderText("체육활동 활동명 입력") as HTMLInputElement).value).toBe("터널");
  });

  it("keeps the layout overflow-safe for both required mobile widths", async () => {
    mocks.fetchRoster.mockResolvedValue(roster);
    mocks.fetchDirectory.mockResolvedValue([]);
    const { container } = render(<JournalHomePage />);
    await screen.findByText("크리미");
    fireEvent.click(screen.getByRole("button", { name: "등원 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "오늘 등원 등록" });
    const root = container.querySelector("[aria-label='유치원 하루 일지']");
    expect(root?.className).toContain("overflow-x-hidden");
    expect(container.innerHTML).toContain("min-h-11");
    expect(container.innerHTML).toContain("sm:grid-cols-2");
    expect(container.innerHTML).toContain("grid-cols-1");
    const dogSection = await within(dialog).findByText("반려견 선택");
    expect(dogSection.compareDocumentPosition(within(dialog).getByText("오늘의 공통 활동", { exact: false })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).getByTestId("modal-actions").className).toContain("sticky");
    expect(within(dialog).getByTestId("modal-actions").className).toContain("sm:-bottom-6");
  });
});
