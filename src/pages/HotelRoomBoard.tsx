import { Clock3, GripVertical } from "lucide-react";
import { type DragEvent, useMemo, useRef, useState } from "react";
import { Badge, Card, cn } from "../components/ui";
import type {
  HotelOperationsSnapshot,
  HotelRoomSnapshot,
  HotelStay,
} from "./hotelOperationsRepository";
import {
  activeHotelAllocation,
  formatHotelScheduleTime,
  hotelStayDayPhase,
  hotelStayScheduleEvent,
  hotelStayUnspecifiedState,
  seoulInputParts,
} from "./hotelOperationsUi";

type RoomBoardStage = "check_in" | "in_house" | "check_out";

export type HotelRoomBoardDropAction = "assign" | "reassign" | "move";

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

export function hotelRoomBoardCheckInTime(stay: HotelStay) {
  const schedule = hotelStayScheduleEvent(stay, "check_in");
  if (!schedule) return "입실 시간 없음";
  if (schedule.timeUnspecified) return "시간 미정";
  return seoulInputParts(schedule.startsAt).time;
}

function stageLabel(stay: HotelStay, selectedDate: string) {
  return hotelStayDayPhase(stay, selectedDate) ?? "예약";
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
  variant: "waiting" | "room";
  onOpen: () => void;
  onSelectForDrop: (stayId: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, stayId: string) => void;
  onPointerStart: (stayId: string) => void;
}) {
  const stage = hotelRoomBoardStage(stay, selectedDate);
  const unspecified = hotelStayUnspecifiedState(stay);
  const draggable = !disabled && hotelRoomBoardDropAction(stay) !== null;
  const roomType =
    stay.capacityReservation?.roomTypeCode ??
    stay.capacityReservation?.roomTypeName ??
    "객실 미정";
  const checkInTime = hotelRoomBoardCheckInTime(stay);

  return (
    <div
      draggable={draggable}
      onDragStart={(event) => {
        if (draggable) onDragStart(event, stay.id);
      }}
      onPointerDown={() => {
        if (draggable) onPointerStart(stay.id);
      }}
      data-testid={`hotel-room-board-stay-${stay.id}`}
      className={cn(
        "hotel-room-card-enter group select-none rounded-2xl border shadow-sm transition-[transform,box-shadow,opacity] duration-150 ease-out",
        variant === "waiting" ? "px-4 py-3.5" : "px-3 py-3",
        stageClass(stage),
        draggable &&
          "cursor-grab hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing",
        dragging &&
          "z-10 scale-[1.02] cursor-grabbing opacity-55 shadow-[0_18px_36px_rgb(15_23_42_/_0.24)] ring-2 ring-white/80",
        disabled && "opacity-60",
      )}
    >
      <div className="flex min-h-14 w-full items-start gap-2.5">
        <button
          type="button"
          aria-label={`${stay.dogName} 호실 이동 시작`}
          disabled={!draggable}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (draggable) onSelectForDrop(stay.id);
          }}
          className="-m-1 flex h-8 w-7 shrink-0 items-center justify-center rounded-lg opacity-50 transition hover:bg-white/70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"
        >
          <GripVertical size={17} />
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-extrabold tracking-[-0.01em] text-slate-950">
            {stay.dogName}
          </span>
          {variant === "waiting" ? (
            <>
              <span className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold opacity-80">
                <Clock3 size={13} />
                {formatHotelScheduleTime(stay, "check_in")}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone={unspecified.roomType ? "amber" : "gray"}>
                  {roomType}
                </Badge>
                <Badge tone="gray">{stageLabel(stay, selectedDate)}</Badge>
              </span>
            </>
          ) : (
            <>
              <span className="mt-1.5 block text-sm font-extrabold tabular-nums text-slate-900">
                {checkInTime}
              </span>
              {stay.customerName ? (
                <span className="mt-1.5 block truncate text-xs font-medium text-slate-600">
                  {stay.customerName}
                </span>
              ) : null}
              <span className="mt-2 block">
                <Badge tone="gray">{stageLabel(stay, selectedDate)}</Badge>
              </span>
            </>
          )}
        </span>
        </button>
      </div>
    </div>
  );
}

