// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import type { HotelStay } from "./hotelOperationsRepository";
import { HotelSingleActualCheckInModal } from "./HotelSingleActualCheckInModal";
const read = vi.hoisted(() => vi.fn());
vi.mock("./hotelOperationsRepository", () => ({getHotelSingleRoomEligibility:read}));
afterEach(() => {cleanup();read.mockReset();});
const stay={id:"stay",version:3,dogName:"합성 반려견"} as HotelStay;
const response={stayId:"stay",stayVersion:3,capacityVersion:7,rooms:[{roomId:"room",roomName:"합성 호실",eligible:true,recommended:true}]};
it("invalidates old actual-time results and requires explicit room selection",async()=>{
 read.mockResolvedValue(response);
 const submit=vi.fn().mockResolvedValue(undefined);
 render(<HotelSingleActualCheckInModal open stay={stay} processing={false} onClose={()=>{}} onSubmit={submit}/>);
 await screen.findByRole("option",{name:/합성 호실/});
 expect(screen.getByRole("button",{name:"입실 확정"})).toBeDisabled();
 fireEvent.change(screen.getByLabelText("입실 객실"),{target:{value:"room"}});
 await act(async()=>fireEvent.click(screen.getByRole("button",{name:"입실 확정"})));
 expect(submit).toHaveBeenCalledWith(expect.any(String),"room",3,7);
});
it("discards a stale response after time change; no current-room fallback",async()=>{
 const pending:((value:unknown)=>void)[]=[];
 read.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
 const {container}=render(<HotelSingleActualCheckInModal open stay={stay} processing={false} onClose={()=>{}} onSubmit={vi.fn()}/>);
 await waitFor(()=>expect(pending).toHaveLength(1));
 fireEvent.change(container.querySelector('input[type="datetime-local"]')!,{target:{value:"2002-01-01T09:51"}});
 await waitFor(()=>expect(pending).toHaveLength(2));
 await act(async()=>pending[0](response));
 expect(screen.queryByRole("option",{name:/합성 호실/})).not.toBeInTheDocument();
 await act(async()=>pending[1]({...response,rooms:[]}));
 expect(screen.getByRole("button",{name:"입실 확정"})).toBeDisabled();
});
it("synchronously locks double submit until completion",async()=>{
 read.mockResolvedValue(response);let finish!:()=>void;
 const submit=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const {container}=render(<HotelSingleActualCheckInModal open stay={stay} processing={false} onClose={()=>{}} onSubmit={submit}/>);
 await screen.findByRole("option",{name:/합성 호실/});
 fireEvent.change(screen.getByLabelText("입실 객실"),{target:{value:"room"}});
 fireEvent.submit(container.querySelector('form')!);fireEvent.submit(container.querySelector('form')!);
 expect(submit).toHaveBeenCalledTimes(1);
 await act(async()=>finish());
});

function deferredReads() {
 const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
 read.mockImplementation(() => new Promise((resolve, reject) => pending.push({resolve, reject})));
 return pending;
}
function expectLoadingLocked(container: HTMLElement, submit: ReturnType<typeof vi.fn>) {
 expect(screen.getByLabelText("입실 객실")).toBeDisabled();
 expect(screen.getByRole("button", {name:"입실 확정"})).toBeDisabled();
 expect(screen.queryByRole("option", {name:/합성 호실/})).not.toBeInTheDocument();
 expect(screen.getByRole("status")).toHaveTextContent("객실 확인 중");
 fireEvent.submit(container.querySelector("form")!);
 expect(submit).not.toHaveBeenCalled();
}
it.each([
 ["A → B → A", ["2002-01-01T09:51"]],
 ["A → B → C → A", ["2002-01-01T09:51", "2002-01-01T10:51"]],
])("keeps completed A inactive throughout %s until the latest generation resolves", async (_label, times) => {
 const pending = deferredReads();
 const submit = vi.fn().mockResolvedValue(undefined);
 const {container} = render(<HotelSingleActualCheckInModal open stay={stay} processing={false} onClose={()=>{}} onSubmit={submit}/>);
 await waitFor(()=>expect(pending).toHaveLength(1));
 const input = container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
 const originalTime = input.value;
 await act(async()=>pending[0].resolve(response));
 fireEvent.change(screen.getByLabelText("입실 객실"), {target:{value:"room"}});
 expect(screen.getByRole("button", {name:"입실 확정"})).toBeEnabled();
 for (const time of [...times, originalTime]) {
  fireEvent.change(input, {target:{value:time}});
  expectLoadingLocked(container, submit);
 }
 expect(pending).toHaveLength(times.length + 2);
 const latest = pending.length - 1;
 await act(async()=>pending[latest].resolve(response));
 // Late intermediate generations must not replace the latest successful response.
 for (let i = latest - 1; i > 0; i--) {
  await act(async()=>pending[i].resolve({...response, rooms:[]}));
  expect(screen.getByRole("option", {name:/합성 호실/})).toBeInTheDocument();
 }
 expect(screen.getByRole("button", {name:"입실 확정"})).toBeDisabled();
 fireEvent.change(screen.getByLabelText("입실 객실"), {target:{value:"room"}});
 await act(async()=>fireEvent.submit(container.querySelector("form")!));
 expect(submit).toHaveBeenCalledTimes(1);
});
it("retry uses a new generation after network error and discards superseded retry responses", async()=>{
 const pending = deferredReads();
 const submit = vi.fn();
 const {container} = render(<HotelSingleActualCheckInModal open stay={stay} processing={false} onClose={()=>{}} onSubmit={submit}/>);
 await waitFor(()=>expect(pending).toHaveLength(1));
 await act(async()=>pending[0].reject(new Error("network")));
 expect(screen.getByRole("alert")).toHaveTextContent("다시 조회");
 fireEvent.click(screen.getByRole("button", {name:"다시 조회"}));
 expectLoadingLocked(container, submit);
 fireEvent.click(screen.getByRole("button", {name:"다시 조회"}));
 expect(pending).toHaveLength(3);
 await act(async()=>pending[1].resolve(response));
 expectLoadingLocked(container, submit);
 await act(async()=>pending[2].resolve(response));
 expect(screen.getByLabelText("입실 객실")).toBeEnabled();
});
it("invalidates eligibility on stay version and identity changes", async()=>{
 const pending = deferredReads();
 const submit = vi.fn();
 const props = {open:true, stay, processing:false, onClose:()=>{}, onSubmit:submit};
 const {container, rerender} = render(<HotelSingleActualCheckInModal {...props}/>);
 await waitFor(()=>expect(pending).toHaveLength(1));
 await act(async()=>pending[0].resolve(response));
 rerender(<HotelSingleActualCheckInModal {...props} stay={{...stay,version:4}}/>);
 expectLoadingLocked(container, submit);
 rerender(<HotelSingleActualCheckInModal {...props} stay={{...stay,id:"another-stay",version:4}}/>);
 expectLoadingLocked(container, submit);
 await act(async()=>pending[1].resolve(response));
 expectLoadingLocked(container, submit);
 await act(async()=>pending[pending.length-1].resolve({...response,stayId:"another-stay",stayVersion:4}));
 expect(screen.getByLabelText("입실 객실")).toBeEnabled();
});
