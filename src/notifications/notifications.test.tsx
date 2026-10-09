// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { NotificationProvider, NotificationSession } from "./NotificationProvider";
import { NotificationBell } from "./NotificationUi";
import { emptyInbox, NotificationFailure, type Inbox, type Notice, type NotificationRepository } from "./notificationRepository";
vi.mock("../lib/supabase", () => ({ supabase: {} }));
const auth = vi.hoisted(() => ({ profile: { id: "u1", isActive: true, accountStatus: "active" }, loading: false }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));
const notice = (id = "n1", extra: Partial<Notice> = {}): Notice => ({ id, announcement_id: "a1", title: `공지 ${id}`, message: "내일 전달 사항을 확인해 주세요.", priority: "NORMAL", ack_required: false, created_at: new Date().toISOString(), read_at: null, acknowledged_at: null, popup_presented_at: null, revoked_at: null, expires_at: null, ...extra });
let value: Inbox;
let repo: NotificationRepository;
let signal: () => void;
let unsubscribe: ReturnType<typeof vi.fn>;
beforeEach(() => {
  value = { ...emptyInbox, items: [notice()], unread_count: 1 };
  unsubscribe = vi.fn(); signal = () => {};
  repo = {
    inbox: vi.fn(async (_offset = 0, unread = false) => ({ ...value, items: (unread ? value.items.filter(n => !n.read_at) : value.items).slice(_offset, _offset + 50) })),
    detail: vi.fn(async id => value.items.find(n => n.id === id) || null),
    read: vi.fn(async id => { value = { ...value, unread_count: 0, items: value.items.map(n => n.id === id ? { ...n, read_at: "2026-09-29T10:00:00Z" } : n) }; }),
    readAll: vi.fn(async () => 0),
    acknowledge: vi.fn(async id => { value = { ...value, unacknowledged_count: 0, items: value.items.map(n => n.id === id ? { ...n, read_at: "2026-09-29T10:00:00Z", acknowledged_at: "2026-09-29T10:01:00Z" } : n) }; }),
    presented: vi.fn(async () => {}), subscribe: vi.fn((_id, callback) => { signal = callback; return unsubscribe; }),
    targets: vi.fn(async () => [{ id: "u1", name: "작성자" }, { id: "u2", name: "직원 가" }, { id: "u3", name: "직원 나" }]),
    sent: vi.fn(async () => [{ id: "a1", title: "보낸 공지 제목", body: "본문", state: "PUBLISHED" as const, priority: "IMPORTANT", ack_required: true, published_at: "2026-09-29T10:00:00Z", expires_at: null, stats: { total: 2, read: 1, ack: 1, unack: 1 } }]),
    sentForReceiptViewer: vi.fn(async () => []),
    audience: vi.fn(async () => ({ targetKind: "USER" as const, userIds: ["u2"] })),
    receipts: vi.fn(async () => [{ recipient_id: "u2", name: "직원 가", active: true, read_at: "now", acknowledged_at: "now", revoked_at: null }, { recipient_id: "u3", name: "직원 나", active: true, read_at: null, acknowledged_at: null, revoked_at: null }]),
    deleteAnnouncement: vi.fn(async () => {}),
    retract: vi.fn(async () => {}), publish: vi.fn(async () => "a2"),
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
function Nav() { const navigate = useNavigate(); const location = useLocation(); return <><span>{location.pathname}</span><button onClick={() => navigate("/next")}>다른 업무</button><NotificationBell /></>; }
function mount() { return render(<MemoryRouter><NotificationSession userId="u1" repository={repo}><Nav /></NotificationSession></MemoryRouter>); }
async function center() { fireEvent.click(await screen.findByRole("button", { name: /알림센터, 읽지 않은/ })); await screen.findByRole("button", { name: /공지 n1/ }); }
async function composer() { value = { ...value, can_publish: true, can_view_receipts: true }; mount(); await center(); fireEvent.click(screen.getByRole("button", { name: "공지 작성" })); await screen.findByText(/예상 대상 2명/); }
function fillComposer() { fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "팀 안내" } }); fireEvent.change(screen.getByLabelText(/본문/), { target: { value: "내일 운영 안내입니다." } }); }
describe("announcement inbox lifecycle", () => {
  it("disabled feature leaves existing authenticated shell alone", () => { render(<NotificationProvider enabled={false}><NotificationBell /><span>기존 업무</span></NotificationProvider>); expect(screen.queryByRole("button")).toBeNull(); expect(screen.getByText("기존 업무")).toBeTruthy(); });
  it("auth/bootstrap failure preserves RPC, focus, visibility and visible polling", async () => {
    vi.useFakeTimers();
    vi.mocked(repo.subscribe).mockImplementation(() => { throw new Error("auth unavailable"); });
    mount(); await act(async()=>{});
    expect(repo.inbox).toHaveBeenCalledTimes(1);
    fireEvent.focus(window); await act(async()=>{await vi.advanceTimersByTimeAsync(180);});
    expect(repo.inbox).toHaveBeenCalledTimes(2);
    fireEvent(document,new Event("visibilitychange")); await act(async()=>{await vi.advanceTimersByTimeAsync(180);});
    expect(repo.inbox).toHaveBeenCalledTimes(3);
    await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
    expect(repo.inbox).toHaveBeenCalledTimes(4);
    vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
    await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
    expect(repo.inbox).toHaveBeenCalledTimes(4);
  });
  it("inactive auth never mounts the notification session", () => {
    auth.profile.isActive = false;
    render(<NotificationProvider enabled><NotificationBell /><span>기존 업무</span></NotificationProvider>);
    expect(screen.queryByRole("button")).toBeNull(); auth.profile.isActive = true;
  });
  it("Realtime setup failure retains inbox loading and reading", async () => {
    vi.mocked(repo.subscribe).mockImplementation(() => { throw new Error("socket unavailable"); });
    mount(); await center(); expect(screen.getByRole("button", { name: /공지 n1/ })).toBeTruthy();
  });
  it("bell without a provider is absent", () => { render(<NotificationBell />); expect(screen.queryByRole("button")).toBeNull(); });
  it("server unread and unacknowledged counts remain separate", async () => { value.unacknowledged_count = 2; mount(); await center(); expect(screen.getByRole("button", { name: "알림센터, 읽지 않은 알림 1개" })).toBeTruthy(); expect(screen.getByText("2건")).toBeTruthy(); });
  it("normal first popup records presented but never read", async () => { value.popup = [...value.items]; mount(); await screen.findByRole("dialog"); await waitFor(() => expect(repo.presented).toHaveBeenCalledWith(["n1"])); expect(repo.read).not.toHaveBeenCalled(); expect(repo.acknowledge).not.toHaveBeenCalled(); });
  it("route and focus refresh do not replay a dismissed popup", async () => { value.popup = [...value.items]; mount(); await screen.findByRole("dialog"); fireEvent.click(screen.getByRole("button", { name: "닫기" })); fireEvent.click(screen.getByText("다른 업무")); fireEvent.focus(window); await new Promise(r => setTimeout(r, 240)); expect(screen.queryByRole("dialog")).toBeNull(); expect(repo.presented).toHaveBeenCalledTimes(1); });
  it("normal already presented is not shown in a fresh provider", async () => { value.items[0].popup_presented_at = "now"; mount(); await waitFor(() => expect(repo.inbox).toHaveBeenCalled()); expect(screen.queryByRole("dialog")).toBeNull(); });
  it("important unacked returns in a fresh session and closing is not ACK", async () => { value.popup = [notice("n1", { ack_required: true, priority: "IMPORTANT" })]; const first = mount(); await screen.findByRole("dialog"); fireEvent.keyDown(document, { key: "Escape" }); expect(repo.acknowledge).not.toHaveBeenCalled(); first.unmount(); mount(); expect(await screen.findByText("새로운 공지가 있어요")).toBeTruthy(); });
  it("opening detail marks read without ACK", async () => { value.items = [notice("n1", { ack_required: true })]; mount(); await center(); fireEvent.click(screen.getByRole("button", { name: /공지 n1/ })); await screen.findByText("확인했습니다"); expect(repo.read).toHaveBeenCalledWith("n1"); expect(repo.acknowledge).not.toHaveBeenCalled(); });
  it("explicit ACK refreshes server truth", async () => { value.items = [notice("n1", { ack_required: true })]; mount(); await center(); fireEvent.click(screen.getByRole("button", { name: /공지 n1/ })); fireEvent.click(await screen.findByRole("button", { name: "확인했습니다" })); await waitFor(() => expect(repo.acknowledge).toHaveBeenCalledTimes(1)); await screen.findByRole("button", { name: "확인 완료" }); });
  it("realtime bursts debounce into a refetch, never local +1", async () => { mount(); await waitFor(() => expect(repo.inbox).toHaveBeenCalledTimes(1)); value = { ...value, unread_count: 7 }; act(() => { signal(); signal(); signal(); }); await screen.findByRole("button", { name: "알림센터, 읽지 않은 알림 7개" }); expect(repo.inbox).toHaveBeenCalledTimes(2); });
  it("focus and visibility restore refresh canonical count", async () => { mount(); await waitFor(() => expect(repo.inbox).toHaveBeenCalledTimes(1)); fireEvent.focus(window); await waitFor(() => expect(repo.inbox).toHaveBeenCalledTimes(2)); fireEvent(document, new Event("visibilitychange")); await waitFor(() => expect(repo.inbox).toHaveBeenCalledTimes(3)); });
  it("unsubscribes on session unmount", async () => { const root = mount(); await waitFor(() => expect(repo.subscribe).toHaveBeenCalledWith("u1", expect.any(Function))); root.unmount(); expect(unsubscribe).toHaveBeenCalledTimes(1); });
  it("late response cannot restore a signed-out inbox", async () => { let resolve!: (i: Inbox) => void; vi.mocked(repo.inbox).mockReturnValue(new Promise(r => { resolve = r; })); const root = mount(); root.unmount(); await act(async () => resolve(value)); expect(screen.queryByRole("dialog")).toBeNull(); });
  it("failed inbox does not crash the shell", async () => { vi.mocked(repo.inbox).mockRejectedValue(new Error("네트워크 오류")); mount(); fireEvent.click(screen.getByRole("button", { name: /알림센터,/ })); expect((await screen.findByRole("alert")).textContent).toMatch(/오류|불러오지/); expect(screen.getByText("다른 업무")).toBeTruthy(); });
  it("normal user has no composer or manage access", async () => { mount(); await center(); expect(screen.queryByText("공지 작성")).toBeNull(); expect(screen.queryByText("보낸 공지")).toBeNull(); });
  it("read failure never opens stale detail", async () => { vi.mocked(repo.read).mockRejectedValue(new Error("회수된 공지")); mount(); await center(); fireEvent.click(screen.getByRole("button", { name: /공지 n1/ })); expect(await screen.findByText("회수된 공지")).toBeTruthy(); expect(screen.queryByRole("heading", { name: "공지" })).toBeNull(); });
  it("retracted open detail is removed on refresh", async () => { mount(); await center(); fireEvent.click(screen.getByRole("button", { name: /공지 n1/ })); await screen.findByRole("heading", { name: "공지 n1" }); value = { ...value, items: [], unread_count: 0 }; act(() => signal()); await waitFor(() => expect(screen.queryByRole("heading", { name: "공지 n1" })).toBeNull()); });
  it("renders plain text without HTML execution", async () => { value.items[0].message = '<img src=x onerror="bad()">'; mount(); await center(); fireEvent.click(screen.getByRole("button", { name: /공지 n1/ })); expect(await screen.findByText('<img src=x onerror="bad()">')).toBeTruthy(); expect(document.querySelector(".pn-body img")).toBeNull(); });
});
describe("publisher workflow", () => {
  it("ALL preview excludes author and publishes exact server input", async () => { await composer(); fillComposer(); fireEvent.click(screen.getByRole("button", { name: "지금 발행" })); await waitFor(() => expect(repo.publish).toHaveBeenCalledTimes(1)); const p=vi.mocked(repo.publish).mock.calls[0][0]; expect(p).toMatchObject({ title: "팀 안내", body: "내일 운영 안내입니다.", targetKind: "ALL", userIds: [] }); expect(p.requestId).toBeTruthy(); expect(await screen.findByText("공지를 발행했습니다.")).toBeTruthy(); });
  it("USER supports multiple recipients including explicit author", async () => { await composer(); fillComposer(); fireEvent.change(screen.getByLabelText("대상"), { target: { value: "USER" } }); fireEvent.click(screen.getByLabelText("직원 가")); fireEvent.click(screen.getByLabelText("작성자 (나)")); fireEvent.click(screen.getByRole("button", { name: "지금 발행" })); await waitFor(() => expect(repo.publish).toHaveBeenCalled()); expect(vi.mocked(repo.publish).mock.calls[0][0].userIds).toEqual(["u2","u1"]); });
  it("ambiguous retry preserves the exact request and frozen payload", async () => { vi.mocked(repo.publish).mockRejectedValueOnce(new Error("연결 끊김")); await composer(); fillComposer(); fireEvent.click(screen.getByRole("button", { name: "지금 발행" })); await screen.findByText("연결 끊김"); fireEvent.click(screen.getByRole("button", { name: "같은 요청 다시 확인" })); await waitFor(() => expect(repo.publish).toHaveBeenCalledTimes(2)); expect(vi.mocked(repo.publish).mock.calls[0][0]).toEqual(vi.mocked(repo.publish).mock.calls[1][0]); });
  it("ambiguous publish preserves retry identity after closing and reopening composer", async () => {
    vi.mocked(repo.publish).mockRejectedValueOnce(new Error("연결 끊김")); await composer(); fillComposer();
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" })); await screen.findByText("연결 끊김");
    fireEvent.click(screen.getByRole("button", { name: "닫기" })); await center();
    fireEvent.click(screen.getByRole("button", { name: "발행 결과 확인" }));
    fireEvent.click(await screen.findByRole("button", { name: "같은 요청 다시 확인" }));
    await waitFor(() => expect(repo.publish).toHaveBeenCalledTimes(2));
    expect(vi.mocked(repo.publish).mock.calls[0][0]).toEqual(vi.mocked(repo.publish).mock.calls[1][0]);
  });
  it("definite input rejection allows correction", async () => { vi.mocked(repo.publish).mockRejectedValueOnce(new NotificationFailure("대상 변경", true)); await composer(); fillComposer(); fireEvent.click(screen.getByRole("button", { name: "지금 발행" })); await screen.findByText("대상 변경"); expect(screen.getByRole("button", { name: "지금 발행" })).toBeTruthy(); expect((screen.getByLabelText(/제목/) as HTMLInputElement).disabled).toBe(false); });
  it("expiry is interpreted as KST, never browser local zone", async () => { await composer(); fillComposer(); fireEvent.change(screen.getByLabelText(/게시 종료/), { target: { value: "2030-09-30T09:00" } }); fireEvent.click(screen.getByRole("button", { name: "지금 발행" })); await waitFor(() => expect(repo.publish).toHaveBeenCalled()); expect(vi.mocked(repo.publish).mock.calls[0][0].expiresAt).toBe("2030-09-30T00:00:00.000Z"); });
  it("receipt view shows fixed audience and read / ACK distinction", async () => { value.can_publish = true; value.can_view_receipts = true; mount(); await center(); fireEvent.click(screen.getByText("보낸 공지")); fireEvent.click(await screen.findByRole("button", { name: /보낸 공지 제목/ })); await screen.findByText("직원 가"); expect(screen.getByText("직원 나")).toBeTruthy(); expect(screen.getByText("안 읽음 · 미확인")).toBeTruthy(); });
  it("retract requires an explicit confirmation and uses only its RPC", async () => { value.can_publish = true; value.can_view_receipts = true; mount(); await center(); fireEvent.click(screen.getByText("보낸 공지")); fireEvent.click(await screen.findByRole("button", { name: /보낸 공지 제목/ })); fireEvent.click(await screen.findByRole("button", { name: "공지 회수…" })); expect(repo.retract).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "공지 회수" })); await waitFor(() => expect(repo.retract).toHaveBeenCalledWith("a1")); });
  it("publisher without receipt grant never requests another employee receipts", async () => { value.can_publish = true; mount(); await center(); fireEvent.click(screen.getByText("보낸 공지")); fireEvent.click(await screen.findByRole("button", { name: /보낸 공지 제목/ })); expect(await screen.findByText("확인 현황 조회 권한이 없습니다.")).toBeTruthy(); expect(repo.receipts).not.toHaveBeenCalled(); });
  it("Escape closes the shared modal; center has no speculative category tabs", async () => { mount(); await center(); const dialog=screen.getByRole("dialog"); expect(within(dialog).queryByText("매출")).toBeNull(); fireEvent.keyDown(document, { key: "Escape" }); expect(screen.queryByRole("dialog")).toBeNull(); });
});

