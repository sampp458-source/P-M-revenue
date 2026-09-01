import { ChevronDown, Clock3, GripVertical, Sparkles } from "lucide-react";
import {
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge, Card, cn } from "../components/ui";
import type {
  HotelOperationsSnapshot,
  HotelRoomSnapshot,
  HotelStay,
} from "./hotelOperationsRepository";
import type {
  SharedHotelOccupancy,
  UnassignedSharedRoomGroup,
} from "../platform/multiDogSharedRoomContract";
import type { DaycareReservation } from "./daycareOperationsRepository";
import {
  activeHotelAllocation,
  formatHotelScheduleTime,
  hotelStayDayPhase,
  hotelStayScheduleDate,
  hotelStayScheduleEvent,
  hotelStayUnspecifiedState,
  seoulInputParts,
} from "./hotelOperationsUi";

type RoomBoardStage = "check_in" | "in_house" | "check_out";
type MobileRoomFilter = "all" | RoomBoardStage | "empty";

export type HotelRoomBoardDropAction = "assign" | "reassign" | "move";
export type HotelRoomBoardRoomTarget =
  | "same_type"
  | "change_type"
  | "blocked";

export type HotelRoomBoardDragPayload =
  | { kind: "stay"; stayId: string }
  | { kind: "shared_group"; sharedRoomGroupId: string };

export function serializeHotelRoomBoardDragPayload(payload: HotelRoomBoardDragPayload) {
  return JSON.stringify(payload);
}

export function parseHotelRoomBoardDragPayload(value: string): HotelRoomBoardDragPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<HotelRoomBoardDragPayload>;
    if (parsed.kind === "stay" && typeof parsed.stayId === "string") {
      return { kind: "stay", stayId: parsed.stayId };
    }
    if (parsed.kind === "shared_group" && typeof parsed.sharedRoomGroupId === "string") {
      return { kind: "shared_group", sharedRoomGroupId: parsed.sharedRoomGroupId };
    }
  } catch {
    return null;
  }
  return null;
}

export function hotelRoomBoardSharedGroupCanDrop(
  group: UnassignedSharedRoomGroup,
  room: HotelRoomSnapshot,
  occupied: boolean,
) {
  return !occupied &&
    room.isActive &&
    room.roomTypeCode.trim().toUpperCase() === "DELUXE" &&
    room.roomTypeId === group.roomTypeId;
}

const ROOM_BOARD_DRAG_THRESHOLD = 7;
const MOBILE_ROOM_BOARD_QUERY = "(max-width: 767px)";

function useMobileRoomBoardProjection() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(MOBILE_ROOM_BOARD_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MOBILE_ROOM_BOARD_QUERY);
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return mobile;
}

export function isHotelRoomBoardDragGesture(
  deltaX: number,
  deltaY: number,
  threshold = ROOM_BOARD_DRAG_THRESHOLD,
) {
  return Math.hypot(deltaX, deltaY) >= threshold;
}

export function hotelRoomBoardDropAction(
  stay: HotelStay,
): HotelRoomBoardDropAction | null {
  if (stay.checkedOutAt) return null;
  const allocation = activeHotelAllocation(stay);
  if (!allocation) return "assign";
  return stay.checkedInAt ? "move" : "reassign";
}

export function hotelRoomBoardStage(
  stay: HotelStay,
  selectedDate: string,
): RoomBoardStage {
  const phase = hotelStayDayPhase(stay, selectedDate);
  if (phase === "퇴실") return "check_out";
  if (phase === "이용중") return "in_house";
  return "check_in";
}

export function hotelRoomBoardUnassigned(stays: HotelStay[], selectedInstant?: string) {
  return stays.filter(
    (stay) =>
      !stay.archivedAt &&
      !stay.checkedOutAt &&
      !activeHotelAllocation(stay, selectedInstant),
  );
}

export function hotelRoomBoardRoomTarget(
  stay: HotelStay,
  room: HotelRoomSnapshot,
  occupied: boolean,
): HotelRoomBoardRoomTarget {
  const allocation = activeHotelAllocation(stay);
  if (
    occupied ||
    stay.checkedOutAt ||
    (!allocation && !stay.capacityReservation?.roomTypeId) ||
    allocation?.roomId === room.id
  ) {
    return "blocked";
  }
  return stay.capacityReservation?.roomTypeId === room.roomTypeId
    ? "same_type"
    : allocation
      ? "change_type"
      : "blocked";
}

export function canDropHotelStayToUnassigned(stay: HotelStay) {
  return Boolean(
    !stay.checkedInAt && !stay.checkedOutAt && activeHotelAllocation(stay),
  );
}

export function hotelRoomBoardOccupiesRoom(stay: HotelStay, selectedInstant?: string) {
  return !stay.checkedOutAt && activeHotelAllocation(stay, selectedInstant) !== null;
}

export function hotelRoomBoardRecommendedRoom(
  stay: HotelStay,
  rooms: HotelRoomSnapshot[],
  occupiedRoomIds: Set<string>,
) {
  const roomTypeId = stay.capacityReservation?.roomTypeId;
  if (!roomTypeId) return null;
  const allocation = activeHotelAllocation(stay);
  const currentRoom = rooms.find((room) => room.id === allocation?.roomId);
  return (
    rooms
      .filter(
        (room) =>
          room.isActive &&
          room.roomTypeId === roomTypeId &&
          room.id !== allocation?.roomId &&
          !occupiedRoomIds.has(room.id),
      )
      .sort((left, right) => {
        if (currentRoom) {
          const distance =
            Math.abs(left.sortOrder - currentRoom.sortOrder) -
            Math.abs(right.sortOrder - currentRoom.sortOrder);
          if (distance !== 0) return distance;
        }
        return (
          left.sortOrder - right.sortOrder ||
          left.name.localeCompare(right.name)
        );
      })[0] ?? null
  );
}

export function hotelRoomBoardCheckInTime(stay: HotelStay) {
  const schedule = hotelStayScheduleEvent(stay, "check_in");
  if (!schedule) return "입실 시간 없음";
  if (schedule.timeUnspecified) return "시간 미정";
  return seoulInputParts(schedule.startsAt).time;
}

function roomBoardScheduleTime(
  stay: HotelStay,
  eventKind: "check_in" | "check_out",
) {
  const schedule = hotelStayScheduleEvent(stay, eventKind);
  if (!schedule) return null;
  if (schedule.timeUnspecified) return "시간 미정";
  return seoulInputParts(schedule.startsAt).time;
}

function roomBoardCompactDate(date: string, selectedDate: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (date.slice(0, 4) === selectedDate.slice(0, 4)) {
    return `${month}/${day}`;
  }
  return `${year}. ${month}. ${day}.`;
}

export function hotelRoomBoardPhaseTime(
  stay: HotelStay,
  selectedDate: string,
) {
  const checkInDate = hotelStayScheduleDate(stay, "check_in");
  const checkOutDate = hotelStayScheduleDate(stay, "check_out");
  const checkInTime = roomBoardScheduleTime(stay, "check_in");
  const checkOutTime = roomBoardScheduleTime(stay, "check_out");

  if (checkInDate === selectedDate && checkOutDate === selectedDate) {
    if (!checkInTime || !checkOutTime) return null;
    return `${checkInTime === "시간 미정" ? "입실 시간 미정" : checkInTime} → ${
      checkOutTime === "시간 미정" ? "퇴실 시간 미정" : checkOutTime
    }`;
  }
  if (checkInDate === selectedDate) {
    return checkInTime
      ? `입실 ${checkInTime}`
      : null;
  }
  if (checkOutDate === selectedDate) {
    return checkOutTime
      ? `퇴실 ${checkOutTime}`
      : null;
  }
  if (checkInDate && checkInDate < selectedDate) {
    if (!checkOutDate || !checkOutTime) return null;
    const checkoutDate = roomBoardCompactDate(checkOutDate, selectedDate);
    return checkOutTime === "시간 미정"
      ? `퇴실 ${checkoutDate} · 시간 미정`
      : `퇴실 ${checkoutDate} ${checkOutTime}`;
  }
  return checkInTime
    ? `입실 ${checkInTime}`
    : null;
}

export type HotelRoomBoardUnassignedGroup =
  | "overdue"
  | "today"
  | "future";

function compareUnassignedStay(left: HotelStay, right: HotelStay) {
  const leftSchedule = hotelStayScheduleEvent(left, "check_in");
  const rightSchedule = hotelStayScheduleEvent(right, "check_in");
  const dateOrder = (leftSchedule
    ? seoulInputParts(leftSchedule.startsAt).date
    : "").localeCompare(
    rightSchedule ? seoulInputParts(rightSchedule.startsAt).date : "",
  );
  if (dateOrder !== 0) return dateOrder;
  const unknownOrder = Number(Boolean(leftSchedule?.timeUnspecified)) -
    Number(Boolean(rightSchedule?.timeUnspecified));
  if (unknownOrder !== 0) return unknownOrder;
  const timeOrder = (leftSchedule?.startsAt ?? "").localeCompare(
    rightSchedule?.startsAt ?? "",
  );
  return timeOrder || left.dogName.localeCompare(right.dogName);
}

