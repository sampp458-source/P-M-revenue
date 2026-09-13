// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import type { HotelStay } from "./hotelOperationsRepository";
import { HotelMissedCheckInRecoveryModal } from "./HotelMissedCheckInRecoveryModal";
import { needsMissedCheckInRecovery } from "./hotelMissedCheckInRecovery";
const read = vi.hoisted(() => vi.fn());
vi.mock("./hotelOperationsRepository", () => ({ getHotelMissedCheckInEligibility: read }));
afterEach(() => { cleanup(); read.mockReset(); });
const stay = { id:"synthetic-stay", version:3, dogName:"합성 반려견", checkedInAt:null, checkedOutAt:null,
  capacityReservation:{ id:"capacity", roomTypeId:"type", reservedFrom:"2002-01-01T00:00:00Z", reservedUntil:"2002-01-04T00:00:00Z" },
  roomAllocations:[], scheduleEvents:[{eventKind:"check_in", schedule:{ startsAt:"2002-01-01T00:00:00Z", timeUnspecified:false }}],
} as unknown as HotelStay;
const response = { stayId:stay.id, stayVersion:3, capacityVersion:7, reasonCode:null,
 rooms:[{roomId:"room",roomName:"합성 호실",eligible:true,recommended:true}] };
const A="2002-01-01T09:51", B="2002-01-02T10:00", C="2002-01-03T10:00";
function view(submit = vi.fn().mockResolvedValue(false)) {
 return { submit, ...render(<HotelMissedCheckInRecoveryModal open stay={stay} processing={false} onClose={()=>{}} onSubmit={submit}/>) };
}
const setTime=(time:string)=>fireEvent.change(screen.getByLabelText("실제 입실 일시"),{target:{value:time}});
function chooseAndConfirm() {
 fireEvent.change(screen.getByLabelText("입실 객실"),{target:{value:"room"}});
 fireEvent.click(screen.getByRole("checkbox"));
}
it("never prefills actual time or queries from planned/current time; explicit confirmation required",async()=>{
 read.mockResolvedValue(response); const {submit}=view();
 expect(screen.getByLabelText("실제 입실 일시")).toHaveValue(""); expect(read).not.toHaveBeenCalled();
 expect(screen.getByRole("button",{name:"입실 기록 복구"})).toBeDisabled();
 setTime(A); await screen.findByRole("option",{name:/합성 호실/});
 expect(read).toHaveBeenCalledWith(stay.id,"2002-01-01T00:51:00.000Z");
 fireEvent.change(screen.getByLabelText("입실 객실"),{target:{value:"room"}});
 expect(screen.getByRole("button",{name:"입실 기록 복구"})).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));
 expect(screen.getByText(/2002-01-01 09:51.*한국시간.*합성 호실/)).toBeInTheDocument();
 await act(async()=>fireEvent.click(screen.getByRole("button",{name:"입실 기록 복구"})));
 expect(submit).toHaveBeenCalledWith("2002-01-01T00:51:00.000Z","room",3,7,expect.any(String));
});
it.each([{times:[B,A]},{times:[B,C,A]}])("discards completed A and intermediate responses during rapid $times",async({times})=>{
 const pending:((x:unknown)=>void)[]=[];read.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
 const {submit,container}=view();setTime(A);await waitFor(()=>expect(pending).toHaveLength(1));
 await act(async()=>pending[0](response));chooseAndConfirm();
 for(const time of times){setTime(time);expect(screen.getByLabelText("입실 객실")).toBeDisabled();expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();fireEvent.submit(container.querySelector('form')!);}
 expect(submit).not.toHaveBeenCalled();
 await act(async()=>pending.at(-1)!(response));
 for(let i=pending.length-2;i>0;i--) await act(async()=>pending[i]({...response,rooms:[]}));
 expect(screen.getByRole("option",{name:/합성 호실/})).toBeInTheDocument();
 expect(screen.getByRole("button",{name:"입실 기록 복구"})).toBeDisabled();
});
it("retry generation rejects stale responses and errors without room fallback",async()=>{
 const pending:{resolve:(x:unknown)=>void;reject:(x:unknown)=>void}[]=[];read.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
 view();setTime(A);await act(async()=>pending[0].reject(new Error("network")));
 expect(screen.getByRole("alert")).toHaveTextContent("다시 조회");
 fireEvent.click(screen.getByRole("button",{name:"다시 조회"}));fireEvent.click(screen.getByRole("button",{name:"다시 조회"}));
 await act(async()=>pending[1].resolve(response));expect(screen.getByLabelText("입실 객실")).toBeDisabled();
 await act(async()=>pending[2].resolve(response));expect(screen.getByLabelText("입실 객실")).toBeEnabled();
});
it("requires new confirmation after room/time changes and disables a closed recovery window",async()=>{
 read.mockResolvedValue(response);view();setTime(A);await screen.findByRole("option",{name:/합성 호실/});chooseAndConfirm();
 read.mockResolvedValue({...response,reasonCode:"RECOVERY_WINDOW_CLOSED",rooms:[{...response.rooms[0],eligible:false,recommended:false}]});
 setTime(B);await screen.findByRole("alert");expect(screen.getByRole("alert")).toHaveTextContent("종료");
 expect(screen.getByLabelText("입실 객실")).toBeDisabled();expect(screen.getByRole("button",{name:"입실 기록 복구"})).toBeDisabled();
});
it("synchronous submit lock and response-loss retry reuse the same request identity",async()=>{
 read.mockResolvedValue(response);let finish!:(v:boolean)=>void;
 const submit=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;}));const {container}=view(submit);
 setTime(A);await screen.findByRole("option",{name:/합성 호실/});chooseAndConfirm();
 fireEvent.submit(container.querySelector('form')!);fireEvent.submit(container.querySelector('form')!);expect(submit).toHaveBeenCalledTimes(1);
 const id=submit.mock.calls[0];await act(async()=>finish(false));await screen.findByRole("option",{name:/합성 호실/});chooseAndConfirm();
 fireEvent.submit(container.querySelector('form')!);expect(submit.mock.calls[1]).toEqual(id);await act(async()=>finish(false));
});
it("stay/version changes invalidate current results",async()=>{
 read.mockResolvedValue(response);const {rerender}=view();setTime(A);await screen.findByRole("option",{name:/합성 호실/});
 rerender(<HotelMissedCheckInRecoveryModal open stay={{...stay,version:4}} processing={false} onClose={()=>{}} onSubmit={vi.fn()}/>);
 await screen.findByRole("alert");expect(screen.getByLabelText("입실 객실")).toBeDisabled();
});
it("checkout time unspecified routes to recovery, not finalize; today/allocated/completed do not",()=>{
 const flexible={...stay,scheduleEvents:[...stay.scheduleEvents,{eventKind:"check_out" as const,schedule:{...stay.scheduleEvents[0].schedule,timeUnspecified:true}}]};
 expect(needsMissedCheckInRecovery(flexible,"2002-01-03")).toBe(true);
 expect(needsMissedCheckInRecovery(flexible,"2002-01-01")).toBe(false);
 expect(needsMissedCheckInRecovery({...flexible,checkedInAt:"2002-01-01T01:00Z"},"2002-01-03")).toBe(false);
 expect(needsMissedCheckInRecovery({...flexible,checkedOutAt:"2002-01-02T01:00Z"},"2002-01-03")).toBe(false);
 expect(needsMissedCheckInRecovery({...flexible,capacityReservation:null},"2002-01-03")).toBe(false);
 expect(needsMissedCheckInRecovery({...flexible,roomAllocations:[{id:"allocation",archivedAt:null} as HotelStay['roomAllocations'][number]]},"2002-01-03")).toBe(false);
});
it("releases submit lock on exception without assuming success",async()=>{
 read.mockResolvedValue(response);const submit=vi.fn().mockRejectedValue(new Error("response lost"));view(submit);
 setTime(A);await screen.findByRole("option",{name:/합성 호실/});chooseAndConfirm();
 await act(async()=>fireEvent.click(screen.getByRole("button",{name:"입실 기록 복구"})));
 expect(screen.getByRole("alert")).toHaveTextContent("결과를 확인하지 못했습니다");
 expect(screen.getByLabelText("실제 입실 일시")).toBeEnabled();
 expect(screen.getByRole("button",{name:"입실 기록 복구"})).toBeDisabled();
});
