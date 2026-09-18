// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DogProfileModal } from "./DogProfileModal";
vi.mock("./LongStayProfileSection",()=>({LongStayProfileSection:()=> <button>새 장기 투숙</button>}));
vi.mock("./DaycareReservationModal",()=>({DaycareReservationModal:()=>null}));
afterEach(cleanup);
it("keeps removed identity readable while hiding edit and new operation actions",()=>{
 render(<DogProfileModal dog={{id:"synthetic",customerId:"owner",name:"기록견",breed:null,sex:null,birthDate:null,weight:null,neutered:null,memo:null,active:false,profileStatus:"removed",isDaycareStudent:true}}
 owner={{id:"owner",name:"보호자",phone:null,address:null,memo:null,is_active:true}} activities={[]} loading={false} error="" canEditDog siblingDogCount={0}
 onClose={vi.fn()} onOpenCustomer={vi.fn()} onEditDog={vi.fn()} onEditOwner={vi.fn()} onRetry={vi.fn()}/>);
 expect(screen.getByText("프로필 삭제됨")).toBeInTheDocument();expect(screen.getByText("기록견")).toBeInTheDocument();
 expect(screen.queryByRole("button",{name:/반려견 수정|보호자 수정|예약|새 장기 투숙/})).not.toBeInTheDocument();
});