function RoomCell({
  room,
  stays,
  selectedDate,
  draggedStay,
  draggedStayId,
  hoveredRoomId,
  processing,
  onOpenStay,
  onDropStay,
  onDragStart,
  onSelectForDrop,
  onPointerDrop,
  onPointerStart,
  onTargetHover,
}: {
  room: HotelRoomSnapshot;
  stays: HotelStay[];
  selectedDate: string;
  draggedStay: HotelStay | null;
  draggedStayId: string | null;
  hoveredRoomId: string | null;
  processing: boolean;
  onOpenStay: (stayId: string) => void;
  onDropStay: (stayId: string, roomId: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, stayId: string) => void;
  onSelectForDrop: (stayId: string) => void;
  onPointerDrop: (roomId: string) => void;
  onPointerStart: (stayId: string) => void;
  onTargetHover: (roomId: string | null) => void;
}) {
  const acceptsDraggedStay = Boolean(
    draggedStay?.capacityReservation?.roomTypeId === room.roomTypeId &&
      stayRoomId(draggedStay) !== room.id,
  );
  const isHoveredDropTarget = acceptsDraggedStay && hoveredRoomId === room.id;
  const roomStage = stays[0]
    ? hotelRoomBoardStage(stays[0], selectedDate)
    : null;
  return (
    <div
      data-testid={`hotel-room-board-room-${room.id}`}
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
        if (stayId && acceptsDraggedStay) onDropStay(stayId, room.id);
      }}
      onPointerEnter={() => {
        if (acceptsDraggedStay) onTargetHover(room.id);
      }}
      onPointerLeave={() => {
        if (hoveredRoomId === room.id) onTargetHover(null);
      }}
      onPointerUp={() => onPointerDrop(room.id)}
      className={cn(
        "relative min-h-40 overflow-hidden rounded-2xl border p-3 transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out",
        roomStageClass(roomStage),
        acceptsDraggedStay &&
          "border-dashed border-primary/55 bg-primary-subtle/20",
        isHoveredDropTarget &&
          "z-10 scale-[1.015] border-2 border-solid border-primary bg-primary-subtle shadow-[0_14px_30px_rgb(39_76_119_/_0.22),inset_0_0_0_1px_rgb(39_76_119_/_0.22)]",
      )}
    >
      <div className="mb-3 min-w-0">
        <b className="whitespace-nowrap text-sm font-extrabold text-text-primary">
          {room.name}
        </b>
      </div>

      {stays.length ? (
        <div className="space-y-2">
          {stays.map((stay) => (
            <DraggableStayCard
              key={stay.id}
              stay={stay}
              selectedDate={selectedDate}
              disabled={processing}
              dragging={draggedStayId === stay.id}
              variant="room"
              onOpen={() => onOpenStay(stay.id)}
              onSelectForDrop={onSelectForDrop}
              onDragStart={onDragStart}
              onPointerStart={onPointerStart}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-20 items-center justify-center px-3 text-center text-[11px] font-medium text-slate-500/80">
          비어 있음
        </div>
      )}

      <div
        aria-hidden={!isHoveredDropTarget}
        className={cn(
          "pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-white/95 text-sm font-extrabold text-primary shadow-lg transition-[opacity,transform] duration-150 ease-out",
          isHoveredDropTarget
            ? "scale-100 opacity-100"
            : "scale-95 opacity-0",
        )}
      >
        여기에 배정
      </div>
    </div>
  );
}

export function HotelRoomBoard({
  snapshot,
  selectedDate,
  processing,
  onOpenStay,
  onDropStay,
}: {
  snapshot: HotelOperationsSnapshot;
  selectedDate: string;
  processing: boolean;
  onOpenStay: (stayId: string) => void;
  onDropStay: (stayId: string, roomId: string) => void;
}) {
  const [draggedStayId, setDraggedStayId] = useState<string | null>(null);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const draggedStayIdRef = useRef<string | null>(null);
  const dragModeRef = useRef<"pointer" | "selected" | null>(null);
  const dropCommittedRef = useRef(false);
  const stays = snapshot.stays;
  const boardStays = useMemo(() => {
    const byId = new Map<string, HotelStay>();
    [...stays, ...snapshot.unassignedFuture].forEach((stay) =>
      byId.set(stay.id, stay),
    );
    return [...byId.values()];
  }, [snapshot.unassignedFuture, stays]);
  const unassigned = useMemo(
    () => hotelRoomBoardUnassigned(boardStays),
    [boardStays],
  );
  const draggedStay =
    boardStays.find((stay) => stay.id === draggedStayId) ?? null;
  const roomStays = useMemo(() => {
    const entries = new Map<string, HotelStay[]>();
    stays.forEach((stay) => {
      const roomId = stayRoomId(stay);
      if (!roomId) return;
      entries.set(roomId, [...(entries.get(roomId) ?? []), stay]);
    });
    return entries;
  }, [stays]);
  const activeRooms = snapshot.rooms
    .filter((room) => room.isActive)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
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
  };
  const commitDrop = (stayId: string, roomId: string) => {
    if (dropCommittedRef.current) return;
    dropCommittedRef.current = true;
    onDropStay(stayId, roomId);
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
      stay.capacityReservation?.roomTypeId !== room.roomTypeId ||
      stayRoomId(stay) === room.id
    ) {
      return;
    }
    commitDrop(stayId, roomId);
  };
  const endDrag = () => {
    if (dragModeRef.current === "selected" && !dropCommittedRef.current) return;
    dragModeRef.current = null;
    draggedStayIdRef.current = null;
    setDraggedStayId(null);
    setHoveredRoomId(null);
  };

  return (
    <Card
      className="mb-6 hidden overflow-hidden md:block"
      data-testid="hotel-room-board"
    >
      <div
        onDragEnd={endDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-text-primary">
                Room Board
              </h2>
              <p className="mt-0.5 text-xs text-text-secondary">
                입실 대기 예약을 호실에 끌어 배정하고, 배정된 카드를 바로 이동합니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-medium">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-text-muted">
                빈방
              </span>
              <span className="rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-blue-900">
                오늘 입실
              </span>
              <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-emerald-900">
                이용중
              </span>
              <span className="rounded-full border border-orange-300 bg-orange-50 px-2.5 py-1 text-orange-950">
                오늘 퇴실
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-5 sm:p-6">
          <div
            className={cn(
              "min-w-0 rounded-2xl border border-amber-200/80 bg-[#fbfaf7] px-4 shadow-[inset_3px_0_0_0_rgb(245_158_11_/_0.5)]",
              unassigned.length ? "py-3.5" : "py-2.5",
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
                        disabled={processing || !roomTypeReady}
                        dragging={draggedStayId === stay.id}
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
                (room) => (roomStays.get(room.id) ?? []).length > 0,
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
                        selectedDate={selectedDate}
                        draggedStay={draggedStay}
                        draggedStayId={draggedStayId}
                        hoveredRoomId={hoveredRoomId}
                        processing={processing}
                        onOpenStay={onOpenStay}
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