describe("center and sent UX refinement", () => {
  async function sentDetail() {
    value.can_publish = true; value.can_view_receipts = true;
    mount(); await center();
    fireEvent.click(screen.getByRole("button", { name: "보낸 공지" }));
    fireEvent.click(await screen.findByRole("button", { name: /보낸 공지 제목/ }));
    await screen.findByRole("button", { name: "수정해서 다시 보내기" });
  }
  it("publisher modes are primary and filters belong only to received", async () => {
    await sentDetail();
    expect(screen.getByRole("navigation", { name: "알림센터 메뉴" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "전체" })).toBeNull();
    expect(screen.getByRole("button", { name: "공지 작성" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "받은 알림" }));
    fireEvent.click(await screen.findByRole("button", { name: /읽지 않음 1/ }));
    await waitFor(() => expect(repo.inbox).toHaveBeenCalledWith(0, true));
    expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull();
  });
  it("receipt-only capability can open own sent history without publisher RPC or commands", async () => {
    value.can_view_receipts = true;
    vi.mocked(repo.sentForReceiptViewer).mockResolvedValue(await repo.sent());
    vi.mocked(repo.sent).mockClear();
    mount(); await center(); fireEvent.click(screen.getByRole("button", { name: "보낸 공지" }));
    fireEvent.click(await screen.findByRole("button", { name: /보낸 공지 제목/ }));
    await screen.findByText("직원 가");
    expect(repo.sentForReceiptViewer).toHaveBeenCalledWith("u1", 0);
    expect(repo.sent).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /공지 작성|수정해서|공지 회수/ })).toBeNull();
  });
  it("read styling does not imply ACK; staff has no sent tab", async () => {
    value.items = [notice(), notice("n2", { read_at: "now", ack_required: true }), notice("n3", { read_at: "now", ack_required: true, acknowledged_at: "now" })];
    mount(); await center();
    expect(screen.getByRole("button", { name: /공지 n1/ }).className).toContain("pn-unread");
    fireEvent.click(screen.getByRole("button", { name: "전체 기록" }));
    const read = screen.getByRole("button", { name: /공지 n2/ });
    expect(read.className).toContain("pn-read");
    expect(within(read).getByText("확인 필요").className).toContain("pn-needs-ack");
    expect(within(screen.getByRole("button", { name: /공지 n3/ })).getByText("확인 완료").className).toContain("pn-acked");
    expect(screen.queryByRole("button", { name: "보낸 공지" })).toBeNull();
  });
  it("republish prefills exact audience and creates a new request before optional retract", async () => {
    await sentDetail();
    fireEvent.click(screen.getByRole("button", { name: "수정해서 다시 보내기" }));
    await screen.findByText(/예상 대상 1명/);
    expect((screen.getByLabelText(/제목/) as HTMLInputElement).value).toBe("보낸 공지 제목");
    expect((screen.getByLabelText("대상") as HTMLSelectElement).value).toBe("USER");
    expect((screen.getByLabelText("직원 가") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("중요도") as HTMLSelectElement).value).toBe("IMPORTANT");
    expect((screen.getByLabelText(/기록 필요/) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "새 공지" } });
    expect(repo.retract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    await screen.findByRole("button", { name: "기존 공지 유지" });
    expect(repo.publish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.publish).mock.calls[0][0]).toMatchObject({ title: "새 공지", targetKind: "USER", userIds: ["u2"] });
    expect(vi.mocked(repo.publish).mock.calls[0][0].requestId).not.toBe("a1");
    expect(repo.retract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "기존 공지 회수" }));
    await waitFor(() => expect(repo.retract).toHaveBeenCalledWith("a1"));
  });
  it("failed republish never retracts; close/reopen retry keeps identity and original association", async () => {
    vi.mocked(repo.publish).mockRejectedValueOnce(new Error("연결 끊김"));
    await sentDetail(); fireEvent.click(screen.getByRole("button", { name: "수정해서 다시 보내기" }));
    await screen.findByText(/예상 대상 1명/);
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    await screen.findByText("연결 끊김"); expect(repo.retract).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "기존 공지 회수" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "닫기" })); await center();
    fireEvent.click(screen.getByRole("button", { name: "발행 결과 확인" }));
    await screen.findByText(/예상 대상 1명/);
    fireEvent.click(screen.getByRole("button", { name: "같은 요청 다시 확인" }));
    await screen.findByRole("button", { name: "기존 공지 유지" });
    expect(vi.mocked(repo.publish).mock.calls[0][0]).toEqual(vi.mocked(repo.publish).mock.calls[1][0]);
    fireEvent.click(screen.getByRole("button", { name: "기존 공지 유지" }));
    expect(repo.retract).not.toHaveBeenCalled();
  });
  it("missing audience fails closed without defaulting to ALL", async () => {
    vi.mocked(repo.audience).mockRejectedValue(new Error("기존 대상 확인 불가"));
    await sentDetail(); fireEvent.click(screen.getByRole("button", { name: "수정해서 다시 보내기" }));
    await screen.findByText("기존 대상 확인 불가");
    expect(screen.queryByRole("button", { name: "지금 발행" })).toBeNull();
    expect(repo.publish).not.toHaveBeenCalled();
  });
  it("unavailable historical recipients require explicit removal", async () => {
    vi.mocked(repo.audience).mockResolvedValue({ targetKind: "USER", userIds: ["u2", "inactive"] });
    await sentDetail(); fireEvent.click(screen.getByRole("button", { name: "수정해서 다시 보내기" }));
    await screen.findByText(/현재 선택할 수 없는 기존 대상 1명/);
    expect((screen.getByRole("button", { name: "지금 발행" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "해당 대상 제외" }));
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    await waitFor(() => expect(repo.publish).toHaveBeenCalled());
    expect(vi.mocked(repo.publish).mock.calls[0][0].userIds).toEqual(["u2"]);
  });
  it("retracted notice can republish ALL with expired date cleared and no retract offer", async () => {
    const original = (await repo.sent())[0];
    vi.mocked(repo.sent).mockResolvedValue([{ ...original, state: "RETRACTED", expires_at: "2020-01-01T00:00:00Z" }]);
    vi.mocked(repo.audience).mockResolvedValue({ targetKind: "ALL", userIds: [] });
    await sentDetail();
    expect(screen.queryByRole("button", { name: /공지 회수/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "수정해서 다시 보내기" }));
    await screen.findByText(/예상 대상 2명/);
    expect((screen.getByLabelText(/게시 종료/) as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    await screen.findByText("공지를 발행했습니다.");
    expect(screen.queryByRole("button", { name: "기존 공지 회수" })).toBeNull();
  });
  it("republish retains future expiry in KST and a fresh publish identity", async () => {
    const original = (await repo.sent())[0];
    vi.mocked(repo.sent).mockResolvedValue([{ ...original, expires_at: "2030-09-30T00:00:00Z" }]);
    await sentDetail(); fireEvent.click(screen.getByRole("button", { name: "수정해서 다시 보내기" }));
    await screen.findByText(/예상 대상 1명/);
    expect((screen.getByLabelText(/게시 종료/) as HTMLInputElement).value).toBe("2030-09-30T09:00");
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    await waitFor(() => expect(repo.publish).toHaveBeenCalled());
    expect(vi.mocked(repo.publish).mock.calls[0][0].expiresAt).toBe("2030-09-30T00:00:00.000Z");
  });
  it("one recipient read and ACK counts survive retract, while inbox refresh removes the notice", async () => {
    vi.mocked(repo.receipts).mockResolvedValue([{ recipient_id: "u2", name: "직원 가", active: true, read_at: "now", acknowledged_at: "now", revoked_at: null }]);
    vi.mocked(repo.retract).mockImplementation(async () => { value = { ...value, items: [], unread_count: 0 }; });
    await sentDetail(); await screen.findByText("직원 가");
    expect([...document.querySelectorAll(".pn-stat-grid b")].map(n => n.textContent)).toEqual(["1", "1", "1", "0"]);
    fireEvent.click(screen.getByRole("button", { name: "공지 회수…" }));
    fireEvent.click(screen.getByRole("button", { name: "공지 회수" }));
    await waitFor(() => expect(repo.retract).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "받은 알림" }));
    await screen.findByText("새로운 알림이 없습니다.");
    expect(screen.queryByRole("button", { name: /공지 n1/ })).toBeNull();
  });

});

