// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { RoomBoardDesktopGroup, RoomBoardMobileGroup, roomStageClass } from "./HotelRoomBoardPresentation";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LongStayMonthContractProjection,
} from "../platform/longStayHotelContract";

import { LongStayOperationsPanel } from "./LongStayOperationsPanel";

const repositoryMocks = vi.hoisted(() => ({
  completeLongStayAbsence: vi.fn(),
  completeLongStayCheckIn: vi.fn(),
  completeLongStayCheckOut: vi.fn(),
  confirmLongStayMonth: vi.fn(),
  createLongStayContract: vi.fn(),
  getCustomerLongStays: vi.fn(),
  getLongStayContract: vi.fn(),
  getLongStayHotelVersion: vi.fn(),
  getLongStayMonth: vi.fn(),
  getLongStayRoomAvailability: vi.fn(),
  reverseLongStayCompletion: vi.fn(),
  setLongStayPlannedCheckout: vi.fn(),
  startLongStayAbsence: vi.fn(),
}));

const hotelRepositoryMocks = vi.hoisted(() => ({
  fetchHotelOperationsSnapshot: vi.fn(),
}));

vi.mock("../platform/longStayHotelRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/longStayHotelRepository")>()),
  ...repositoryMocks,
}));

vi.mock("./hotelOperationsRepository", () => hotelRepositoryMocks);
vi.mock("./operationsScheduleRepository", () => ({
  seoulDateKey: () => "2026-09-15",
}));
vi.mock("./OperationsToday", () => ({
  hotelScheduleTypeForCalendar: () => ({ id: "hotel-schedule-type" }),
}));

const snapshot = {
  date: "2026-09-15",
  roomTypes: [
    {
      id: "standard",
      code: "STANDARD",
      name: "STANDARD",
      activeRooms: 5,
      reservedPeak: 0,
      checkedInNow: 0,
      allocatedNow: 0,
      reservedNow: 0,
      unassignedNow: 0,
      physicallyEmpty: 5,
    },
  ],
  rooms: [
    {
      id: "standard-1",
      roomTypeId: "standard",
      roomTypeCode: "STANDARD",
      roomTypeName: "STANDARD",
      name: "STANDARD 1",
      sortOrder: 1,
      isActive: true,
    },
  ],
  settings: {
    id: "hotel-settings",
    version: 1,
    defaultCheckInTime: "15:00:00",
    defaultCheckOutTime: "11:00:00",
    timezone: "Asia/Seoul",
  },
  stays: [],
  unassignedFuture: [],
};

const options = {
  calendars: [
    {
      id: "hotel-calendar",
      name: "Hotel Operations",
      scopeType: "business_unit",
      color: "#EA580C",
      sortOrder: 1,
      businessUnitCode: "hotel",
      businessUnitName: "호텔",
    },
  ],
  scheduleTypes: [],
  assignees: [{ id: "staff-1", name: "담당자" }],
  customers: [],
  dogs: [],
};

const projection = (
  overrides: Partial<LongStayMonthContractProjection> = {},
): LongStayMonthContractProjection => ({
  id: "contract-1",
  customerId: "customer-1",
  customerName: "보호자",
  dogId: "dog-1",
  dogName: "동동이",
  storedStatus: "pending",
  derivedStatus: "pending",
  startedOn: "2026-09-10",
  plannedCheckOutDate: null,
  checkedInAt: null,
  checkedOutAt: null,
  hotelStayId: null,
  version: 1,
  isOpenEnded: false,
  runtimeCapacityUntil: null,
  runtimeAllocationUntil: null,
  currentRoom: null,
  isAway: false,
  monthlyOccupancy: null,
  monthlyState: "unassigned",
  ...overrides,
});