export function hotelRoomBoardUnassignedGroups(
  stays: HotelStay[],
  selectedDate: string,
) {
  const groups: Record<HotelRoomBoardUnassignedGroup, HotelStay[]> = {
    overdue: [],
    today: [],
    future: [],
  };
  hotelRoomBoardUnassigned(stays).forEach((stay) => {
    const checkInDate = hotelStayScheduleDate(stay, "check_in");
    const group = !checkInDate || checkInDate < selectedDate
      ? "overdue"
      : checkInDate === selectedDate
        ? "today"
        : "future";
    groups[group].push(stay);
  });
  groups.overdue.sort(compareUnassignedStay);
  groups.today.sort(compareUnassignedStay);
  groups.future.sort(compareUnassignedStay);
  return groups;
}

export function hotelRoomBoardCompletedCheckouts(
  stays: HotelStay[],
  selectedDate: string,
) {
  return stays
    .filter(
      (stay) =>
        stay.checkedOutAt &&
        seoulInputParts(stay.checkedOutAt).date === selectedDate,
    )
    .sort((left, right) =>
      (left.checkedOutAt ?? "").localeCompare(right.checkedOutAt ?? ""),
    );
}

function stageClass(stage: RoomBoardStage) {
  if (stage === "in_house") {
    return "border-emerald-300 bg-emerald-50 text-emerald-950";
  }
  if (stage === "check_out") {
    return "border-orange-300 bg-orange-50 text-orange-950";
  }
  return "border-blue-300 bg-blue-50 text-blue-950";
}

function stageBadgeClass(stage: RoomBoardStage, waiting: boolean) {
  if (waiting) return "bg-amber-100 text-amber-800 ring-amber-300/70";
  if (stage === "in_house") {
    return "bg-emerald-100 text-emerald-800 ring-emerald-300/70";
  }
  if (stage === "check_out") {
    return "bg-orange-100 text-orange-900 ring-orange-300/70";
  }
  return "bg-blue-100 text-blue-800 ring-blue-300/70";
}

export function hotelRoomBoardDogStatus(stay: HotelStay, selectedDate: string) {
  const checkInDate = hotelStayScheduleDate(stay, "check_in");
  const checkOutDate = hotelStayScheduleDate(stay, "check_out");
  if (checkInDate === selectedDate && checkOutDate === selectedDate) {
    return { label: "입실·퇴실", stage: "check_out" as const };
  }
  if (checkInDate === selectedDate) return { label: "입실", stage: "check_in" as const };
  if (checkOutDate === selectedDate) return { label: "퇴실", stage: "check_out" as const };

  const phase = hotelStayDayPhase(stay, selectedDate) as string | null;
  if (stay.checkedOutAt || phase === "완료") return { label: "완료", stage: "check_out" as const };
  if (phase === "이용중" || stay.checkedInAt) return { label: "이용중", stage: "in_house" as const };
  return { label: "입실", stage: "check_in" as const };
}

export function sharedRoomCardStage(
  occupancy: SharedHotelOccupancy,
  staysById: ReadonlyMap<string, HotelStay>,
  selectedDate: string,
): RoomBoardStage | null {
  const stages = occupancy.members
    .filter((member) => member.status === "active")
    .map((member) => staysById.get(member.hotelStayId))
    .filter((stay): stay is HotelStay => Boolean(stay))
    .map((stay) => hotelRoomBoardDogStatus(stay, selectedDate).stage);
  if (!stages.length) return null;
  if (stages.includes("in_house")) return "in_house";
  if (stages.every((stage) => stage === "check_out")) return "check_out";
  return "check_in";
}

function roomStageClass(stage: RoomBoardStage | null) {
  if (stage === "in_house") {
    return "border-emerald-300 bg-emerald-50/65 shadow-[inset_0_3px_0_0_rgb(16_185_129_/_0.75)]";
  }
  if (stage === "check_out") {
    return "border-orange-300 bg-orange-50/65 shadow-[inset_0_3px_0_0_rgb(249_115_22_/_0.75)]";
  }
  if (stage === "check_in") {
    return "border-blue-300 bg-blue-50/65 shadow-[inset_0_3px_0_0_rgb(37_99_235_/_0.75)]";
  }
  return "border-slate-200/60 bg-transparent";
}

function daycareRoomStage(reservation: DaycareReservation): RoomBoardStage {
  return reservation.lifecycleStatus === "checked_in" ? "in_house" : "check_in";
}

function roomBoardRoomStage(
  stays: readonly HotelStay[],
  sharedOccupancy: SharedHotelOccupancy | null,
  daycareReservation: DaycareReservation | null,
  staysById: ReadonlyMap<string, HotelStay>,
  selectedDate: string,
) {
  if (daycareReservation) return daycareRoomStage(daycareReservation);
  if (sharedOccupancy) {
    return sharedRoomCardStage(sharedOccupancy, staysById, selectedDate);
  }
  return stays[0]
    ? hotelRoomBoardDogStatus(stays[0], selectedDate).stage
    : null;
}

function stayRoomId(stay: HotelStay, selectedInstant?: string) {
  return activeHotelAllocation(stay, selectedInstant)?.roomId ?? null;
}

function DraggableStayCard({
  stay,
  selectedDate,
  disabled,
  dragging,
  returning,
  settling,
  variant,
  mobile = false,
  onOpen,
  onSelectForDrop,
  onDragStart,
  onPointerStart,
}: {
  stay: HotelStay;
  selectedDate: string;
  disabled: boolean;
  dragging: boolean;
  returning: boolean;
  settling: boolean;
  variant: "waiting" | "room";
  mobile?: boolean;
  onOpen: () => void;
  onSelectForDrop: (stayId: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, stayId: string) => void;
  onPointerStart: (stayId: string) => void;
}) {
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const dragGestureRef = useRef(false);
  const suppressOpenRef = useRef(false);
  useEffect(() => {
    if (dragging || !suppressOpenRef.current) return;
    const timer = window.setTimeout(() => {
      suppressOpenRef.current = false;
      dragGestureRef.current = false;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dragging]);
  const dogStatus = hotelRoomBoardDogStatus(stay, selectedDate);
  const stage = dogStatus.stage;
  const unspecified = hotelStayUnspecifiedState(stay);
  const draggable = !disabled && hotelRoomBoardDropAction(stay) !== null;
  const roomType =
    stay.capacityReservation?.roomTypeCode ??
    stay.capacityReservation?.roomTypeName ??
    "객실 미정";
  const phaseTime = hotelRoomBoardPhaseTime(stay, selectedDate);
  return (
    <div
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return;
        dragGestureRef.current = true;
        suppressOpenRef.current = true;
        onDragStart(event, stay.id);
      }}
      onPointerDown={(event) => {
        if (!draggable) return;
        pointerOriginRef.current = { x: event.clientX, y: event.clientY };
        dragGestureRef.current = false;
      }}
      onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
        const origin = pointerOriginRef.current;
        if (!draggable || !origin || dragGestureRef.current) return;
        if (
          !isHotelRoomBoardDragGesture(
            event.clientX - origin.x,
            event.clientY - origin.y,
          )
        ) {
          return;
        }
        dragGestureRef.current = true;
        suppressOpenRef.current = true;
        onPointerStart(stay.id);
      }}
      onPointerUp={() => {
        pointerOriginRef.current = null;
      }}
      onPointerCancel={() => {
        pointerOriginRef.current = null;
      }}
      data-testid={`hotel-room-board-stay-${stay.id}`}
      data-room-phase={stage}
      className={cn(
        "hotel-room-card-settle group relative select-none rounded-xl border shadow-sm transition-[transform,box-shadow,opacity] duration-200 ease-out will-change-transform",
        variant === "waiting"
          ? cn(
              "border-amber-300 bg-amber-50 text-amber-950",
              mobile ? "px-3 py-2.5" : "px-2.5 py-1.5",
            )
          : cn(mobile ? "px-3 py-2.5" : "px-2 py-1", stageClass(stage)),
        draggable &&
          "cursor-grab hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing",
        dragging &&
          "z-10 rotate-[1.25deg] scale-[1.04] cursor-grabbing opacity-40 shadow-[0_26px_54px_rgb(15_23_42_/_0.34)] ring-2 ring-white/80",
        returning && "hotel-room-card-return",
        settling && "hotel-room-card-absorb",
        disabled && "opacity-60",
      )}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-1 rounded-lg border border-dashed border-slate-500/50 bg-white/35" />
      ) : null}
      <div className="relative flex min-h-9 w-full items-start gap-1">
        <button
          type="button"
          aria-label={`${stay.dogName} 호실 이동 시작`}
          disabled={!draggable}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (draggable) onSelectForDrop(stay.id);
          }}
          className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl opacity-70 transition hover:bg-white/70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed sm:-m-1 sm:h-8 sm:w-8 sm:rounded-lg sm:opacity-45"
        >
          <GripVertical size={17} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            if (suppressOpenRef.current || dragGestureRef.current) {
              event.preventDefault();
              event.stopPropagation();
              suppressOpenRef.current = false;
              dragGestureRef.current = false;
              return;
            }
            onOpen();
          }}
          className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate font-extrabold tracking-[-0.015em] text-slate-950", mobile ? "text-base leading-6" : "text-[15px] leading-5")}>
              {stay.dogName}
            </span>
            <span className="mt-0.5 block">
              <span
                className={cn(
                  "inline-flex rounded-full px-1.5 py-px font-extrabold ring-1 ring-inset",
                  mobile ? "text-xs leading-5" : "text-[9px] leading-[0.875rem]",
                  stageBadgeClass(stage, variant === "waiting"),
                )}
              >
                {variant === "waiting"
                  ? "미배정"
                  : dogStatus.label}
              </span>
            </span>
            {phaseTime ? (
              <span className={cn("mt-0.5 flex min-w-0 items-center gap-1 truncate font-bold tabular-nums text-slate-800", mobile ? "text-xs leading-5" : "text-[11px]")}>
                <Clock3 className="shrink-0" size={12} />
                {variant === "waiting"
                  ? formatHotelScheduleTime(stay, "check_in")
                  : phaseTime}
              </span>
            ) : null}
            <span className={cn("block truncate font-semibold text-slate-500", mobile ? "text-xs leading-5" : "text-[10px]")}>
              {unspecified.roomType ? "객실 유형 미정" : roomType}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

