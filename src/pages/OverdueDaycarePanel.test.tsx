// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { OverdueDaycarePanel } from "./OverdueDaycarePanel";
import type { DaycareReservation } from "./daycareOperationsRepository";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), checkout: vi.fn() }));
vi.mock("./daycareOperationsRepository", () => ({ fetchOverdueDaycareOperations: mocks.fetch, completeVerifiedDaycareCheckOut: mocks.checkout }));
const row = (room = 4): DaycareReservation => ({ operationScheduleId: `s${room}`, calendarId: "hotel", scheduleTypeId: "daycare", title: "Synthetic daycare", memo: null, startsAt: "2026-10-17T06:25:00Z", endsAt: "2026-10-17T13:00:00Z", scheduleStatus: "scheduled", scheduleVersion: 2, version: 3, lifecycleStatus: "checked_in", roomTypeId: "deluxe", roomTypeCode: "DELUXE", roomTypeName: "DELUXE", checkedInAt: "2026-10-17T06:31:00Z", checkedOutAt: null, cancelledAt: null, dog: { id: `d${room}`, name: `확인대상${room}`, customerId: null }, customer: { id: "c", name: null, phone: null }, assignees: [], capacityReservation: { id: `c${room}`, reservedFrom: "2026-10-17T06:25:00Z", reservedUntil: "2026-10-17T13:00:00Z", archivedAt: null }, roomAllocation: { id: `a${room}`, roomId: `r${room}`, roomName: `DELUXE ${room}`, allocatedFrom: "2026-10-17T06:25:00Z", allocatedUntil: "2026-10-17T13:00:00Z", version: 1 }, createdAt: "2026-10-17T00:00Z", updatedAt: "2026-10-17T06:31Z" });
beforeEach(() => { vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date("2026-10-20T06:00:00Z")); });
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });
it("shows both prior-day physical holds without a checkout default or automatic mutation", async () => {
 mocks.fetch.mockResolvedValue([row(), row(5)]); render(<OverdueDaycarePanel refreshKey={1} onChanged={vi.fn()} />);
 expect(await screen.findByText("확인대상4 · DELUXE 4")).toBeVisible(); expect(screen.getByText("확인대상5 · DELUXE 5")).toBeVisible();
 expect(screen.getAllByText(/실제 퇴실 기록 없음/)).toHaveLength(2); expect(screen.getAllByRole("button", { name: "확인한 퇴실 기록" }).every(b => (b as HTMLButtonElement).disabled)).toBe(true);
 expect(screen.getByLabelText("확인대상4 실제 퇴실 시간")).toHaveValue(""); expect(mocks.checkout).not.toHaveBeenCalled();
});
it("requires explicit date, time and verification; supports cross-date KST and prevents double click", async () => {
 mocks.fetch.mockResolvedValueOnce([row()]).mockResolvedValue([]); let resolve!: () => void; mocks.checkout.mockImplementation(() => new Promise<void>(done => { resolve = done; })); const changed = vi.fn().mockResolvedValue(undefined);
 render(<OverdueDaycarePanel refreshKey={1} onChanged={changed} />); await screen.findByLabelText("확인대상4 실제 퇴실 날짜"); const button = screen.getByRole("button", { name: "확인한 퇴실 기록" });
 fireEvent.change(screen.getByLabelText("확인대상4 실제 퇴실 날짜"), { target: { value: "2026-10-18" } }); expect(button).toBeDisabled();
 fireEvent.change(screen.getByLabelText("확인대상4 실제 퇴실 시간"), { target: { value: "17:00" } }); expect(button).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox"));
 expect(screen.getByRole("status")).toHaveTextContent("실제 퇴실: 2026-10-18 17:00 KST"); fireEvent.click(button); fireEvent.click(button);
 expect(mocks.checkout).toHaveBeenCalledTimes(1); expect(mocks.checkout).toHaveBeenCalledWith("s4",3,"2026-10-18T08:00:00.000Z",true,expect.any(String)); resolve(); await waitFor(() => expect(changed).toHaveBeenCalledTimes(1)); await waitFor(() => expect(screen.queryByText("확인대상4 · DELUXE 4")).not.toBeInTheDocument());
});
it("keeps a failed checkout visible, refreshes state and requires verification again", async () => {
 mocks.fetch.mockResolvedValue([row()]); mocks.checkout.mockRejectedValue(new Error("권한 또는 version 확인 필요")); render(<OverdueDaycarePanel refreshKey={1} onChanged={vi.fn().mockResolvedValue(undefined)} />);
 fireEvent.change(await screen.findByLabelText("확인대상4 실제 퇴실 날짜"), { target: { value: "2026-10-17" } }); fireEvent.change(screen.getByLabelText("확인대상4 실제 퇴실 시간"), { target: { value: "18:00" } }); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "확인한 퇴실 기록" }));
 expect(await screen.findByRole("alert")).toHaveTextContent("권한 또는 version"); expect(screen.getByText("확인대상4 · DELUXE 4")).toBeVisible(); await waitFor(() => expect(screen.getByRole("button", { name: "확인한 퇴실 기록" })).toBeDisabled()); expect(mocks.checkout).toHaveBeenCalledTimes(1);
});
it("displays read failure rather than treating rooms as empty; supports explicit refresh", async () => {
 mocks.fetch.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([row()]); render(<OverdueDaycarePanel refreshKey={1} onChanged={vi.fn()} />);
 expect(await screen.findByRole("alert")).toHaveTextContent("비어 있다고 판단하지 말고"); fireEvent.click(screen.getByRole("button", { name: "다시 조회" })); expect(await screen.findByText("확인대상4 · DELUXE 4")).toBeVisible();
});
it("ignores late results after date navigation/unmount", async () => {
 let resolve!: (value: DaycareReservation[]) => void; mocks.fetch.mockImplementation(() => new Promise<DaycareReservation[]>(done => { resolve = done; })); const view = render(<OverdueDaycarePanel refreshKey={1} onChanged={vi.fn()} />); view.unmount(); resolve([row()]); expect(mocks.checkout).not.toHaveBeenCalled();
});
it("does not add historical completed records or a second capacity/board data source", () => {
 const page = readFileSync("src/pages/HotelOperations.tsx", "utf8"); expect(page).toContain('dateMode === "TODAY" ? <OverdueDaycarePanel'); expect(page).toContain("daycareReservations={daycareReservations}");
 const migration = readFileSync("supabase/migrations/202610200001_overdue_daycare_operations_v1.sql", "utf8"); expect(migration).toContain("state.lifecycle_status = 'checked_in'"); expect(migration).toContain("state.checked_out_at is null"); expect(migration).not.toMatch(/\b(update|delete|insert)\s+(into|public\.)/i);
});