const renderOperations = (
  contracts: LongStayMonthContractProjection[],
  operationRole: "owner" | "manager" | "staff" = "owner",
  readOnly = false,
) => {
  repositoryMocks.getLongStayMonth.mockResolvedValue({
    serviceMonth: "2026-09-01",
    contracts,
  });
  repositoryMocks.getLongStayRoomAvailability.mockResolvedValue({
    contractId: contracts[0]?.id ?? "contract-1",
    serviceMonth: "2026-09-01",
    availabilityFrom: "2026-09-10T06:00:00Z",
    isOpenEnded: true,
    rooms: snapshot.rooms.map((room) => ({
      roomId: room.id,
      roomName: room.name,
      roomTypeId: room.roomTypeId,
      roomTypeCode: room.roomTypeCode,
      roomTypeName: room.roomTypeName,
      assignable: true,
      nextConflictFrom: null,
      nextConflictUntil: null,
      conflictSource: null,
      conflictPhase: null,
      reason: "사용 가능",
    })),
  });

  return render(
    <LongStayOperationsPanel
      readOnly={readOnly}
      snapshot={snapshot as never}
      options={options as never}
      operationRole={operationRole}
      onHotelSnapshotRefresh={vi.fn().mockResolvedValue(undefined)}
    />,
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("Long Stay monthly timestamp date presentation", () => {
  it.each([
    ["previous UTC day", "2026-09-27T15:00:00+00:00", "2026. 09. 28.부터"],
    ["month boundary / Gamja August", "2026-07-31T15:00:00+00:00", "2026. 08. 01.부터"],
    ["year boundary", "2026-12-31T15:00:00+00:00", "2027. 01. 01.부터"],
    ["ordinary timestamp", "2026-09-28T05:30:00+00:00", "2026. 09. 28.부터"],
    ["before KST midnight", "2026-09-27T14:59:59+00:00", "2026. 09. 27.부터"],
    ["explicit KST offset", "2026-09-28T00:00:00+09:00", "2026. 09. 28.부터"],
  ])("renders %s as a Seoul date without shifting contract DATE fields", async (_, timestamp, label) => {
    const contract = projection({
      dogName: "용이", startedOn: "2026-09-28", plannedCheckOutDate: "2026-10-28",
      monthlyState: "active",
      monthlyOccupancy: {
        id: "month", status: "confirmed", roomTypeId: "standard", roomId: "standard-1",
        plannedOccupiedFrom: timestamp,
        plannedOccupiedUntilExclusive: "2026-10-01T00:00:00+09:00", billingSourceId: "month",
      },
    });
    const original = JSON.stringify(contract);
    renderOperations([contract]);
    expect(await screen.findByText(label)).not.toBeNull();
    expect(screen.getByText("2026. 09. 28.")).not.toBeNull();
    expect(screen.getByText("2026. 10. 28.")).not.toBeNull();
    expect(JSON.stringify(contract)).toBe(original);
    expect(repositoryMocks.confirmLongStayMonth).not.toHaveBeenCalled();
  });

  it("keeps Gamja September without a monthly occupancy unassigned", async () => {
    renderOperations([projection({dogName: "감자", startedOn: "2026-06-11"})]);
    expect(await screen.findByText("2026. 06. 11.")).not.toBeNull();
    expect(screen.getByText("미배정", {selector: "b"}).parentElement?.textContent).toBe("월 점유 미배정");
  });
});

describe("Long Stay room identity UX", () => {
  const active = () => projection({dogName: "감자", storedStatus: "active", derivedStatus: "active",
    hotelStayId: "stay-1", checkedInAt: "2026-09-10T06:00:00Z", isOpenEnded: true,
    currentRoom: {id: "standard-1", name: "STANDARD 1", roomTypeId: "standard"}});
  const setDate = () => { vi.useFakeTimers({toFake: ["Date"]}); vi.setSystemTime(new Date("2026-09-28T12:00:00+09:00")); };
  it("exposes monthly confirmation despite an occupied current room and explains live allocation effects", async () => {
    setDate(); renderOperations([active()]);
    fireEvent.click(await screen.findByRole("button", {name: "월 객실 배정·확정"}));
    expect(screen.getByText(/다른 호실을 선택하면 현재 예약의 배정도 변경/)).not.toBeNull();
    await waitFor(() => expect(repositoryMocks.getLongStayRoomAvailability).toHaveBeenCalledWith(expect.objectContaining({physicalStartDate:null})));
    expect(repositoryMocks.confirmLongStayMonth).not.toHaveBeenCalled();
  });
  it("hides confirmation for Yong-like confirmed month, retaining checkout", async () => {
    setDate(); renderOperations([projection({...active(), dogName:"용이", monthlyState:"active", monthlyOccupancy:{id:"month",status:"confirmed",roomTypeId:"standard",roomId:"standard-1",plannedOccupiedFrom:"2026-09-27T15:00:00Z",plannedOccupiedUntilExclusive:"2026-09-30T15:00:00Z",billingSourceId:"month"}})]);
    expect(await screen.findByRole("button",{name:"실제 퇴실"})).not.toBeNull();
    expect(screen.queryByRole("button",{name:"월 객실 배정·확정"})).toBeNull();
    expect(screen.queryByRole("button",{name:"객실 배정"})).toBeNull();
  });
  it("preserves first assignment action when no runtime/room exists", async () => {
    setDate();renderOperations([projection()]);
    fireEvent.click(await screen.findByRole("button",{name:"객실 배정"}));
    expect(screen.getByLabelText("객실 사용 시작 날짜")).not.toBeNull();
  });
  it("keeps actual checkout enabled and confined to existing command", async () => {
    setDate();renderOperations([active()]);
    const b=await screen.findByRole("button",{name:"실제 퇴실"});expect(b.matches(":disabled")).toBe(false);
    expect(b.closest(".hotel-long-stay-panel")).not.toBeNull();
    expect(repositoryMocks.completeLongStayCheckOut).not.toHaveBeenCalled();
  });
  it("preserves disabled fieldset guard without removing the readable label", async () => {
    setDate();renderOperations([active()],"staff",true);
    const b=await screen.findByRole("button",{name:"실제 퇴실"});expect(b.matches(":disabled")).toBe(true);
    fireEvent.click(b);expect(repositoryMocks.completeLongStayCheckOut).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("room type style boundary", () => {
  it("uses the same canonical room type attribute on desktop and mobile trays", () => {
    const v=render(<><RoomBoardDesktopGroup type="DELUXE" summary="3 사용">객실</RoomBoardDesktopGroup><RoomBoardMobileGroup type="STANDARD" summary="2 사용" expanded onToggle={()=>{}}>객실</RoomBoardMobileGroup></>);
    expect(v.container.querySelectorAll('[data-room-group="DELUXE"]')).toHaveLength(1);
    expect(v.container.querySelectorAll('[data-room-group="STANDARD"]')).toHaveLength(1);
    expect(roomStageClass("in_house")).toContain("bg-emerald-50/65");
    expect(roomStageClass("check_in")).toContain("bg-blue-50/65");
    expect(roomStageClass("check_out")).toContain("bg-orange-50/65");
  });
  it("limits identity colors to trays/summary and destructive styles to Long Stay", () => {
    const css=readFileSync('src/pages/hotel-long-stay-room-type.css','utf8');
    expect(css).not.toMatch(/data-room-phase|hotel-room-cell|pm-d-room-object|:root/);
    const clean=css.replace(/\/\*[\s\S]*?\*\//g,'').replace(/@(?:layer|media)[^{}]+\{/g,'');
    for (const [,selector] of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const part of selector.trim().split(/,\s*\n/)) expect(part.trim()).toMatch(/^\.pm-design-d\.pm-d-page\.pm-hotel-v2/);
    }
    expect(css).toContain('background: var(--pm-d-semantic-coral-soft) !important');
    expect(css).toContain('.hotel-long-stay-panel .pm-v1-button-danger:disabled');
    expect(css).toContain('outline: var(--pm-d-focus-ring) !important');
  });
});


describe("Long Stay mobile menu clipping boundary", () => {
  it("opens only the mobile Long Stay overflow menu above its trigger without changing panel or action styles", () => {
    const css = readFileSync('src/pages/hotel-long-stay-room-type.css', 'utf8');
    expect(css).toMatch(/@media \(max-width: 639px\)\s*\{\s*\.pm-design-d\.pm-d-page\.pm-hotel-v2 \.hotel-long-stay-panel \[data-testid="responsive-action-group"\] > details > div\s*\{\s*top: auto !important;\s*bottom: calc\(100% \+ 0.5rem\);\s*\}/);
    expect(css).not.toMatch(/overflow:|position:\s*(fixed|absolute)|z-index:|pointer-events:/);
    expect(css).toContain('margin-left: auto !important');
  });
});