export function SharedRoomCard({
  occupancy,
  staysById,
  selectedDate,
  onOpen,
  mobile = false,
}: {
  occupancy: SharedHotelOccupancy;
  staysById: ReadonlyMap<string, HotelStay>;
  selectedDate: string;
  onOpen: () => void;
  mobile?: boolean;
}) {
  const activeMembers = occupancy.members.filter((member) => member.status === "active");
  const cardStage = sharedRoomCardStage(occupancy, staysById, selectedDate);
  return (
    <button
      type="button"
      data-testid={`shared-room-card-${occupancy.id}`}
      data-room-phase={cardStage ?? "unknown"}
      onClick={onOpen}
      className={cn(
        "w-full rounded-xl border text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        mobile ? "px-3 py-3" : "px-2 py-2",
        cardStage ? stageClass(cardStage) : "border-slate-300 bg-slate-50 text-slate-950",
      )}
    >
      <span className="flex items-center justify-between gap-1">
        <strong className="truncate text-sm">같은 방 투숙</strong>
        <Badge tone="blue">공유</Badge>
      </span>
      <span className="mt-1 grid gap-1">
        {activeMembers.map((member) => {
          const stay = staysById.get(member.hotelStayId);
          const status = stay ? hotelRoomBoardDogStatus(stay, selectedDate) : null;
          const phaseTime = stay ? hotelRoomBoardPhaseTime(stay, selectedDate) : null;
          return (
            <span key={member.id} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-1.5">
              <span className={cn("truncate font-extrabold", mobile ? "text-sm leading-5" : "text-xs")}>{member.dogName}</span>
              {status ? (
                <span className={cn("shrink-0 rounded-full px-1.5 py-px font-extrabold ring-1 ring-inset", mobile ? "text-xs leading-5" : "text-[9px] leading-[0.875rem]", stageBadgeClass(status.stage, false))}>
                  {status.label}
                </span>
              ) : <span className={cn("font-bold text-slate-500", mobile ? "text-xs" : "text-[9px]")}>일정 확인</span>}
              {phaseTime ? <span className={cn("col-span-2 truncate font-semibold tabular-nums text-slate-600", mobile ? "text-xs leading-5" : "text-[9px]")}>{phaseTime}</span> : null}
            </span>
          );
        })}
      </span>
      <span className={cn("mt-1 block font-semibold", mobile ? "text-xs" : "text-[11px]")}>함께 투숙 · {activeMembers.length}마리 · 객실 1실</span>
    </button>
  );
}

function UnassignedSharedRoomCard({
  group,
  disabled,
  dragging,
  mobile,
  onSelectForDrop,
  onDragStart,
  onPointerStart,
}: {
  group: UnassignedSharedRoomGroup;
  disabled: boolean;
  dragging: boolean;
  mobile: boolean;
  onSelectForDrop: (sharedRoomGroupId: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, sharedRoomGroupId: string) => void;
  onPointerStart: (sharedRoomGroupId: string) => void;
}) {
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const draggable = !disabled;
  const format = (value: string) => new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
  return (
    <div
      draggable={draggable}
      data-testid={`hotel-room-board-unassigned-shared-${group.sharedRoomGroupId}`}
      onDragStart={(event) => draggable && onDragStart(event, group.sharedRoomGroupId)}
      onPointerDown={(event) => {
        if (draggable) pointerOriginRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const origin = pointerOriginRef.current;
        if (!origin || !draggable) return;
        if (isHotelRoomBoardDragGesture(event.clientX - origin.x, event.clientY - origin.y)) {
          pointerOriginRef.current = null;
          onPointerStart(group.sharedRoomGroupId);
        }
      }}
      onPointerUp={() => { pointerOriginRef.current = null; }}
      className={cn(
        "group relative select-none rounded-xl border border-indigo-300 bg-indigo-50 text-indigo-950 shadow-sm transition",
        mobile ? "px-3 py-3" : "px-3 py-2.5",
        draggable && "cursor-grab hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing",
        dragging && "scale-[1.03] opacity-40 ring-2 ring-indigo-300",
        disabled && "opacity-60",
      )}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          aria-label={`${group.dogMembers.map((member) => member.dogName).join(" · ")} 객실 배정 시작`}
          disabled={!draggable}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (draggable) onSelectForDrop(group.sharedRoomGroupId);
          }}
          className="-m-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl opacity-60 hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <GripVertical size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <strong className="break-keep text-sm font-extrabold leading-5">
              {group.dogMembers.map((member) => member.dogName).join(" · ")}
            </strong>
            <Badge tone="blue">함께 투숙</Badge>
          </div>
          <p className="mt-1 text-xs font-bold text-indigo-800">DELUXE · 미배정</p>
          <p className="mt-0.5 text-xs font-semibold tabular-nums text-indigo-700">
            {format(group.reservedFrom)} → {format(group.reservedUntil)}
          </p>
          <p className="mt-0.5 text-[11px] font-bold text-indigo-700">{group.dogCount}마리 · 객실 1실</p>
        </div>
      </div>
    </div>
  );
}

