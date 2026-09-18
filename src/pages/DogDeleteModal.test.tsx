// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DogDeleteModal } from "./DogDeleteModal";
import { type DogRemovalPreview } from "./dogHistoricalIdentityRepository";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));
const base = { dog:{recordDogId:"dog",displayName:"초코"},version:1,commandAvailable:true,contractVersion:"dog-profile-preview-v2b-1",categories:[],warnings:[],activeBlockerCount:0,proposedMode:"hard_delete",graphFingerprint:"graph" } as unknown as DogRemovalPreview;
beforeEach(()=>{mocks.rpc.mockReset();mocks.rpc.mockImplementation(async (name,input)=>({data:name==="preview_dog_profile_removal"?base:{dogId:"dog",mode:"hard_delete",requestId:input.p_request_id},error:null}));});
afterEach(cleanup);
const open=(onDeleted=vi.fn(),onClose=vi.fn())=>render(<DogDeleteModal dog={{id:"dog",name:"초코"}} onDeleted={onDeleted} onClose={onClose}/>);
it("loads authoritative preview, confirms and prevents double submit",async()=>{
 const done=vi.fn();let resolve!:(value:unknown)=>void;
 mocks.rpc.mockImplementation((name)=>name==="preview_dog_profile_removal"?Promise.resolve({data:base,error:null}):new Promise(r=>{resolve=r;}));
 open(done);expect(screen.queryByRole("button",{name:"완전 삭제"})).not.toBeInTheDocument();
 const button=await screen.findByRole("button",{name:"완전 삭제"});fireEvent.click(button);fireEvent.click(button);
 expect(mocks.rpc.mock.calls.filter(([name])=>name==="remove_dog_profile")).toHaveLength(1);
 const input=mocks.rpc.mock.calls[1][1];resolve({data:{dogId:"dog",mode:"hard_delete",requestId:input.p_request_id},error:null});
 await waitFor(()=>expect(done).toHaveBeenCalledWith("dog","hard_delete"));
});
it("cancel never calls a write command",async()=>{const close=vi.fn();open(vi.fn(),close);fireEvent.click(screen.getByRole("button",{name:"취소"}));expect(close).toHaveBeenCalled();expect(mocks.rpc.mock.calls.every(([name])=>name==="preview_dog_profile_removal")).toBe(true);});
it("shows referenced removal and warning separately from blockers",async()=>{
 mocks.rpc.mockResolvedValue({data:{...base,proposedMode:"profile_remove",warnings:["OUTSTANDING_SALES"],categories:[{category:"sales",userVisibleCount:1,records:[{dates:{saleDate:"2026-09-10"},classification:"WARN"}]}]},error:null});
 open();await screen.findByRole("button",{name:"반려견 프로필 삭제"});expect(screen.getByText(/미수금이 있습니다/)).toBeInTheDocument();expect(screen.getByText(/기존 기록은 유지/)).toBeInTheDocument();
});
it("fails closed for active or unresolved operations",async()=>{
 mocks.rpc.mockResolvedValue({data:{...base,activeBlockerCount:1,commandAvailable:false,proposedMode:null},error:null});open();await screen.findByText(/현재 진행 중이거나/);expect(screen.queryByRole("button",{name:"완전 삭제"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"반려견 프로필 삭제"})).not.toBeInTheDocument();
});
it("ignores a late preview for a previous dog and supports retry",async()=>{
 let first!:(x:unknown)=>void;mocks.rpc.mockImplementationOnce(()=>new Promise(r=>{first=r;}));
 const view=open();view.rerender(<DogDeleteModal dog={{id:"other",name:"다른 반려견"}} onDeleted={vi.fn()} onClose={vi.fn()}/>);
 await screen.findByRole("alert");first({data:base,error:null});expect(screen.queryByRole("button",{name:"완전 삭제"})).not.toBeInTheDocument();
 mocks.rpc.mockResolvedValue({data:{...base,dog:{recordDogId:"other"}},error:null});fireEvent.click(screen.getByRole("button",{name:"다시 확인"}));await screen.findByRole("button",{name:"완전 삭제"});
});
it("retries response loss using the same request ID and never auto switches mode",async()=>{
 let writes=0;mocks.rpc.mockImplementation(async(name,input)=>{
 if(name==="preview_dog_profile_removal")return {data:base,error:null};
 if(++writes===1)return {data:null,error:{message:"network"}};
 return {data:{dogId:"dog",mode:"hard_delete",requestId:input.p_request_id},error:null};});
 const done=vi.fn();open(done);fireEvent.click(await screen.findByRole("button",{name:"완전 삭제"}));await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"완전 삭제"}));await waitFor(()=>expect(done).toHaveBeenCalled());
 const calls=mocks.rpc.mock.calls.filter(([name])=>name==="remove_dog_profile");expect(calls[0][1]).toEqual(calls[1][1]);
});
it("invalidates a stale version until a fresh preview is confirmed",async()=>{
 let previews=0;mocks.rpc.mockImplementation(async(name)=>name==="preview_dog_profile_removal"?{data:{...base,version:++previews},error:null}:{data:null,error:{message:"STALE_VERSION"}});
 open();fireEvent.click(await screen.findByRole("button",{name:"완전 삭제"}));await screen.findByRole("alert");
 expect(screen.queryByRole("button",{name:"완전 삭제"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"다시 확인"}));await screen.findByRole("button",{name:"완전 삭제"});
 expect(previews).toBe(2);expect(mocks.rpc.mock.calls.filter(([name])=>name==="remove_dog_profile")).toHaveLength(1);
});
