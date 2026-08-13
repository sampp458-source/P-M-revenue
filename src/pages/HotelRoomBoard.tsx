import { Clock3, GripVertical, Sparkles } from "lucide-react";
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
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
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

export type HotelRoomBoardDropAction = "assign" | "reassign" | "move";
export type HotelRoomBoardRoomTarget =
  | "same_type"
  | "change_type"
  | "blocked";

const ROOM_BOARD_DRAG_THRESHOLD = 7;

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

export function hotelRoomBoardUnassigned(stays: HotelStay[]) {
  return stays.filter(
    (stay) =>
      !stay.archivedAt &&
      !stay.checkedOutAt &&
      !activeHotelAllocation(stay),
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

export function hotelRoomBoardOccupiesRoom(stay: HotelStay) {
  return !stay.checkedOutAt && activeHotelAllocation(stay) !== null;
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

function stayRoomId(stay: HotelStay) {
  return activeHotelAllocation(stay)?.roomId ?? null;
}

function DraggableStayCard({
  stay,
  selectedDate,
  disabled,
  dragging,
  returning,
  settling,
  variant,
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
  const stage = hotelRoomBoardStage(stay, selectedDate);
  const unspecified = hotelStayUnspecifiedState(stay);
  const draggable = !disabled && hotelRoomBoardDropAction(stay) !== null;
  const roomType =
    stay.capacityReservation?.roomTypeCode ??
    stay.capacityReservation?.roomTypeName ??
    "객실 미정";
  const checkInTime = hotelRoomBoardCheckInTime(stay);
  const dogStatus = hotelRoomBoardDogStatus(stay, selectedDate);

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
          ? "border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-950"
          : `px-2 py-1 ${stageClass(stage)}`,
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
          className="-m-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg opacity-45 transition hover:bg-white/70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"
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
            <span className="block truncate text-[15px] font-extrabold leading-5 tracking-[-0.015em] text-slate-950">
              {stay.dogName}
            </span>
            <span className="mt-0.5 block">
              <span
                className={cn(
                  "inline-flex rounded-full px-1.5 py-px text-[9px] font-extrabold leading-[0.875rem] ring-1 ring-inset",
                  stageBadgeClass(stage, variant === "waiting"),
                )}
              >
                {variant === "waiting"
                  ? "미배정"
                  : dogStatus.label}
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold tabular-nums text-slate-800">
              <Clock3 size={12} />
              {variant === "waiting"
                ? formatHotelScheduleTime(stay, "check_in")
                : checkInTime}
            </span>
            <span className="block truncate text-[10px] font-semibold text-slate-500">
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
}: {
  occupancy: SharedHotelOccupancy;
  staysById: ReadonlyMap<string, HotelStay>;
  selectedDate: string;
  onOpen: () => void;
}) {
  const activeMembers = occupancy.members.filter((member) => member.status === "active");
  return (
    <button
      type="button"
      data-testid={`shared-room-card-${occupancy.id}`}
      onClick={onOpen}
      className="w-full rounded-xl border border-violet-300 bg-violet-50 px-2 py-2 text-left text-violet-950 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="flex items-center justify-between gap-1">
        <strong className="truncate text-sm">같은 방 투숙</strong>
        <Badge tone="blue">공유</Badge>
      </span>
      <span className="mt-1 grid gap-1">
        {activeMembers.map((member) => {
          const stay = staysById.get(member.hotelStayId);
          const status = stay
            ? hotelRoomBoardDogStatus(stay, selectedDate)
            : { label: "이용중", stage: "in_house" as const };
          return (
            <span key={member.id} className="flex min-w-0 items-center justify-between gap-1.5">
              <span className="truncate text-xs font-extrabold">{member.dogName}</span>
              <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[9px] font-extrabold leading-[0.875rem] ring-1 ring-inset", stageBadgeClass(status.stage, false))}>
                {status.label}
              </span>
            </span>
          );
        })}
      </span>
      <span className="mt-1 block text-[11px] font-semibold">Shared Room · {activeMembers.length}마리</span>
      <span className="mt-0.5 block text-[10px] text-violet-700">객실 1 · Capacity {occupancy.capacityUsed}</span>
    </button>
  );
}

function RoomCell({
  room,
  stays,
  sharedOccupancy,
  staysById,
  selectedDate,
  draggedStay,
  draggedStayId,
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
  onDragStart,
  onSelectForDrop,
  onPointerDrop,
  onPointerStart,
  onTargetHover,
}: {
  room: HotelRoomSnapshot;
  stays: HotelStay[];
  sharedOccupancy: SharedHotelOccupancy | null;
  staysById: ReadonlyMap<string, HotelStay>;
  selectedDate: string;
  draggedStay: HotelStay | null;
  draggedStayId: string | null;
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
  onDragStart: (event: DragEvent<HTMLDivElement>, stayId: string) => void;
  onSelectForDrop: (stayId: string) => void;
  onPointerDrop: (roomId: string) => void;
  onPointerStart: (stayId: string) => void;
  onTargetHover: (roomId: string | null) => void;
}) {
  const targetState = draggedStay
    ? hotelRoomBoardRoomTarget(draggedStay, room, stays.length > 0 || Boolean(sharedOccupancy))
    : "blocked";
  const acceptsDraggedStay =
    targetState !== "blocked" &&
    (targetState !== "change_type" || allowCrossTypeChange);
  const requiresRoomTypeChange = targetState === "change_type";
  const isHoveredDropTarget = acceptsDraggedStay && hoveredRoomId === room.id;
  const roomStage = stays[0]
    ? hotelRoomBoardStage(stays[0], selectedDate)
    : null;
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
        const stayId =
          event.dataTransfer.getData("application/x-hotel-stay-id") ||
          event.dataTransfer.getData("text/plain") ||
          draggedStayId;
        if (stayId && acceptsDraggedStay) {
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
        "relative min-h-[5.5rem] overflow-visible rounded-xl border p-1.5 transition-[transform,box-shadow,border-color,background-color,opacity] duration-200 ease-out will-change-transform",
        roomStageClass(roomStage),
        acceptsDraggedStay &&
          (requiresRoomTypeChange
            ? "border-dashed border-amber-500/70 bg-amber-50/60"
            : "border-dashed border-primary/55 bg-primary-subtle/20"),
        isHoveredDropTarget &&
          (requiresRoomTypeChange
            ? "z-10 scale-[1.015] border-2 border-solid border-amber-600 bg-amber-50 shadow-[0_14px_30px_rgb(180_83_9_/_0.22)]"
            : "z-10 scale-[1.015] border-2 border-solid border-primary bg-primary-subtle shadow-[0_14px_30px_rgb(39_76_119_/_0.22),inset_0_0_0_1px_rgb(39_76_119_/_0.22)]"),
        Boolean(draggedStay) && !acceptsDraggedStay && "opacity-55",
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
          <span className="group/reason relative flex items-center gap-1 rounded-full bg-emerald-100/70 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-800">
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

      {sharedOccupancy ? (
        <SharedRoomCard
          occupancy={sharedOccupancy}
          staysById={staysById}
          selectedDate={selectedDate}
          onOpen={() => onOpenSharedOccupancy(sharedOccupancy.id)}
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
              onOpen={() => onOpenStay(stay.id)}
              onSelectForDrop={onSelectForDrop}
              onDragStart={onDragStart}
              onPointerStart={onPointerStart}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-8 items-center justify-center px-2 text-center text-[9px] font-medium text-slate-400/60">
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
        {requiresRoomTypeChange ? "유형 변경 후 배정" : "여기에 배정"}
      </div>
    </div>
  );
}

export function HotelRoomBoard({
  snapshot,
  sharedOccupancies = [],
  selectedDate,
  selectedDateIsToday,
  processing,
  processingStayId = null,
  allowCrossTypeChange,
  onOpenStay,
  onOpenSharedOccupancy = () => undefined,
  onDropStay,
  onUnassignStay,
}: {
  snapshot: HotelOperationsSnapshot;
  sharedOccupancies?: readonly SharedHotelOccupancy[];
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
  onUnassignStay: (stayId: string) => void;
}) {
  const [draggedStayId, setDraggedStayId] = useState<string | null>(null);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [settlingRoomId, setSettlingRoomId] = useState<string | null>(null);
  const [settlingStayId, setSettlingStayId] = useState<string | null>(null);
  const [returningStayId, setReturningStayId] = useState<string | null>(null);
  const draggedStayIdRef = useRef<string | null>(null);
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
  const stays = snapshot.stays;
  const staysById = useMemo(
    () => new Map([...snapshot.stays, ...snapshot.unassignedFuture].map((stay) => [stay.id, stay])),
    [snapshot.stays, snapshot.unassignedFuture],
  );
  const sharedMemberStayIds = useMemo(
    () => new Set(sharedOccupancies.flatMap((occupancy) => occupancy.members.map((member) => member.hotelStayId))),
    [sharedOccupancies],
  );
  const boardStays = useMemo(() => {
    const byId = new Map<string, HotelStay>();
    [...stays, ...snapshot.unassignedFuture].forEach((stay) =>
      !sharedMemberStayIds.has(stay.id) && byId.set(stay.id, stay),
    );
    return [...byId.values()];
  }, [sharedMemberStayIds, snapshot.unassignedFuture, stays]);
  const unassigned = useMemo(
    () => hotelRoomBoardUnassigned(boardStays),
    [boardStays],
  );
  const draggedStay =
    boardStays.find((stay) => stay.id === draggedStayId) ?? null;
  const roomStays = useMemo(() => {
    const entries = new Map<string, HotelStay[]>();
    stays.forEach((stay) => {
      if (sharedMemberStayIds.has(stay.id)) return;
      if (!hotelRoomBoardOccupiesRoom(stay)) return;
      const roomId = stayRoomId(stay);
      if (!roomId) return;
      entries.set(roomId, [...(entries.get(roomId) ?? []), stay]);
    });
    return entries;
  }, [sharedMemberStayIds, stays]);
  const sharedByRoom = useMemo(
    () => new Map(sharedOccupancies.filter((occupancy) => occupancy.status === "active").map((occupancy) => [occupancy.roomId, occupancy])),
    [sharedOccupancies],
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
    () => new Set([...roomStays.keys(), ...sharedByRoom.keys()]),
    [roomStays, sharedByRoom],
  );
  const boardSummary = useMemo(() => {
    const phases = boardStays.map((stay) => hotelStayDayPhase(stay, selectedDate));
    return {
      empty: Math.max(activeRooms.length - occupiedRoomIds.size, 0),
      unassigned: unassigned.length,
      checkIn: phases.filter(
        (phase) => phase === "입실" || phase === "입실·퇴실",
      ).length,
      inHouse: phases.filter((phase) => phase === "이용중").length + sharedOccupancies.reduce((count, occupancy) => count + occupancy.members.filter((member) => member.status === "active").length, 0),
      checkOut: phases.filter(
        (phase) => phase === "퇴실" || phase === "입실·퇴실",
      ).length,
    };
  }, [activeRooms.length, boardStays, occupiedRoomIds.size, selectedDate, sharedOccupancies, unassigned.length]);
  useEffect(() => {
    const current = new Map(
      stays.map((stay) => [stay.id, stayRoomId(stay)] as const),
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
  }, [stays]);
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
    setDraggedStayId(stayId);
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
    setDraggedStayId(stayId);
  };
  const beginNativeDrag = (
    event: DragEvent<HTMLDivElement>,
    stayId: string,
  ) => {
    beginPointerDrag(stayId);
    event.dataTransfer.effectAllowed = "move";
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
  const commitPointerDrop = (roomId: string) => {
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
    setDraggedStayId(null);
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
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-primary">
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
              ["미배정", boardSummary.unassigned, "border-amber-200 bg-amber-50 text-amber-900"],
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
                <dd className="text-lg font-black tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-text-muted">
            <span>카드를 눌러 상세 보기</span>
            <span>끌어서 호실 배정·이동</span>
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-5 lg:p-6">
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
              unassigned.length ? "py-3.5" : "py-2.5",
              Boolean(
                draggedStay && canDropHotelStayToUnassigned(draggedStay),
              ) &&
                "border-dashed border-amber-500 bg-amber-50 ring-2 ring-amber-200",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-between gap-2",
                unassigned.length > 0 && "mb-3",
              )}
            >
              <div>
                <h3 className="text-base font-extrabold text-text-primary">
                  호실 미배정
                </h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {unassigned.length
                    ? "입실 대기 · 호실로 드래그하세요"
                    : "현재 미배정 예약이 없습니다."}
                </p>
              </div>
              <Badge tone={unassigned.length ? "amber" : "gray"}>
                {unassigned.length}건
              </Badge>
            </div>
            {unassigned.length ? (
              <div className="flex gap-3 overflow-x-auto overscroll-x-contain pb-1.5">
                {unassigned.map((stay) => {
                  const roomTypeReady = Boolean(
                    stay.capacityReservation?.roomTypeId,
                  );
                  return (
                    <div
                      key={stay.id}
                      className="min-w-[240px] max-w-[280px] flex-[0_0_260px]"
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
                        onOpen={() => onOpenStay(stay.id)}
                        onSelectForDrop={selectForDrop}
                        onDragStart={beginNativeDrag}
                        onPointerStart={beginPointerDrag}
                      />
                      {!roomTypeReady ? (
                        <p className="mt-1 px-1 text-[11px] font-medium text-amber-700">
                          객실 유형을 먼저 확정해 주세요.
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="min-w-0 space-y-6 overflow-x-auto overscroll-x-contain pb-2">
            {(["DELUXE", "STANDARD"] as const).map((roomTypeCode) => {
              const rooms = activeRooms.filter(
                (room) => room.roomTypeCode === roomTypeCode,
              );
              const usedCount = rooms.filter(
                (room) => (roomStays.get(room.id) ?? []).length > 0 || sharedByRoom.has(room.id),
              ).length;
              const remainingCount = Math.max(rooms.length - usedCount, 0);

              return (
                <section
                  key={roomTypeCode}
                  aria-label={`${roomTypeCode} Room Board`}
                >
                  <div className="mb-3 flex items-end justify-between gap-3 border-b border-border pb-2">
                    <div>
                      <h3 className="text-base font-extrabold text-text-primary">
                        {roomTypeCode}
                      </h3>
                      <p className="mt-0.5 text-xs font-semibold text-text-secondary">
                        {usedCount} / {rooms.length} 사용
                      </p>
                    </div>
                    <Badge tone={remainingCount ? "green" : "amber"}>
                      {remainingCount}실 잔여
                    </Badge>
                  </div>
                  <div
                    className={cn(
                      "grid gap-3",
                      roomTypeCode === "DELUXE"
                        ? "min-w-[720px] grid-cols-6"
                        : "min-w-[600px] grid-cols-5",
                    )}
                  >
                    {rooms.map((room) => (
                      <RoomCell
                        key={room.id}
                        room={room}
                        stays={roomStays.get(room.id) ?? []}
                        sharedOccupancy={sharedByRoom.get(room.id) ?? null}
                        staysById={staysById}
                        selectedDate={selectedDate}
                        draggedStay={draggedStay}
                        draggedStayId={draggedStayId}
                        returningStayId={returningStayId}
                        settlingStayId={settlingStayId}
                        hoveredRoomId={hoveredRoomId}
                        recommended={recommendedRoomId === room.id}
                        settling={settlingRoomId === room.id}
                        processing={
                          processing ||
                          (processingStayId !== null &&
                            processingStayId === draggedStayId)
                        }
                        allowCrossTypeChange={allowCrossTypeChange}
                        onOpenStay={onOpenStay}
                        onOpenSharedOccupancy={onOpenSharedOccupancy}
                        onDropStay={commitDrop}
                        onDragStart={beginNativeDrag}
                        onSelectForDrop={selectForDrop}
                        onPointerDrop={commitPointerDrop}
                        onPointerStart={beginPointerDrag}
                        onTargetHover={setHoveredRoomId}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