function RoomCell({
  room,
  stays,
  sharedOccupancy,
  daycareReservation,
  staysById,
  selectedDate,
  draggedStay,
  draggedSharedGroup,
  draggedStayId,
  draggedSharedGroupId,
  returningStayId,
  settlingStayId,
  hoveredRoomId,
  recommended,
  settling,
  processing,
  allowCrossTypeChange,
  onOpenStay,
  onOpenSharedOccupancy,
  onDropStay,
  onDropSharedGroup,
  onDragStart,
  onSelectForDrop,
  onPointerDrop,
  onPointerStart,
  onTargetHover,
  mobile = false,
}: {
  room: HotelRoomSnapshot;
  stays: HotelStay[];
  sharedOccupancy: SharedHotelOccupancy | null;
  daycareReservation: DaycareReservation | null;
  staysById: ReadonlyMap<string, HotelStay>;
  selectedDate: string;
  draggedStay: HotelStay | null;
  draggedSharedGroup: UnassignedSharedRoomGroup | null;
  draggedStayId: string | null;
  draggedSharedGroupId: string | null;
  returningStayId: string | null;
  settlingStayId: string | null;
  hoveredRoomId: string | null;
  recommended: boolean;
  settling: boolean;
  processing: boolean;
  allowCrossTypeChange: boolean;
  onOpenStay: (stayId: string) => void;
  onOpenSharedOccupancy: (occupancyId: string) => void;
  onDropStay: (
    stayId: string,
    roomId: string,
    requiresRoomTypeChange: boolean,
  ) => void;
  onDropSharedGroup: (sharedRoomGroupId: string, roomId: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, stayId: string) => void;
  onSelectForDrop: (stayId: string) => void;
  onPointerDrop: (roomId: string) => void;
  onPointerStart: (stayId: string) => void;
  onTargetHover: (roomId: string | null) => void;
  mobile?: boolean;
}) {
  const targetState = draggedStay
    ? hotelRoomBoardRoomTarget(draggedStay, room, stays.length > 0 || Boolean(sharedOccupancy) || Boolean(daycareReservation))
    : "blocked";
  const occupied = stays.length > 0 || Boolean(sharedOccupancy) || Boolean(daycareReservation);
  const acceptsDraggedSharedGroup = Boolean(
    draggedSharedGroup &&
    hotelRoomBoardSharedGroupCanDrop(draggedSharedGroup, room, occupied),
  );
  const acceptsDraggedStay = acceptsDraggedSharedGroup || (
    targetState !== "blocked" &&
    (targetState !== "change_type" || allowCrossTypeChange)
  );
  const requiresRoomTypeChange = targetState === "change_type";
  const isHoveredDropTarget = acceptsDraggedStay && hoveredRoomId === room.id;
  const roomStage = daycareReservation && !mobile
    ? null
    : roomBoardRoomStage(
        stays,
        sharedOccupancy,
        daycareReservation,
        staysById,
        selectedDate,
      );
  return (
    <div
      data-testid={`hotel-room-board-room-${room.id}`}
      data-room-phase={roomStage ?? "empty"}
      onPointerDown={() => {
        if (acceptsDraggedStay) onPointerDrop(room.id);
      }}
      onDragEnter={(event) => {
        if (acceptsDraggedStay) {
          event.preventDefault();
          onTargetHover(room.id);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onTargetHover(null);
        }
      }}
      onDragOver={(event) => {
        if (acceptsDraggedStay) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onTargetHover(room.id);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        onTargetHover(null);
        const payload = parseHotelRoomBoardDragPayload(
          event.dataTransfer.getData("application/x-hotel-room-board-drag"),
        );
        const sharedRoomGroupId =
          (payload?.kind === "shared_group" ? payload.sharedRoomGroupId : "") ||
          event.dataTransfer.getData("application/x-hotel-shared-group-id") ||
          draggedSharedGroupId;
        const stayId =
          (payload?.kind === "stay" ? payload.stayId : "") ||
          event.dataTransfer.getData("application/x-hotel-stay-id") ||
          event.dataTransfer.getData("text/plain") ||
          draggedStayId;
        if (sharedRoomGroupId && acceptsDraggedSharedGroup) {
          onDropSharedGroup(sharedRoomGroupId, room.id);
        } else if (stayId && acceptsDraggedStay) {
          onDropStay(stayId, room.id, requiresRoomTypeChange);
        }
      }}
      onPointerEnter={() => {
        if (acceptsDraggedStay) onTargetHover(room.id);
      }}
      onPointerLeave={() => {
        if (hoveredRoomId === room.id) onTargetHover(null);
      }}
      onPointerUp={() => onPointerDrop(room.id)}
      className={cn(
        "relative overflow-visible rounded-xl border transition-[transform,box-shadow,border-color,background-color,opacity] duration-200 ease-out will-change-transform",
        mobile ? "min-h-[4.5rem] p-2.5" : "min-h-[5.5rem] p-1.5",
        roomStageClass(roomStage),
        Boolean(daycareReservation) && !mobile && "border-cyan-200 bg-cyan-50/55",
        acceptsDraggedStay &&
          (requiresRoomTypeChange
            ? "border-dashed border-amber-500/70 bg-amber-50/60"
            : "border-dashed border-primary/55 bg-primary-subtle/20"),
        isHoveredDropTarget &&
          (requiresRoomTypeChange
            ? "z-10 scale-[1.015] border-2 border-solid border-amber-600 bg-amber-50 shadow-[0_14px_30px_rgb(180_83_9_/_0.22)]"
            : "z-10 scale-[1.015] border-2 border-solid border-primary bg-primary-subtle shadow-[0_14px_30px_rgb(39_76_119_/_0.22),inset_0_0_0_1px_rgb(39_76_119_/_0.22)]"),
        Boolean(draggedStay || draggedSharedGroup) && !acceptsDraggedStay && "opacity-55",
        recommended &&
          acceptsDraggedStay &&
          !isHoveredDropTarget &&
          "border-emerald-400/75 bg-emerald-50/35 ring-2 ring-emerald-300/45 ring-offset-1",
        settling &&
          "hotel-room-drop-settle border-primary/70 bg-primary-subtle/70 shadow-[0_14px_28px_rgb(39_76_119_/_0.18)]",
      )}
    >
      <div className="mb-1 flex min-w-0 items-center justify-between gap-1.5 px-0.5">
        <b className="whitespace-nowrap text-sm font-extrabold text-text-primary">
          {room.name}
        </b>
        {recommended && acceptsDraggedStay ? (
          <span className={cn("group/reason relative flex items-center gap-1 rounded-full bg-emerald-100/70 px-1.5 py-0.5 font-extrabold text-emerald-800", mobile ? "text-xs" : "text-[10px]")}>
            <Sparkles size={10} /> 추천
            <span
              role="tooltip"
              className="pointer-events-none absolute right-0 top-full z-30 mt-1 w-max max-w-44 translate-y-1 rounded-lg bg-slate-900 px-2 py-1.5 text-[10px] font-semibold leading-4 text-white opacity-0 shadow-lg transition duration-200 ease-out group-hover/reason:translate-y-0 group-hover/reason:opacity-100"
            >
              같은 유형에서 가장 가까운 빈 호실
            </span>
          </span>
        ) : null}
      </div>

      {daycareReservation ? (
        <button
          type="button"
          className={cn("w-full rounded-lg border border-cyan-200 bg-white text-left shadow-sm", mobile ? "px-3 py-2.5" : "px-2.5 py-2")}
          aria-label={`${daycareReservation.dog.name} 데이케어`}
        >
          <span className={cn("block truncate font-extrabold text-cyan-950", mobile ? "text-sm leading-5" : "text-xs")}>{daycareReservation.dog.name}</span>
          <span className={cn("mt-1 block font-bold text-cyan-700", mobile ? "text-xs leading-5" : "text-[10px]")}>데이케어 · {daycareReservation.lifecycleStatus === "checked_in" ? "이용중" : "예약"}</span>
          <span className={cn("mt-0.5 block text-cyan-800", mobile ? "text-xs leading-5" : "text-[10px]")}>퇴실 {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(daycareReservation.endsAt))}</span>
        </button>
      ) : sharedOccupancy ? (
        <SharedRoomCard
          occupancy={sharedOccupancy}
          staysById={staysById}
          selectedDate={selectedDate}
          onOpen={() => onOpenSharedOccupancy(sharedOccupancy.id)}
          mobile={mobile}
        />
      ) : stays.length ? (
        <div className="space-y-2">
          {stays.map((stay) => (
            <DraggableStayCard
              key={stay.id}
              stay={stay}
              selectedDate={selectedDate}
              disabled={processing}
              dragging={draggedStayId === stay.id}
              returning={returningStayId === stay.id}
              settling={settlingStayId === stay.id}
              variant="room"
              mobile={mobile}
              onOpen={() => onOpenStay(stay.id)}
              onSelectForDrop={onSelectForDrop}
              onDragStart={onDragStart}
              onPointerStart={onPointerStart}
            />
          ))}
        </div>
      ) : (
        <div className={cn("flex min-h-8 items-center justify-center px-2 text-center font-medium text-slate-400/70", mobile ? "text-xs" : "text-[9px]")}>
          빈 호실
        </div>
      )}

      <div
        aria-hidden={!isHoveredDropTarget}
        className={cn(
          "pointer-events-none absolute inset-1.5 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-white/95 text-sm font-extrabold text-primary shadow-lg transition-[opacity,transform] duration-200 ease-out",
          isHoveredDropTarget
            ? "scale-100 opacity-100"
            : "scale-95 opacity-0",
        )}
      >
        {draggedSharedGroup
          ? "함께 투숙 배정"
          : requiresRoomTypeChange ? "유형 변경 후 배정" : "여기에 배정"}
      </div>
    </div>
  );
}