describe("announcement hard delete", () => {
  async function openSent(retracted = false) {
    value.can_publish = true; value.can_view_receipts = true;
    if (retracted) vi.mocked(repo.sent).mockResolvedValue((await repo.sent()).map(a => ({ ...a, state: "RETRACTED" })));
    mount(); await center(); fireEvent.click(screen.getByRole("button", { name: "보낸 공지" }));
    fireEvent.click(await screen.findByRole("button", { name: /보낸 공지 제목/ }));
    await screen.findByRole("button", { name: "공지 삭제" });
  }
  it.each([false, true])("author detail offers explicit confirmed delete, retracted=%s", async retracted => {
    await openSent(retracted); fireEvent.click(screen.getByRole("button", { name: "공지 삭제" }));
    expect(screen.getByRole("heading", { name: "공지를 완전히 삭제할까요?" })).toBeTruthy();
    expect(screen.getByText(/삭제 후에는 복구할 수 없습니다/)).toBeTruthy();
    expect(repo.deleteAnnouncement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("button", { name: "삭제" })).toBeNull();
    expect(repo.deleteAnnouncement).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "보낸 공지 제목" })).toBeTruthy();
  });
  it("deletes exactly once only after confirmation and refreshes canonical sent list", async () => {
    await openSent();
    let finish!: () => void;
    vi.mocked(repo.deleteAnnouncement).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "공지 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(screen.getByRole("heading", { name: "보낸 공지 제목" })).toBeTruthy();
    expect(repo.deleteAnnouncement).toHaveBeenCalledTimes(1); expect(repo.deleteAnnouncement).toHaveBeenCalledWith("a1");
    vi.mocked(repo.sent).mockResolvedValue([]);
    await act(async () => finish());
    expect(await screen.findByText("공지를 삭제했습니다.")).toBeTruthy();
    expect(await screen.findByText("아직 발행한 공지가 없습니다.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "보낸 공지 제목" })).toBeNull();
    expect(repo.sent).toHaveBeenCalledTimes(2);
  });
  it("RPC failure preserves detail and sent row without optimistic removal", async () => {
    await openSent(); vi.mocked(repo.deleteAnnouncement).mockRejectedValue(new Error("삭제 실패"));
    fireEvent.click(screen.getByRole("button", { name: "공지 삭제" })); fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(await screen.findByText("삭제 실패")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "보낸 공지 제목" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← 보낸 공지 목록" }));
    expect(await screen.findByRole("button", { name: /보낸 공지 제목/ })).toBeTruthy();
    expect(screen.queryByText("공지를 삭제했습니다.")).toBeNull();
  });
  it("staff has no delete action", async () => { mount(); await center(); expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull(); });
  it("recipient deletion invalidation refetches rows and canonical unread count", async () => {
    mount(); await center(); const calls=vi.mocked(repo.inbox).mock.calls.length;
    value={...value,items:[],popup:[],unread_count:0,unacknowledged_count:0}; act(() => signal());
    await waitFor(() => expect(screen.queryByRole("button", { name: /공지 n1/ })).toBeNull());
    expect(screen.getByRole("button", { name: "알림센터, 읽지 않은 알림 0개" })).toBeTruthy();
    expect(vi.mocked(repo.inbox).mock.calls.length).toBeGreaterThan(calls);
  });
  it("recipient popup loses deleted notice after server refetch", async () => {
    value.popup=[notice()]; mount(); await screen.findByRole("button", { name: /공지 n1/ });
    value={...value,items:[],popup:[],unread_count:0}; act(() => signal());
    await waitFor(() => expect(screen.queryByRole("button", { name: /공지 n1/ })).toBeNull());
    expect(repo.read).not.toHaveBeenCalled(); expect(repo.acknowledge).not.toHaveBeenCalled();
  });
  it("terminal deleted publish request releases retry lock and next publish uses new request", async () => {
    vi.mocked(repo.publish).mockRejectedValueOnce(new NotificationFailure("이 발행 요청의 공지는 삭제되었습니다.", true));
    await composer(); fillComposer(); fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    await screen.findByText("이 발행 요청의 공지는 삭제되었습니다.");
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    await waitFor(() => expect(repo.publish).toHaveBeenCalledTimes(2));
    expect(vi.mocked(repo.publish).mock.calls[0][0].requestId).not.toBe(vi.mocked(repo.publish).mock.calls[1][0].requestId);
  });
});

describe("announcement expiry composer contract", () => {
  const expiryInput = () => screen.getByLabelText(/게시 종료/) as HTMLInputElement;
  const now = Date.parse("2026-10-01T09:36:00Z");
  beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(now));
  it("new composer is empty and cancelled drafts do not survive reopen", async () => {
    await composer();
    expect(expiryInput().value).toBe("");
    expect(expiryInput().min).toBe("2026-10-01T18:37");
    fireEvent.change(expiryInput(), { target: { value: "2026-10-02T12:30" } });
    fireEvent.click(screen.getByRole("button", { name: "닫기" })); await center();
    fireEvent.click(screen.getByRole("button", { name: "공지 작성" }));
    expect(expiryInput().value).toBe("");
    expect(repo.publish).not.toHaveBeenCalled();
  });
  it.each(["2026-10-01T12:30", "2026-10-01T18:36"])("rejects past/current expiry %s before RPC even without native constraints", async expiry => {
    await composer(); fillComposer();
    fireEvent.change(expiryInput(), { target: { value: expiry } });
    fireEvent.submit(expiryInput().closest("form")!);
    expect(await screen.findByText("게시 종료 시간은 현재보다 이후로 설정해주세요.")).toBeTruthy();
    expect(repo.publish).not.toHaveBeenCalled();
  });
  it("native invalid input uses the same specific visible message", async () => {
    await composer(); fillComposer();
    fireEvent.change(expiryInput(), { target: { value: "2026-10-01T12:30" } });
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    expect(await screen.findByText("게시 종료 시간은 현재보다 이후로 설정해주세요.")).toBeTruthy();
    expect(repo.publish).not.toHaveBeenCalled();
  });
  it.each(["", "2026-10-02T00:15"])("publishes optional expiry %s and resets after success", async expiry => {
    await composer(); fillComposer();
    fireEvent.change(expiryInput(), { target: { value: expiry } });
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    await waitFor(() => expect(repo.publish).toHaveBeenCalledTimes(1));
    expect(vi.mocked(repo.publish).mock.calls[0][0].expiresAt).toBe(expiry ? "2026-10-01T15:15:00.000Z" : null);
    await screen.findByRole("button", { name: /보낸 공지 제목/ });
    fireEvent.click(screen.getByRole("button", { name: "닫기" })); await center();
    fireEvent.click(screen.getByRole("button", { name: "공지 작성" }));
    expect(expiryInput().value).toBe("");
  });
  it("server expiry rejection permits correction without freezing the invalid request", async () => {
    vi.mocked(repo.publish).mockRejectedValueOnce(new NotificationFailure("게시 종료 시간은 현재보다 이후로 설정해주세요.", true));
    await composer(); fillComposer();
    fireEvent.change(expiryInput(), { target: { value: "2026-10-02T12:30" } });
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    await screen.findByText("게시 종료 시간은 현재보다 이후로 설정해주세요.");
    expect(expiryInput().closest("fieldset")!.disabled).toBe(false);
    fireEvent.change(expiryInput(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "지금 발행" }));
    await waitFor(() => expect(repo.publish).toHaveBeenCalledTimes(2));
    expect(vi.mocked(repo.publish).mock.calls[1][0].expiresAt).toBeNull();
  });
});
