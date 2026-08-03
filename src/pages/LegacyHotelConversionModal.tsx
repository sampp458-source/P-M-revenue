import { useEffect, useMemo, useState } from "react";
import { SearchSelect } from "../components/SearchSelect";
import {
  Badge,
  Button,
  Field,
  LoadingState,
  Modal,
  Select,
  Textarea,
} from "../components/ui";
import {
  convertLegacyHotelSchedulesToReservation,
  type HotelOperationsSnapshot,
  type HotelStay,
} from "./hotelOperationsRepository";
import {
  fetchLegacyHotelScheduleCandidates,
  operationPersonDisplayName,
  sortLegacyHotelCounterparts,
  type HotelScheduleEventKind,
  type OperationSchedule,
  type OperationScheduleOptions,
} from "./operationsScheduleRepository";

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));

const scheduleSearchText = (schedule: OperationSchedule) =>
  [
    schedule.title,
    ...schedule.dogs.map((row) => row.name),
    ...schedule.customers.map((row) => row.name ?? ""),
    dateTime(schedule.startsAt),
  ].join(" ");

function ScheduleOption({
  schedule,
  recommended,
}: {
  schedule: OperationSchedule;
  recommended: boolean;
}) {
  return (
    <div className="min-w-0 py-0.5">
      <div className="flex items-center gap-2">
        <span className="truncate font-semibold text-text-primary">
          {schedule.title}
        </span>
        {recommended ? <Badge tone="blue">추천</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-text-secondary">
        {dateTime(schedule.startsAt)} · {schedule.dogs[0]?.name ?? "반려견 미연결"}
      </p>
    </div>
  );
}

export function LegacyHotelConversionModal({
  open,
  anchor,
  options,
  snapshot,
  onClose,
  onConverted,
}: {
  open: boolean;
  anchor: OperationSchedule | null;
  options: OperationScheduleOptions | null;
  snapshot: HotelOperationsSnapshot | null;
  onClose: () => void;
  onConverted: (stay: HotelStay) => Promise<void> | void;
}) {
  const [anchorKind, setAnchorKind] = useState<HotelScheduleEventKind | null>(null);
  const [candidates, setCandidates] = useState<OperationSchedule[]>([]);
  const [counterpartId, setCounterpartId] = useState("");
  const [dogId, setDogId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");

  useEffect(() => {
    if (!open || !anchor || !options) return;
    let cancelled = false;
    setAnchorKind(null);
    setCounterpartId("");
    setDogId(anchor.dogs.length === 1 ? anchor.dogs[0].id : "");
    setCustomerId(anchor.customers.length === 1 ? anchor.customers[0].id : "");
    setRoomTypeId(snapshot?.roomTypes.find((row) => row.activeRooms > 0)?.id ?? "");
    setAssigneeIds(anchor.assignees.map((row) => row.id));
    setNotes(anchor.memo ?? "");
    setRequestId(crypto.randomUUID());
    setError("");
    setLoading(true);
    void fetchLegacyHotelScheduleCandidates(anchor, options)
      .then((rows) => {
        if (!cancelled) setCandidates(rows);
      })
      .catch((reason) => {
        if (!cancelled) {
          setCandidates([]);
          setError(reason instanceof Error ? reason.message : "후보 일정을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [anchor, open, options, snapshot]);

  const counterparts = useMemo(
    () => anchor && anchorKind
      ? sortLegacyHotelCounterparts(anchor, candidates, anchorKind)
      : [],
    [anchor, anchorKind, candidates],
  );
  const counterpart = counterparts.find((row) => row.id === counterpartId) ?? null;
  const selectedDog = options?.dogs.find((row) => row.id === dogId) ?? null;
  const linkedCustomerId = selectedDog?.customerId ?? null;
  const checkIn = anchorKind === "check_in" ? anchor : counterpart;
  const checkOut = anchorKind === "check_out" ? anchor : counterpart;

  const chooseDog = (ids: string[]) => {
    const nextDogId = ids[0] ?? "";
    const dog = options?.dogs.find((row) => row.id === nextDogId);
    setDogId(nextDogId);
    setCustomerId(dog?.customerId ?? "");
  };

  const submit = async () => {
    if (!anchor || !options || !checkIn || !checkOut) {
      setError("입실과 퇴실 일정을 직접 확인해 선택해 주세요.");
      return;
    }
    if (!dogId || !selectedDog) {
      setError("반려견을 선택해 주세요.");
      return;
    }
    if (!linkedCustomerId) {
      setError("보호자가 연결되지 않은 반려견입니다. 고객·반려견 관리에서 먼저 연결해 주세요.");
      return;
    }
    if (!customerId || customerId !== linkedCustomerId) {
      setError("반려견의 활성 연결 보호자를 선택해 주세요.");
      return;
    }
    if (!roomTypeId || assigneeIds.length === 0) {
      setError("객실 유형과 담당자 1명 이상이 필요합니다.");
      return;
    }
    if (new Date(checkIn.startsAt) >= new Date(checkOut.startsAt)) {
      setError("입실 시각은 퇴실 시각보다 빨라야 합니다.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const stay = await convertLegacyHotelSchedulesToReservation({
        checkInScheduleId: checkIn.id,
        checkOutScheduleId: checkOut.id,
        dogId,
        customerId,
        roomTypeId,
        assigneeIds,
        notes,
      }, requestId);
      await onConverted(stay);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "호텔 예약으로 전환하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="호텔 예약으로 전환" onClose={() => !saving && onClose()} wide resetKey={anchor?.id}>
      {!anchor || !options ? <LoadingState /> : (
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-surface-secondary p-4">
            <div className="flex items-center gap-2"><Badge tone="gray">기존 수동 일정</Badge><b>{anchor.title}</b></div>
            <p className="mt-2 text-sm text-text-secondary">{dateTime(anchor.startsAt)} · {anchor.dogs[0]?.name ?? "반려견 미연결"}</p>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-text-primary">현재 일정의 역할 *</legend>
            <p className="mt-1 text-xs text-text-muted">제목으로 자동 확정하지 않습니다. 직접 확인해 주세요.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button type="button" variant={anchorKind === "check_in" ? "primary" : "secondary"} onClick={() => { setAnchorKind("check_in"); setCounterpartId(""); }}>입실 일정</Button>
              <Button type="button" variant={anchorKind === "check_out" ? "primary" : "secondary"} onClick={() => { setAnchorKind("check_out"); setCounterpartId(""); }}>퇴실 일정</Button>
            </div>
          </fieldset>

          {loading ? <LoadingState /> : anchorKind ? (
            <SearchSelect
              label={anchorKind === "check_in" ? "퇴실 일정" : "입실 일정"}
              items={counterparts}
              selectedIds={counterpartId ? [counterpartId] : []}
              onChange={(ids) => setCounterpartId(ids[0] ?? "")}
              getItemId={(row) => row.id}
              getSearchText={scheduleSearchText}
              renderOption={(row) => <ScheduleOption schedule={row} recommended={row.id === counterparts[0]?.id} />}
              renderSelected={(row) => `${row.title} · ${dateTime(row.startsAt)}`}
              multiple={false}
              showAllOnEmpty
              maxResults={20}
              placeholder="일정 제목, 반려견, 보호자 검색"
              noResultsMessage="조건에 맞는 반대 일정이 없습니다."
              required
            />
          ) : null}

          <SearchSelect
            label="반려견"
            items={options.dogs}
            selectedIds={dogId ? [dogId] : []}
            onChange={chooseDog}
            getItemId={(row) => row.id}
            getSearchText={(row) => row.name}
            renderOption={(row) => <span className="font-semibold">🐶 {row.name}</span>}
            renderSelected={(row) => `🐶 ${row.name}`}
            multiple={false}
            showAllOnEmpty
            required
          />
          <SearchSelect
            label="보호자"
            items={options.customers}
            selectedIds={customerId ? [customerId] : []}
            onChange={(ids) => setCustomerId(ids[0] ?? "")}
            getItemId={(row) => row.id}
            getSearchText={(row) => `${row.name ?? ""} ${row.phone ?? ""}`}
            renderOption={(row) => <div><b>{row.name ?? "이름 미등록"}</b><p className="text-xs text-text-muted">{row.phone ?? "연락처 미등록"}</p></div>}
            multiple={false}
            showAllOnEmpty
            required
          />
          <Field label="객실 유형" required>
            <Select value={roomTypeId} onChange={(event) => setRoomTypeId(event.target.value)}>
              <option value="">선택</option>
              {(snapshot?.roomTypes ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </Select>
          </Field>
          <SearchSelect
            label="담당자"
            items={options.assignees}
            selectedIds={assigneeIds}
            onChange={setAssigneeIds}
            getItemId={(row) => row.id}
            getSearchText={(row) => operationPersonDisplayName(row)}
            renderOption={(row) => <span className="font-semibold">{operationPersonDisplayName(row)}</span>}
            showAllOnEmpty
            required
          />
          <Field label="메모"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></Field>
          {error ? <p role="alert" className="text-sm font-semibold text-error">{error}</p> : null}
          <div className="sticky -bottom-5 -mx-5 -mb-5 flex justify-end gap-2 border-t border-border bg-surface px-5 py-3">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>닫기</Button>
            <Button type="button" disabled={saving || !anchorKind || !counterpartId} onClick={() => void submit()}>{saving ? "전환 중..." : "호텔 예약으로 전환"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