export function HotelRoomBoard({
  snapshot,
  sharedOccupancies = [],
  unassignedSharedGroups = [],
  unassignedSharedGroupsError = "",
  unassignedSharedGroupsLoading = false,
  sharedMemberStays = [],
  daycareReservations = [],
  selectedDate,
  selectedDateIsToday,
  processing,
  processingStayId = null,
  allowCrossTypeChange,
  onOpenStay,
  onOpenSharedOccupancy = () => undefined,
  onDropStay,
  onDropSharedGroup = () => undefined,
  onRetryUnassignedSharedGroups = () => undefined,
  onUnassignStay,
}: {
  snapshot: HotelOperationsSnapshot;
  sharedOccupancies?: readonly SharedHotelOccupancy[];
  unassignedSharedGroups?: readonly UnassignedSharedRoomGroup[];
  unassignedSharedGroupsError?: string;
  unassignedSharedGroupsLoading?: boolean;
  sharedMemberStays?: readonly HotelStay[];
  daycareReservations?: readonly DaycareReservation[];
  selectedDate: string;
  selectedDateIsToday: boolean;
  processing: boolean;
  processingStayId?: string | null;
  allowCrossTypeChange: boolean;
  onOpenStay: (stayId: string) => void;
  onOpenSharedOccupancy?: (occupancyId: string) => void;
  onDropStay: (
    stayId: string,
    roomId: string,
    requiresRoomTypeChange: boolean,
  ) => void;
  onDropSharedGroup?: (sharedRoomGroupId: string, roomId: string) => void;
  onRetryUnassignedSharedGroups?: () => void;
  onUnassignStay: (stayId: string) => void;
}) {
  const [draggedStayId, setDraggedStayId] = useState<string | null>(null);
  const [draggedSharedGroupId, setDraggedSharedGroupId] = useState<string | null>(null);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [settlingRoomId, setSettlingRoomId] = useState<string | null>(null);
  const [settlingStayId, setSettlingStayId] = useState<string | null>(null);
  const [returningStayId, setReturningStayId] = useState<string | null>(null);
  const [showFutureUnassigned, setShowFutureUnassigned] = useState(false);
  const [showCompletedCheckouts, setShowCompletedCheckouts] = useState(false);
  const [mobileFilter, setMobileFilter] = useState<MobileRoomFilter>("all");
  const [mobileAccordionState, setMobileAccordionState] = useState<
    Partial<Record<"DELUXE" | "STANDARD", boolean>>
  >({});
  const mobileProjection = useMobileRoomBoardProjection();
  const unassignedSharedGroupsUnavailable = Boolean(unassignedSharedGroupsError);
  const boardInstant = selectedDateIsToday
    ? new Date().toISOString()
    : undefined;
  const draggedStayIdRef = useRef<string | null>(null);
  const draggedSharedGroupIdRef = useRef<string | null>(null);
  const dragModeRef = useRef<"pointer" | "selected" | null>(null);
  const dropCommittedRef = useRef(false);
  const previousRoomByStayRef = useRef<Map<string, string | null> | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const returnTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    setShowFutureUnassigned(false);
    setShowCompletedCheckouts(false);
    setMobileFilter("all");
    setMobileAccordionState({});
  }, [selectedDate]);
  const stays = snapshot.stays;
  const staysById = useMemo(
    () => new Map([...snapshot.stays, ...snapshot.unassignedFuture, ...sharedMemberStays].map((stay) => [stay.id, stay])),
    [sharedMemberStays, snapshot.stays, snapshot.unassignedFuture],
  );
  const sharedMemberStayIds = useMemo(
    () => new Set([
      ...sharedOccupancies.flatMap((occupancy) => occupancy.members.map((member) => member.hotelStayId)),
      ...unassignedSharedGroups.flatMap((group) => group.dogMembers.map((member) => member.hotelStayId)),
    ]),
    [sharedOccupancies, unassignedSharedGroups],
  );
  const boardStays = useMemo(() => {
    const byId = new Map<string, HotelStay>();
    [...stays, ...snapshot.unassignedFuture].forEach((stay) =>
      !sharedMemberStayIds.has(stay.id) && byId.set(stay.id, stay),
    );
    return [...byId.values()];
  }, [sharedMemberStayIds, snapshot.unassignedFuture, stays]);
  const unassigned = useMemo(
    () => hotelRoomBoardUnassigned(boardStays, boardInstant),
    [boardInstant, boardStays],
  );
  const unassignedGroups = useMemo(
    () => hotelRoomBoardUnassignedGroups(boardStays, selectedDate),
    [boardStays, selectedDate],
  );
  const allKnownStays = useMemo(() => {
    const byId = new Map<string, HotelStay>();
    [...snapshot.stays, ...snapshot.unassignedFuture, ...sharedMemberStays]
      .forEach((stay) => byId.set(stay.id, stay));
    return [...byId.values()];
  }, [sharedMemberStays, snapshot.stays, snapshot.unassignedFuture]);
  const completedCheckouts = useMemo(
    () => hotelRoomBoardCompletedCheckouts(allKnownStays, selectedDate),
    [allKnownStays, selectedDate],
  );
  const sharedRoomNameByStayId = useMemo(() => {
    const result = new Map<string, string>();
    sharedOccupancies.forEach((occupancy) =>
      occupancy.members.forEach((member) =>
        result.set(member.hotelStayId, occupancy.roomName),
      ),
    );
    return result;
  }, [sharedOccupancies]);
  const draggedStay =
    boardStays.find((stay) => stay.id === draggedStayId) ?? null;
  const draggedSharedGroup =
    unassignedSharedGroups.find((group) => group.sharedRoomGroupId === draggedSharedGroupId) ?? null;
  const roomStays = useMemo(() => {
    const entries = new Map<string, HotelStay[]>();
    stays.forEach((stay) => {
      if (sharedMemberStayIds.has(stay.id)) return;
      if (!hotelRoomBoardOccupiesRoom(stay, boardInstant)) return;
      const roomId = stayRoomId(stay, boardInstant);
      if (!roomId) return;
      entries.set(roomId, [...(entries.get(roomId) ?? []), stay]);
    });
    return entries;
  }, [boardInstant, sharedMemberStayIds, stays]);
  const sharedByRoom = useMemo(
    () => new Map(sharedOccupancies.filter((occupancy) => occupancy.status === "active").map((occupancy) => [occupancy.roomId, occupancy])),
    [sharedOccupancies],
  );
  const daycareByRoom = useMemo(
    () => new Map(daycareReservations
      .filter((reservation) => reservation.roomAllocation && reservation.lifecycleStatus !== "completed" && reservation.lifecycleStatus !== "cancelled")
      .map((reservation) => [reservation.roomAllocation!.roomId, reservation])),
    [daycareReservations],
  );
  const activeRooms = useMemo(
    () =>
      snapshot.rooms
        .filter((room) => room.isActive)
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.name.localeCompare(right.name),
        ),
    [snapshot.rooms],
  );
  const occupiedRoomIds = useMemo(
    () => new Set([...roomStays.keys(), ...sharedByRoom.keys(), ...daycareByRoom.keys()]),
    [daycareByRoom, roomStays, sharedByRoom],
  );
  const boardSummary = useMemo(() => {
    const phases = boardStays.map((stay) => hotelStayDayPhase(stay, selectedDate));
    return {
      empty: Math.max(activeRooms.length - occupiedRoomIds.size, 0),
      unassigned: unassigned.length + unassignedSharedGroups.length,
      checkIn: phases.filter(
        (phase) => phase === "입실" || phase === "입실·퇴실",
      ).length,
      inHouse: phases.filter((phase) => phase === "이용중").length + sharedOccupancies.reduce((count, occupancy) => count + occupancy.members.filter((member) => member.status === "active").length, 0),
      checkOut: phases.filter(
        (phase) => phase === "퇴실" || phase === "입실·퇴실",
      ).length,
    };
  }, [activeRooms.length, boardStays, occupiedRoomIds.size, selectedDate, sharedOccupancies, unassigned.length, unassignedSharedGroups.length]);
  useEffect(() => {
    const current = new Map(
      stays.map((stay) => [stay.id, stayRoomId(stay, boardInstant)] as const),
    );
    const previous = previousRoomByStayRef.current;
    previousRoomByStayRef.current = current;
    if (!previous) return;
    const moved = [...current.entries()].find(
      ([stayId, roomId]) => roomId && previous.get(stayId) !== roomId,
    );
    if (!moved?.[1]) return;
    setSettlingStayId(moved[0]);
    setSettlingRoomId(moved[1]);
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(
      () => {
        setSettlingRoomId(null);
        setSettlingStayId(null);
      },
      240,
    );
  }, [boardInstant, stays]);
  const recommendedRoomId = useMemo(
    () =>
      draggedStay
        ? (hotelRoomBoardRecommendedRoom(
            draggedStay,
            activeRooms,
            occupiedRoomIds,
          )?.id ?? null)
        : null,
    [activeRooms, draggedStay, occupiedRoomIds],
  );
  const beginPointerDrag = (stayId: string) => {
    dropCommittedRef.current = false;
    dragModeRef.current = "pointer";
    draggedStayIdRef.current = stayId;
    draggedSharedGroupIdRef.current = null;
    setDraggedStayId(stayId);
    setDraggedSharedGroupId(null);
  };
  const selectForDrop = (stayId: string) => {
    if (
      dragModeRef.current === "selected" &&
      draggedStayIdRef.current === stayId
    ) {
      dragModeRef.current = null;
      draggedStayIdRef.current = null;
      setDraggedStayId(null);
      return;
    }
    dropCommittedRef.current = false;
    dragModeRef.current = "selected";
    draggedStayIdRef.current = stayId;
    draggedSharedGroupIdRef.current = null;
    setDraggedStayId(stayId);
    setDraggedSharedGroupId(null);
  };
  const beginNativeDrag = (
    event: DragEvent<HTMLDivElement>,
    stayId: string,
  ) => {
    beginPointerDrag(stayId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-hotel-room-board-drag",
      serializeHotelRoomBoardDragPayload({ kind: "stay", stayId }),
    );
    event.dataTransfer.setData("application/x-hotel-stay-id", stayId);
    event.dataTransfer.setData("text/plain", stayId);
    const preview = event.currentTarget.cloneNode(true) as HTMLElement;
    preview.style.position = "fixed";
    preview.style.left = "-1000px";
    preview.style.top = "-1000px";
    const bounds = event.currentTarget.getBoundingClientRect();
    const previewScale = 1.04;
    preview.style.width = `${Math.min(bounds.width, 240)}px`;
    preview.style.opacity = "0.92";
    preview.style.transform = `rotate(1.25deg) scale(${previewScale})`;
    preview.style.transformOrigin = "top left";
    preview.style.boxShadow = "0 28px 58px rgb(15 23 42 / 0.34)";
    preview.style.borderRadius = "12px";
    preview.style.pointerEvents = "none";
    document.body.appendChild(preview);
    const offsetX = Math.max(
      12,
      Math.min((event.clientX - bounds.left) * previewScale, bounds.width - 12),
    );
    const offsetY = Math.max(
      10,
      Math.min((event.clientY - bounds.top) * previewScale, bounds.height - 10),
    );
    event.dataTransfer.setDragImage(preview, offsetX, offsetY);
    requestAnimationFrame(() => preview.remove());
  };
  const beginSharedGroupPointerDrag = (sharedRoomGroupId: string) => {
    dropCommittedRef.current = false;
    dragModeRef.current = "pointer";
    draggedStayIdRef.current = null;
    draggedSharedGroupIdRef.current = sharedRoomGroupId;
    setDraggedStayId(null);
    setDraggedSharedGroupId(sharedRoomGroupId);
  };
  const selectSharedGroupForDrop = (sharedRoomGroupId: string) => {
    if (
      dragModeRef.current === "selected" &&
      draggedSharedGroupIdRef.current === sharedRoomGroupId
    ) {
      dragModeRef.current = null;
      draggedSharedGroupIdRef.current = null;
      setDraggedSharedGroupId(null);
      return;
    }
    dropCommittedRef.current = false;
    dragModeRef.current = "selected";
    draggedStayIdRef.current = null;
    draggedSharedGroupIdRef.current = sharedRoomGroupId;
    setDraggedStayId(null);
    setDraggedSharedGroupId(sharedRoomGroupId);
  };
  const beginSharedGroupNativeDrag = (
    event: DragEvent<HTMLDivElement>,
    sharedRoomGroupId: string,
  ) => {
    beginSharedGroupPointerDrag(sharedRoomGroupId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-hotel-room-board-drag",
      serializeHotelRoomBoardDragPayload({ kind: "shared_group", sharedRoomGroupId }),
    );
    event.dataTransfer.setData("application/x-hotel-shared-group-id", sharedRoomGroupId);
    event.dataTransfer.setData("text/plain", sharedRoomGroupId);
  };
  const commitDrop = (stayId: string, roomId: string) => {
    if (dropCommittedRef.current) return;
    dropCommittedRef.current = true;
    const stay = boardStays.find((item) => item.id === stayId);
    const room = activeRooms.find((item) => item.id === roomId);
    if (!stay || !room) return;
    const targetState = hotelRoomBoardRoomTarget(
      stay,
      room,
      (roomStays.get(room.id) ?? []).length > 0,
    );
    if (targetState === "blocked") return;
    onDropStay(stayId, roomId, targetState === "change_type");
  };
  const commitSharedGroupDrop = (sharedRoomGroupId: string, roomId: string) => {
    if (dropCommittedRef.current) return;
    const group = unassignedSharedGroups.find((item) => item.sharedRoomGroupId === sharedRoomGroupId);
    const room = activeRooms.find((item) => item.id === roomId);
    if (!group || !room || !hotelRoomBoardSharedGroupCanDrop(group, room, occupiedRoomIds.has(room.id))) return;
    dropCommittedRef.current = true;
    onDropSharedGroup(sharedRoomGroupId, roomId);
  };
  const commitPointerDrop = (roomId: string) => {
    const sharedRoomGroupId = draggedSharedGroupIdRef.current;
    const sharedGroup = unassignedSharedGroups.find((item) => item.sharedRoomGroupId === sharedRoomGroupId);
    const sharedRoom = activeRooms.find((item) => item.id === roomId);
    if (sharedRoomGroupId && sharedGroup && sharedRoom) {
      if (!processing && hotelRoomBoardSharedGroupCanDrop(sharedGroup, sharedRoom, occupiedRoomIds.has(roomId))) {
        commitSharedGroupDrop(sharedRoomGroupId, roomId);
      }
      return;
    }
    const stayId = draggedStayIdRef.current;
    const stay = boardStays.find((item) => item.id === stayId);
    const room = activeRooms.find((item) => item.id === roomId);
    if (
      !stayId ||
      !stay ||
      !room ||
      processing ||
      hotelRoomBoardRoomTarget(
        stay,
        room,
        (roomStays.get(room.id) ?? []).length > 0,
      ) === "blocked"
    ) {
      return;
    }
    commitDrop(stayId, roomId);
  };
  const commitUnassignDrop = () => {
    const stayId = draggedStayIdRef.current;
    const stay = boardStays.find((item) => item.id === stayId);
    if (
      !stayId ||
      !stay ||
      processing ||
      processingStayId === stayId ||
      !canDropHotelStayToUnassigned(stay) ||
      dropCommittedRef.current
    ) {
      return;
    }
    dropCommittedRef.current = true;
    onUnassignStay(stayId);
  };
  const endDrag = () => {
    if (dragModeRef.current === "selected" && !dropCommittedRef.current) return;
    const returningId = !dropCommittedRef.current
      ? draggedStayIdRef.current
      : null;
    dragModeRef.current = null;
    draggedStayIdRef.current = null;
    draggedSharedGroupIdRef.current = null;
    setDraggedStayId(null);
    setDraggedSharedGroupId(null);
    setHoveredRoomId(null);
    if (returningId) {
      setReturningStayId(returningId);
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
      returnTimerRef.current = window.setTimeout(
        () => setReturningStayId(null),
        260,
      );
    }
  };
  const renderUnassignedCards = (items: HotelStay[]) => (
    <div className={cn(
      mobileProjection
        ? "grid grid-cols-1 gap-2"
        : "flex gap-3 overflow-x-auto overscroll-x-contain pb-1.5",
    )}>
      {items.map((stay) => {
        const roomTypeReady = Boolean(stay.capacityReservation?.roomTypeId);
        return (
          <div
            key={stay.id}
            className={cn(!mobileProjection && "min-w-[240px] max-w-[280px] flex-[0_0_260px]")}
          >
            <DraggableStayCard
              stay={stay}
              selectedDate={selectedDate}
              disabled={
                processing ||
                processingStayId === stay.id ||
                !roomTypeReady
              }
              dragging={draggedStayId === stay.id}
              returning={returningStayId === stay.id}
              settling={settlingStayId === stay.id}
              variant="waiting"
              mobile={mobileProjection}
              onOpen={() => onOpenStay(stay.id)}
              onSelectForDrop={selectForDrop}
              onDragStart={beginNativeDrag}
              onPointerStart={beginPointerDrag}
            />
            {!roomTypeReady ? (
              <p className={cn("mt-1 px-1 font-medium text-amber-700", mobileProjection ? "text-xs" : "text-[11px]")}>
                객실 유형을 먼저 확정해 주세요.
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
  const renderUnassignedSharedGroups = () => (
    <div className={cn(
      mobileProjection
        ? "grid grid-cols-1 gap-2"
        : "flex gap-3 overflow-x-auto overscroll-x-contain pb-1.5",
    )}>
      {unassignedSharedGroups.map((group) => (
        <div
          key={group.sharedRoomGroupId}
          className={cn(!mobileProjection && "min-w-[260px] max-w-[320px] flex-[0_0_290px]")}
        >
          <UnassignedSharedRoomCard
            group={group}
            disabled={processing}
            dragging={draggedSharedGroupId === group.sharedRoomGroupId}
            mobile={mobileProjection}
            onSelectForDrop={selectSharedGroupForDrop}
            onDragStart={beginSharedGroupNativeDrag}
            onPointerStart={beginSharedGroupPointerDrag}
          />
          <p className="mt-1 px-1 text-[11px] font-medium text-indigo-700">
            함께 투숙 예약은 객실 배정 전 개별 수정할 수 없습니다.
          </p>
        </div>
      ))}
    </div>
  );
  const renderRoomCell = (room: HotelRoomSnapshot, mobile = false) => (
    <RoomCell
      key={room.id}
      room={room}
      stays={roomStays.get(room.id) ?? []}
      sharedOccupancy={sharedByRoom.get(room.id) ?? null}
      daycareReservation={daycareByRoom.get(room.id) ?? null}
      staysById={staysById}
      selectedDate={selectedDate}
      draggedStay={draggedStay}
      draggedSharedGroup={draggedSharedGroup}
      draggedStayId={draggedStayId}
      draggedSharedGroupId={draggedSharedGroupId}
      returningStayId={returningStayId}
      settlingStayId={settlingStayId}
      hoveredRoomId={hoveredRoomId}
      recommended={recommendedRoomId === room.id}
      settling={settlingRoomId === room.id}
      processing={
        processing ||
        (processingStayId !== null && processingStayId === draggedStayId)
      }
      allowCrossTypeChange={allowCrossTypeChange}
      onOpenStay={onOpenStay}
      onOpenSharedOccupancy={onOpenSharedOccupancy}
      onDropStay={commitDrop}
      onDropSharedGroup={commitSharedGroupDrop}
      onDragStart={beginNativeDrag}
      onSelectForDrop={selectForDrop}
      onPointerDrop={commitPointerDrop}
      onPointerStart={beginPointerDrag}
      onTargetHover={setHoveredRoomId}
      mobile={mobile}
    />
  );

  return (
    <Card
      className="mb-6 overflow-hidden"
      data-testid="hotel-room-board"
    >
      <div
        onDragEnd={endDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="border-b border-border px-4 py-4 sm:px-5 lg:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={cn("font-extrabold uppercase tracking-[0.16em] text-primary", mobileProjection ? "text-xs" : "text-[11px]")}>
                Room Board
              </p>
              <h2 className="mt-1 text-xl font-extrabold text-text-primary">
                객실 현황
              </h2>
              <p className="mt-0.5 text-xs text-text-secondary">
                빈방과 오늘의 입·퇴실, 이용중 객실을 한 화면에서 관리합니다.
              </p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["빈방", boardSummary.empty, "border-slate-200 bg-slate-50 text-slate-700"],
              ["이용중", boardSummary.inHouse, "border-emerald-200 bg-emerald-50 text-emerald-900"],
              [
                "미배정",
                unassignedSharedGroupsUnavailable
                  ? "확인 필요"
                  : unassignedSharedGroupsLoading
                    ? "확인 중"
                    : boardSummary.unassigned,
                "border-amber-200 bg-amber-50 text-amber-900",
              ],
              [selectedDateIsToday ? "오늘 입실" : "입실", boardSummary.checkIn, "border-blue-200 bg-blue-50 text-blue-900"],
              [selectedDateIsToday ? "오늘 퇴실" : "퇴실", boardSummary.checkOut, "border-orange-200 bg-orange-50 text-orange-950"],
            ].map(([label, value, className]) => (
              <div
                key={label}
                className={cn(
                  "flex min-h-14 items-center justify-between rounded-xl border px-3 py-2",
                  className as string,
                )}
              >
                <dt className="text-xs font-bold">{label}</dt>
                <dd className={cn(
                  "font-black tabular-nums",
                  typeof value === "number" ? "text-lg" : "text-xs",
                )}>{value}</dd>
              </div>
            ))}
          </dl>
          <div className={cn("mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-medium text-text-muted", mobileProjection ? "text-xs" : "text-[11px]")}>
            <span>카드를 눌러 상세 보기</span>
            <span className="sm:hidden">이동 아이콘을 누른 뒤 대상 호실을 누르세요</span>
            <span className="hidden sm:inline">끌어서 호실 배정·이동</span>
          </div>
          {draggedSharedGroup ? (
            <p role="status" className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">
              같은 객실 투숙은 디럭스 객실에만 배정할 수 있습니다.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-5 p-4 sm:p-5 lg:p-6">
          <div
            data-testid="hotel-room-board-unassigned-drop-zone"
            onDragEnter={(event) => {
              if (draggedStay && canDropHotelStayToUnassigned(draggedStay)) {
                event.preventDefault();
              }
            }}
            onDragOver={(event) => {
              if (draggedStay && canDropHotelStayToUnassigned(draggedStay)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              commitUnassignDrop();
            }}
            onPointerUp={commitUnassignDrop}
            className={cn(
              "min-w-0 rounded-2xl border border-amber-200/80 bg-[#fbfaf7] px-4 shadow-[inset_3px_0_0_0_rgb(245_158_11_/_0.5)]",
              unassigned.length || unassignedSharedGroups.length || unassignedSharedGroupsError || unassignedSharedGroupsLoading
                ? "py-3.5"
                : "py-2.5",
              Boolean(
                draggedStay && canDropHotelStayToUnassigned(draggedStay),
              ) &&
                "border-dashed border-amber-500 bg-amber-50 ring-2 ring-amber-200",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-between gap-2",
                (unassigned.length > 0 || unassignedSharedGroups.length > 0 || unassignedSharedGroupsError || unassignedSharedGroupsLoading) && "mb-3",
              )}
            >
              <div>
                <h3 className="text-base font-extrabold text-text-primary">
                  호실 미배정
                </h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {unassignedSharedGroupsError
                    ? "함께 투숙 미배정 예약은 현재 확인이 필요합니다."
                    : unassignedSharedGroupsLoading
                      ? "함께 투숙 미배정 예약을 확인하고 있습니다."
                      : unassigned.length || unassignedSharedGroups.length
                    ? mobileProjection
                      ? "입실 대기 · 이동 아이콘을 누른 뒤 대상 호실을 선택하세요"
                      : "입실 대기 · 호실로 드래그하세요"
                    : "현재 미배정 예약이 없습니다."}
                </p>
              </div>
              <Badge tone={unassigned.length || unassignedSharedGroups.length || unassignedSharedGroupsError ? "amber" : "gray"}>
                {unassignedSharedGroupsError
                  ? "확인 필요"
                  : unassignedSharedGroupsLoading
                    ? "확인 중"
                    : `${unassigned.length + unassignedSharedGroups.length}건`}
              </Badge>
            </div>
            {unassignedSharedGroupsError ? (
              <div
                role="alert"
                className="mb-3 flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-extrabold">{unassignedSharedGroupsError}</p>
                  <p className="mt-0.5 text-xs font-medium text-red-800">
                    기존 객실 현황은 계속 사용할 수 있습니다. 함께 투숙 예약만 다시 확인해 주세요.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onRetryUnassignedSharedGroups}
                  className="min-h-10 shrink-0 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-extrabold text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  다시 시도
                </button>
              </div>
            ) : null}
            {unassignedSharedGroups.length ? (
              <section aria-label="함께 투숙 미배정" className="mb-3">
                <div className="mb-2 flex items-center gap-2">
                  <strong className="text-sm text-indigo-900">함께 투숙</strong>
                  <Badge tone="blue">{unassignedSharedGroups.length}</Badge>
                </div>
                {renderUnassignedSharedGroups()}
              </section>
            ) : null}
            {unassignedGroups.today.length ? (
              <section aria-label="오늘 입실 미배정">
                <div className="mb-2 flex items-center gap-2">
                  <strong className="text-sm text-blue-900">오늘 입실</strong>
                  <Badge tone="blue">{unassignedGroups.today.length}</Badge>
                </div>
                {renderUnassignedCards(unassignedGroups.today)}
              </section>
            ) : null}
            {unassignedGroups.overdue.length ? (
              <section
                aria-label="미처리 미배정"
                className={unassignedGroups.today.length ? "mt-3 border-t border-amber-200 pt-3" : ""}
              >
                <div className="mb-2 flex items-center gap-2">
                  <strong className="text-sm text-amber-900">미처리</strong>
                  <Badge tone="amber">{unassignedGroups.overdue.length}</Badge>
                </div>
                {renderUnassignedCards(unassignedGroups.overdue)}
              </section>
            ) : null}
            {unassigned.length && !unassignedGroups.today.length && !unassignedGroups.overdue.length ? (
              <p className="text-xs font-medium text-text-muted">선택한 날짜에 처리할 미배정 예약은 없습니다.</p>
            ) : null}
          </div>

          {unassignedGroups.future.length ? (
            <section
              aria-label="향후 입실 미배정"
              className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3"
            >
              <div className={cn("flex items-center justify-between gap-3", showFutureUnassigned && "mb-3")}>
                <div>
                  <h3 className="text-sm font-extrabold text-text-primary">향후 입실</h3>
                  <p className="mt-0.5 text-xs text-text-muted">선택한 날짜 이후의 미배정 예약입니다.</p>
                </div>
                <button
                  type="button"
                  aria-expanded={showFutureUnassigned}
                  onClick={() => setShowFutureUnassigned((current) => !current)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {showFutureUnassigned ? "접기" : `${unassignedGroups.future.length}건 펼쳐보기`}
                </button>
              </div>
              {showFutureUnassigned ? renderUnassignedCards(unassignedGroups.future) : null}
            </section>
          ) : null}

          {mobileProjection ? (
            <div className="min-w-0 space-y-4" data-testid="hotel-room-board-mobile-projection">
              <section aria-label="현재 객실 상태 필터">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-extrabold text-text-primary">현재 객실</h3>
                    <p className="mt-0.5 text-xs font-medium text-text-secondary">선택한 날짜의 객실 상태</p>
                  </div>
                  {draggedStay || draggedSharedGroup ? <Badge tone="blue">이동할 호실 선택</Badge> : null}
                </div>
                <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="객실 상태">
                  {([
                    ["all", "전체"],
                    ["check_in", "입실"],
                    ["in_house", "이용중"],
                    ["check_out", "퇴실"],
                    ["empty", "빈방"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={!draggedStay && !draggedSharedGroup && mobileFilter === value}
                      disabled={Boolean(draggedStay || draggedSharedGroup)}
                      onClick={() => setMobileFilter(value)}
                      className={cn(
                        "min-h-11 rounded-xl border px-1.5 text-xs font-extrabold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        !draggedStay && !draggedSharedGroup && mobileFilter === value
                          ? "border-primary bg-primary text-white"
                          : "border-slate-200 bg-white text-slate-700",
                        Boolean(draggedStay || draggedSharedGroup) && "opacity-50",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              {(["DELUXE", "STANDARD"] as const).map((roomTypeCode) => {
                const rooms = activeRooms.filter((room) => room.roomTypeCode === roomTypeCode);
                const occupied = rooms.filter((room) => occupiedRoomIds.has(room.id));
                const empty = rooms.filter((room) => !occupiedRoomIds.has(room.id));
                const defaultExpanded = occupied.length > 0;
                const expanded = Boolean(draggedStay || draggedSharedGroup) ||
                  (mobileAccordionState[roomTypeCode] ?? defaultExpanded);
                const effectiveFilter = draggedStay || draggedSharedGroup ? "all" : mobileFilter;
                const visibleOccupied = occupied.filter((room) => {
                  if (effectiveFilter === "all") return true;
                  if (effectiveFilter === "empty") return false;
                  return roomBoardRoomStage(
                    roomStays.get(room.id) ?? [],
                    sharedByRoom.get(room.id) ?? null,
                    daycareByRoom.get(room.id) ?? null,
                    staysById,
                    selectedDate,
                  ) === effectiveFilter;
                });
                const visibleEmpty = effectiveFilter === "all" || effectiveFilter === "empty"
                  ? empty
                  : [];

                return (
                  <section
                    key={roomTypeCode}
                    aria-label={`${roomTypeCode} 모바일 Room Board`}
                    className="overflow-hidden rounded-2xl border border-border bg-surface"
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setMobileAccordionState((current) => ({
                        ...current,
                        [roomTypeCode]: !expanded,
                      }))}
                      className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    >
                      <span>
                        <strong className="block text-base text-text-primary">{roomTypeCode}</strong>
                        <span className="mt-0.5 block text-xs font-semibold text-text-secondary">
                          {occupied.length} 사용 / {empty.length} 빈방
                        </span>
                      </span>
                      <ChevronDown className={cn("shrink-0 transition-transform", expanded && "rotate-180")} size={20} />
                    </button>
                    {expanded ? (
                      <div className="border-t border-border px-3 py-3">
                        {visibleOccupied.length ? (
                          <div className="grid grid-cols-1 gap-3" data-testid={`${roomTypeCode.toLowerCase()}-mobile-occupied`}>
                            {visibleOccupied.map((room) => renderRoomCell(room, true))}
                          </div>
                        ) : null}
                        {visibleEmpty.length ? (
                          <div className={cn("grid grid-cols-2 gap-2", visibleOccupied.length > 0 && "mt-3")} data-testid={`${roomTypeCode.toLowerCase()}-mobile-empty`}>
                            {visibleEmpty.map((room) => renderRoomCell(room, true))}
                          </div>
                        ) : null}
                        {!visibleOccupied.length && !visibleEmpty.length ? (
                          <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs font-medium text-text-muted">선택한 상태의 객실이 없습니다.</p>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="min-w-0 space-y-6 overflow-x-auto overscroll-x-contain pb-2" data-testid="hotel-room-board-desktop-projection">
              {(["DELUXE", "STANDARD"] as const).map((roomTypeCode) => {
                const rooms = activeRooms.filter((room) => room.roomTypeCode === roomTypeCode);
                const usedCount = rooms.filter((room) => occupiedRoomIds.has(room.id)).length;
                const remainingCount = Math.max(rooms.length - usedCount, 0);

                return (
                  <section key={roomTypeCode} aria-label={`${roomTypeCode} Room Board`}>
                    <div className="mb-3 flex items-end justify-between gap-3 border-b border-border pb-2">
                      <div>
                        <h3 className="text-base font-extrabold text-text-primary">{roomTypeCode}</h3>
                        <p className="mt-0.5 text-xs font-semibold text-text-secondary">{usedCount} / {rooms.length} 사용</p>
                      </div>
                      <Badge tone={remainingCount ? "green" : "amber"}>{remainingCount}실 잔여</Badge>
                    </div>
                    <div className={cn("grid gap-3", roomTypeCode === "DELUXE" ? "min-w-[720px] grid-cols-6" : "min-w-[600px] grid-cols-5")}>
                      {rooms.map((room) => renderRoomCell(room))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {completedCheckouts.length ? (
            <section
              aria-label="퇴실 완료 명단"
              data-testid="hotel-room-board-completed-checkouts"
              className="rounded-2xl border border-emerald-200 bg-emerald-50/45 px-4 py-3.5"
            >
              <button
                type="button"
                aria-expanded={!mobileProjection || showCompletedCheckouts}
                disabled={!mobileProjection}
                onClick={() => setShowCompletedCheckouts((current) => !current)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  (!mobileProjection || showCompletedCheckouts) && "mb-3",
                  mobileProjection && "min-h-11",
                )}
              >
                <span>
                  <span className="block text-base font-extrabold text-text-primary">퇴실 완료</span>
                  <span className="mt-0.5 block text-xs text-text-secondary">선택한 날짜의 실제 퇴실 처리 명단입니다.</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone="green">{completedCheckouts.length}건</Badge>
                  {mobileProjection ? <ChevronDown className={cn("transition-transform", showCompletedCheckouts && "rotate-180")} size={20} /> : null}
                </span>
              </button>
              {!mobileProjection || showCompletedCheckouts ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {completedCheckouts.map((stay) => {
                  const allocation = [...stay.roomAllocations].sort((left, right) =>
                    right.allocatedFrom.localeCompare(left.allocatedFrom),
                  )[0];
                  const roomName = sharedRoomNameByStayId.get(stay.id) ?? allocation?.roomName ?? "호실 확인";
                  const roomType = stay.capacityReservation?.roomTypeCode ?? stay.capacityReservation?.roomTypeName;
                  const checkedOutTime = stay.checkedOutAt
                    ? seoulInputParts(stay.checkedOutAt).time
                    : "-";
                  return (
                    <button
                      key={stay.id}
                      type="button"
                      onClick={() => onOpenStay(stay.id)}
                      className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-left transition hover:border-emerald-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-text-primary">{stay.dogName}</strong>
                        <span className={cn("block truncate font-medium text-text-secondary", mobileProjection ? "text-xs" : "text-[11px]")}>
                          {roomName}{roomType ? ` · ${roomType}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-extrabold tabular-nums text-emerald-800">{checkedOutTime}</span>
                    </button>
                  );
                })}
              </div> : null}
            </section>
          ) : null}

        </div>
      </div>
    </Card>
  );
}