it.each([["2026-10-17","15:00"],["2099-10-18","17:00"],["2026-10-18",""]])("rejects before-entry/future/unknown times: %s %s",async(date,time)=>{
 mocks.fetch.mockResolvedValue([row()]);render(<OverdueDaycarePanel refreshKey={1} onChanged={vi.fn()} />);
 fireEvent.change(await screen.findByLabelText("확인대상4 실제 퇴실 날짜"),{target:{value:date}});fireEvent.change(screen.getByLabelText("확인대상4 실제 퇴실 시간"),{target:{value:time}});fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'확인한 퇴실 기록'})).toBeDisabled();expect(mocks.checkout).not.toHaveBeenCalled();
});
it("reuses the same command identity after uncertain failure until input/version changes",async()=>{
 mocks.fetch.mockResolvedValue([row()]);mocks.checkout.mockRejectedValue(new Error('결과 확인 필요'));render(<OverdueDaycarePanel refreshKey={1} onChanged={vi.fn().mockResolvedValue(undefined)} />);
 fireEvent.change(await screen.findByLabelText('확인대상4 실제 퇴실 날짜'),{target:{value:'2026-10-18'}});fireEvent.change(screen.getByLabelText('확인대상4 실제 퇴실 시간'),{target:{value:'17:00'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'확인한 퇴실 기록'}));await screen.findByRole('alert');await waitFor(()=>expect(screen.getByRole('checkbox')).not.toBeChecked());fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'확인한 퇴실 기록'}));await waitFor(()=>expect(mocks.checkout).toHaveBeenCalledTimes(2));expect(mocks.checkout.mock.calls[1][4]).toBe(mocks.checkout.mock.calls[0][4]);
});

it("editing either actual date or time requires a new explicit confirmation",async()=>{
 mocks.fetch.mockResolvedValue([row()]);render(<OverdueDaycarePanel refreshKey={1} onChanged={vi.fn()} />);fireEvent.change(await screen.findByLabelText('확인대상4 실제 퇴실 날짜'),{target:{value:'2026-10-18'}});fireEvent.change(screen.getByLabelText('확인대상4 실제 퇴실 시간'),{target:{value:'17:00'}});fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'확인한 퇴실 기록'})).toBeEnabled();fireEvent.change(screen.getByLabelText('확인대상4 실제 퇴실 시간'),{target:{value:'17:30'}});expect(screen.getByRole('checkbox')).not.toBeChecked();expect(screen.queryByRole('status')).toBeNull();expect(screen.getByRole('button',{name:'확인한 퇴실 기록'})).toBeDisabled();expect(mocks.checkout).not.toHaveBeenCalled();
});
