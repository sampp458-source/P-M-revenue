// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PetManagementPage } from "./DogManagement";

const fixture = vi.hoisted(() => ({
  role: "admin", active: true, exists: true, referenced: false, deletes: 0,
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({profile: {id:"local-admin",role:fixture.role,isActive:fixture.active}}) }));
vi.mock("./customerDogDirectory", () => ({loadCurrentCustomerDogServices: async () => ({services:[],available:true})}));
vi.mock("./DogProfileModal", () => ({ DogProfileModal: () => null }));
vi.mock("./CustomerProfileModal", () => ({ CustomerProfileModal: () => null }));
vi.mock("../lib/supabase", () => ({supabase:{from:(table:string)=>({
  select:()=>({order:async()=>({error:null,data:table==="dogs"&&fixture.exists?[{
    id:"local-dog",name:"삭제검증견",customer_id:"local-owner",is_active:true,is_daycare_student:false,
    breed:null,sex:null,birth_date:null,weight:null,neutered:null,memo:null,customers:{name:"테스트 보호자",phone:""},
  }]:table==="customers"?[{id:"local-owner",name:"테스트 보호자",phone:"",is_active:true}]:[]})}),
}), rpc: async (name:string, input:Record<string,unknown>) => {
  if (name === "preview_dog_profile_removal") return {data:{dog:{recordDogId:"local-dog"},version:1,commandAvailable:true,contractVersion:"dog-profile-preview-v2b-1",categories:[],warnings:[],activeBlockerCount:0,proposedMode:"hard_delete",graphFingerprint:"graph"},error:null};
  fixture.deletes++;
  if (fixture.referenced) return {data:null,error:{message:"STALE_PREVIEW"}};
  fixture.exists=false;return {data:{dogId:"local-dog",mode:"hard_delete",requestId:input.p_request_id},error:null};
}}}));
beforeEach(()=>{Object.assign(fixture,{role:"admin",active:true,exists:true,referenced:false,deletes:0});});
afterEach(cleanup);
const openPage=()=>render(<MemoryRouter><PetManagementPage/></MemoryRouter>);
async function openDelete(){
  const buttons=await screen.findAllByRole("button",{name:"반려견 정보 삭제"});
  fireEvent.click(buttons[0]);
}
it("removes the deleted dog from the actual management list and after remount",async()=>{
  const page=openPage();await openDelete();fireEvent.click(await screen.findByRole("button",{name:"완전 삭제"}));
  await waitFor(()=>expect(screen.queryAllByRole("group",{name:"삭제검증견 관리"})).toHaveLength(0));
  expect(screen.getByText("반려견 정보를 완전히 삭제했습니다.")).toBeInTheDocument();
  page.unmount();openPage();await screen.findByText("등록된 반려견이 없습니다");expect(fixture.deletes).toBe(1);
});
it("keeps the management row after cancellation or a reference rejection",async()=>{
  openPage();await openDelete();fireEvent.click(screen.getByRole("button",{name:"취소"}));expect(fixture.deletes).toBe(0);
  fixture.referenced=true;await openDelete();fireEvent.click(await screen.findByRole("button",{name:"완전 삭제"}));
  await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"취소"}));
  expect(screen.getAllByRole("group",{name:"삭제검증견 관리"}).length).toBeGreaterThan(0);expect(fixture.exists).toBe(true);
});
it.each([['staff',false],['admin',false]])("does not expose deletion to %s active=%s",async(role,active)=>{
  fixture.role=role as string;fixture.active=active as boolean;openPage();
  await screen.findAllByRole("group",{name:"삭제검증견 관리"});
  expect(screen.queryByRole("button",{name:"반려견 정보 삭제"})).not.toBeInTheDocument();expect(fixture.deletes).toBe(0);
});

it("preserves direct wider-screen edit actions and opens the existing forms",async()=>{
  openPage();
  const ownerButtons=await screen.findAllByRole("button",{name:"보호자 수정"});
  expect(document.querySelector(".directory-wide-actions summary")).toBeNull();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  fireEvent.click(ownerButtons[0]);
  expect(screen.getByRole("dialog")).toHaveTextContent("보호자 정보 수정");
  expect(fixture.deletes).toBe(0);
});
it("opens the unchanged dog edit form from the visible action",async()=>{
  openPage();fireEvent.click((await screen.findAllByRole("button",{name:"반려견 수정"}))[0]);
  expect(screen.getByRole("dialog")).toHaveTextContent("반려견 수정");
  expect(screen.getByDisplayValue("삭제검증견")).toBeInTheDocument();
  expect(fixture.deletes).toBe(0);
});

it("exposes removal to active staff", async()=>{fixture.role="staff";openPage();await openDelete();expect(await screen.findByRole("button",{name:"완전 삭제"})).toBeEnabled();});

it("opens the existing delete confirmation through mobile management and closes the disclosure",async()=>{
  openPage();await screen.findAllByRole("group",{name:"삭제검증견 관리"});
  const disclosure=document.querySelector("details.directory-action-disclosure") as HTMLDetailsElement;
  fireEvent.click(disclosure.querySelector("summary")!);
  expect(disclosure.open).toBe(true);
  fireEvent.click(within(disclosure).getByRole("button",{name:"반려견 정보 삭제"}));
  expect(disclosure.open).toBe(false);
  expect(await screen.findByRole("dialog")).toHaveTextContent("삭제검증견");
  fireEvent.click(screen.getByRole("button",{name:"취소"}));
  expect(fixture.deletes).toBe(0);
});
it("closes the mobile management disclosure with Escape and restores focus",async()=>{
  openPage();await screen.findAllByRole("group",{name:"삭제검증견 관리"});
  const disclosure=document.querySelector("details.directory-action-disclosure") as HTMLDetailsElement;
  const summary=disclosure.querySelector("summary")!;
  fireEvent.click(summary);fireEvent.keyDown(disclosure,{key:"Escape"});
  expect(disclosure.open).toBe(false);expect(summary).toHaveFocus();expect(fixture.deletes).toBe(0);
});
