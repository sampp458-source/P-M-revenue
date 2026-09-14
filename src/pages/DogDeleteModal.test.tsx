// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DogDeleteModal } from "./DogDeleteModal";
import { deleteDog } from "./dogDeletionRepository";
const db = vi.hoisted(() => ({ result: vi.fn(), from: vi.fn(), remove: vi.fn(), eq: vi.fn(), select: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from: db.from } }));
function setup() {
  db.from.mockReturnValue({ delete: db.remove }); db.remove.mockReturnValue({ eq: db.eq });
  db.eq.mockReturnValue({ select: db.select }); db.select.mockReturnValue({ maybeSingle: db.result });
  const onDeleted=vi.fn(), onClose=vi.fn();
  render(<DogDeleteModal dog={{ id:"test-dog",name:"테스트 반려견" }} onDeleted={onDeleted} onClose={onClose}/>);
  return {onDeleted,onClose};
}
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("names the dog and cancel does not send a mutation",()=>{
  const {onClose}=setup(); expect(screen.getByText("테스트 반려견")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"취소"})); expect(onClose).toHaveBeenCalledOnce(); expect(db.from).not.toHaveBeenCalled();
});
it("locks repeated confirmation and reports deletion only after success",async()=>{
  let resolve!:(value:unknown)=>void; db.result.mockReturnValue(new Promise(r=>{resolve=r;}));
  const {onDeleted}=setup();const button=screen.getByRole("button",{name:"완전 삭제"});
  act(()=>{fireEvent.click(button);fireEvent.click(button);fireEvent.doubleClick(button);});
  expect(db.remove).toHaveBeenCalledOnce();expect(onDeleted).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"처리 중..."})).toBeDisabled();
  await act(async()=>resolve({data:{id:"test-dog"},error:null}));
  expect(onDeleted).toHaveBeenCalledWith("test-dog"); expect(db.eq).toHaveBeenCalledWith("id","test-dog");
});
it.each(["23503","42501","XX000"])("keeps the dog on %s and hides raw DB errors",async code=>{
  db.result.mockResolvedValue({data:null,error:{code,message:"private database detail"}});
  const {onDeleted}=setup();fireEvent.click(screen.getByRole("button",{name:"완전 삭제"}));
  await screen.findByRole("alert");expect(onDeleted).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).not.toHaveTextContent("private database detail");
  if(code==="23503")expect(screen.getByRole("alert")).toHaveTextContent("연결된 이용 기록");
  await waitFor(()=>expect(screen.getByRole("button",{name:"완전 삭제"})).toBeEnabled());
});
it("does not claim success when RLS filters the row or a repeated delete finds nothing",async()=>{
  setup();db.result.mockResolvedValue({data:null,error:null});
  await expect(deleteDog("test-dog")).rejects.toThrow("삭제 권한이 없거나 이미 삭제된");
});
