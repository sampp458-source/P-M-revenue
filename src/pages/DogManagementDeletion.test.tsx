// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    id:"local-dog",name:"삭제검증견",customer_id:null,is_active:true,is_daycare_student:false,
    breed:null,sex:null,birth_date:null,weight:null,neutered:null,memo:null,customers:null,
  }]:[]})}),
  delete:()=>({eq:()=>({select:()=>({maybeSingle:async()=>{
    fixture.deletes++;
    if(fixture.referenced)return {data:null,error:{code:"23503"}};
    fixture.exists=false;return {data:{id:"local-dog"},error:null};
  }})})}),
})}}));
beforeEach(()=>{Object.assign(fixture,{role:"admin",active:true,exists:true,referenced:false,deletes:0});});
afterEach(cleanup);
const openPage=()=>render(<MemoryRouter><PetManagementPage/></MemoryRouter>);
async function openDelete(){
  const menus=await screen.findAllByRole("button",{name:"삭제검증견 관리 더보기"});
  fireEvent.click(menus[0]);fireEvent.click(screen.getByRole("menuitem",{name:"반려견 삭제"}));
}
it("removes the deleted dog from the actual management list and after remount",async()=>{
  const page=openPage();await openDelete();fireEvent.click(screen.getByRole("button",{name:"완전 삭제"}));
  await waitFor(()=>expect(screen.queryAllByRole("button",{name:"삭제검증견 관리 더보기"})).toHaveLength(0));
  expect(screen.getByText("반려견 정보를 완전히 삭제했습니다.")).toBeInTheDocument();
  page.unmount();openPage();await screen.findByText("등록된 반려견이 없습니다");expect(fixture.deletes).toBe(1);
});
it("keeps the management row after cancellation or a reference rejection",async()=>{
  openPage();await openDelete();fireEvent.click(screen.getByRole("button",{name:"취소"}));expect(fixture.deletes).toBe(0);
  fixture.referenced=true;await openDelete();fireEvent.click(screen.getByRole("button",{name:"완전 삭제"}));
  await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"취소"}));
  expect(screen.getAllByRole("button",{name:"삭제검증견 관리 더보기"}).length).toBeGreaterThan(0);expect(fixture.exists).toBe(true);
});
it.each([['staff',true],['admin',false]])("does not expose deletion to %s active=%s",async(role,active)=>{
  fixture.role=role as string;fixture.active=active as boolean;openPage();
  const menus=await screen.findAllByRole("button",{name:"삭제검증견 관리 더보기"});fireEvent.click(menus[0]);
  expect(screen.queryByRole("menuitem",{name:"반려견 삭제"})).not.toBeInTheDocument();expect(fixture.deletes).toBe(0);
});
