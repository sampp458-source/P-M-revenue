// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import App from "../App";
import { markModuleGateComplete } from "../app/moduleState";
import { ModuleProvider } from "../app/ModuleContext";
import { NotificationProvider } from "./NotificationProvider";
import { notificationRepository, emptyInbox, type Notice } from "./notificationRepository";
const auth = vi.hoisted(() => ({ user: { id: "self", email: "test@example.test" }, profile: { id: "self", name: "테스트", role: "admin", isActive: true, accountStatus: "active" }, loading: false, businessUnits: [], signOut: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("./webPushClient", () => ({ webPushEnabled: false }));
vi.mock("../pages/operationsScheduleRepository", async importOriginal => ({
  ...await importOriginal<object>(),
  fetchOperationScheduleOptions: vi.fn(async () => ({ calendars: [], scheduleTypes: [], assignees: [], dogs: [], customers: [] })),
  fetchOperationSchedulesForRange: vi.fn(async () => []),
  fetchCurrentOperationRole: vi.fn(async () => "owner"),
}));
let item: Notice;
let routes: string[];
function Observer() {
  const location = useLocation(); const navigate = useNavigate();
  useEffect(() => { routes.push(location.pathname + location.search); }, [location]);
  return <><output data-testid="route">{location.pathname + location.search}</output><button onClick={() => navigate(-1)}>history back</button></>;
}
function Root({ path = "/select-module" }: { path?: string }) {
  return <StrictMode><MemoryRouter initialEntries={[path]}><ModuleProvider><NotificationProvider enabled><Observer /><App /></NotificationProvider></ModuleProvider></MemoryRouter></StrictMode>;
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); routes=[]; auth.loading=false;
  item={id:"notice",announcement_id:null,category:"SCHEDULE",deep_link_type:"SCHEDULE_DAY",deep_link_id:"00000000-0000-4000-8000-000000000001",schedule_local_date:"2026-10-04",title:"오늘 일정 1건이 있습니다.",message:"2026. 10. 04. · 나의 예정 일정",priority:"NORMAL",ack_required:false,created_at:"2026-10-04T12:00:00Z",read_at:null,acknowledged_at:null,popup_presented_at:null,revoked_at:null,expires_at:null};
  vi.spyOn(notificationRepository,"inbox").mockImplementation(async () => ({...emptyInbox,items:[item],unread_count:item.read_at?0:1}));
  vi.spyOn(notificationRepository,"subscribe").mockReturnValue(() => {});
  vi.spyOn(notificationRepository,"read").mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function tap() {
  fireEvent.click(await screen.findByRole("button",{name:/알림센터, 읽지 않은/}));
  fireEvent.click(await screen.findByRole("button",{name:/오늘 일정 1건/}));
}
async function destination(date="2026-10-04") {
  await waitFor(() => expect(screen.getByTestId("route").textContent).toBe(`/operations/calendar?notification_date=${date}`));
  await screen.findByRole("dialog", {name: /일정$/});
  expect(routes.filter(x=>x.startsWith('/operations/calendar'))).toHaveLength(1);
  expect(routes.slice(1).some(x=>['/','/home','/select-module'].includes(x))).toBe(false);
}
it.each([null,"2026-10-04T12:00:00Z"])("Module Gate unread/read (%s) selects Calendar without document reload or bounce",async read => {
  item.read_at=read;render(<Root/>);await tap();await destination();expect(notificationRepository.read).toHaveBeenCalledTimes(1);
});
it.each(["SCHEDULE_ASSIGNED","SCHEDULE_UPDATED","SCHEDULE_COMPLETED","SCHEDULE_CANCELLED"])("%s retains the same date route",async()=>{
  item.deep_link_type="SCHEDULE";render(<Root/>);await tap();await destination();
});
it("slow read and double tap do not delay or duplicate navigation",async()=>{
  let resolve!:()=>void;vi.mocked(notificationRepository.read).mockReturnValue(new Promise<void>(r=>{resolve=r;}));
  render(<Root/>);fireEvent.click(await screen.findByRole('button',{name:/알림센터, 읽지 않은/}));const row=await screen.findByRole('button',{name:/오늘 일정 1건/});
  act(()=>{row.click();row.click();});await destination();expect(notificationRepository.read).toHaveBeenCalledTimes(1);await act(async()=>resolve());
});
it("read failure preserves Calendar navigation and reports independently",async()=>{
  vi.mocked(notificationRepository.read).mockRejectedValue(Error('read failed'));render(<Root/>);await tap();await destination();expect(await screen.findByText(/읽음 상태를 저장하지 못했습니다/)).toBeTruthy();
});
it("session restoration then warm foreground keeps Calendar intent",async()=>{
  auth.loading=true;const root=render(<Root/>);expect(screen.queryByRole('button',{name:/알림센터/})).toBeNull();auth.loading=false;root.rerender(<Root/>);await screen.findByRole('button',{name:/알림센터, 읽지 않은/});routes=['/select-module'];await tap();await destination();fireEvent.focus(window);fireEvent(document,new Event('visibilitychange'));expect(screen.getByTestId('route').textContent).toContain('notification_date=2026-10-04');
});
it("already mounted Calendar reacts to another date and same-date reopen",async()=>{
  render(<Root/>);await tap();await destination();fireEvent.click(screen.getByRole('button',{name:'닫기'}));
  item={...item,schedule_local_date:'2026-10-05'};await tap();await screen.findByText('10월 5일 (월)');expect(screen.getByTestId('route').textContent).toContain('2026-10-05');
  fireEvent.click(screen.getByRole('button',{name:'닫기'}));await tap();expect(await screen.findByRole('dialog',{name:'10월 5일 (월) 일정'})).toBeTruthy();
});
it.each(['2026-02-30','2026-1-01','bad'])("invalid direct date %s stays Calendar without an invalid drawer",async date=>{
  markModuleGateComplete('self');render(<Root path={`/operations/calendar?notification_date=${date}`}/>);
  await waitFor(()=>expect(screen.getByTestId('route').textContent).toContain('/operations/calendar'));
  expect(screen.queryByRole('dialog',{name:/일정$/})).toBeNull();expect(routes.every(x=>x.startsWith('/operations/calendar'))).toBe(true);
});
it("normal Calendar entry has no notification drawer",()=>{
  markModuleGateComplete('self');render(<Root path="/operations/calendar"/>);expect(screen.queryByRole('dialog',{name:/일정$/})).toBeNull();
});

it("notification navigation replaces history instead of adding a return-to-gate entry",async()=>{
  render(<Root/>);await tap();await destination();fireEvent.click(screen.getByRole('button',{name:'history back'}));expect(screen.getByTestId('route').textContent).toBe('/operations/calendar?notification_date=2026-10-04');
});
