import {
  ArrowLeft,
  BedDouble,
  Check,
  ChevronDown,
  ChevronUp,
  Dog,
  GraduationCap,
  School,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Field, Input, Select, Textarea } from "../components/ui";
import {
  defaultFamilyBookingDates,
  type FamilyBookingDogDraft,
  type FamilyBookingDraft,
  type FamilyBookingRoomType,
  type FamilyBookingServiceType,
} from "./customerDogArchitecture";
import type { FamilyBookingRecord } from "../platform/familyBookingRepositoryContract";

type SelectableDog = { id: string; name: string; breed: string | null };

const serviceOptions = [
  { value: "hotel", label: "호텔", icon: BedDouble },
  { value: "training", label: "교육", icon: GraduationCap },
  { value: "daycare", label: "유치원", icon: School },
] as const;

const serviceLabel = (service: FamilyBookingServiceType) =>
  serviceOptions.find((option) => option.value === service)?.label ?? service;

const roomTypeLabel = (roomType: FamilyBookingRoomType | null) => {
  if (roomType === "standard") return "STANDARD";
  if (roomType === "deluxe") return "DELUXE";
  return "객실 미정";
};

const newDogDraft = (
  dog: SelectableDog,
  defaults: {
    serviceType: FamilyBookingServiceType;
    startsOn: string;
    endsOn: string;
    assigneeDisplayName: string;
    roomType: FamilyBookingRoomType;
    memo: string;
  },
): FamilyBookingDogDraft => ({
  dogId: dog.id,
  dogName: dog.name,
  serviceType: defaults.serviceType,
  startsOn: defaults.startsOn,
  endsOn: defaults.endsOn,
  checkInTime: "15:00",
  checkOutTime: "11:00",
  checkInTimeUnspecified: false,
  checkOutTimeUnspecified: false,
  roomType: defaults.serviceType === "hotel" ? defaults.roomType : null,
  assigneeIds: [],
  assigneeDisplayName: defaults.assigneeDisplayName,
  memo: defaults.memo || undefined,
  sharedRoomGroupKey: null,
});

export function CustomerFamilyBookingForm({
  customerId,
  customerName,
  dogs,
  initialBooking,
  onCancel,
  onComplete,
  submitting = false,
  submissionError = "",
}: {
  customerId: string;
  customerName: string;
  dogs: SelectableDog[];
  initialBooking?: FamilyBookingDraft | null;
  onCancel: () => void;
  onComplete: (booking: FamilyBookingDraft) => void | Promise<void>;
  submitting?: boolean;
  submissionError?: string;
}) {
  const defaultDates = useMemo(() => defaultFamilyBookingDates(), []);
  const [drafts, setDrafts] = useState<FamilyBookingDogDraft[]>(
    () => initialBooking?.dogs.map((draft) => ({ ...draft })) ?? [],
  );
  const [collapsedDogIds, setCollapsedDogIds] = useState<string[]>([]);
  const [commonService, setCommonService] = useState<FamilyBookingServiceType>(
    initialBooking?.dogs[0]?.serviceType ?? "hotel",
  );
  const [commonStartsOn, setCommonStartsOn] = useState(
    initialBooking?.dogs[0]?.startsOn ?? defaultDates.start,
  );
  const [commonEndsOn, setCommonEndsOn] = useState(
    initialBooking?.dogs[0]?.endsOn ?? defaultDates.end,
  );
  const [commonAssignee, setCommonAssignee] = useState(
    initialBooking?.defaultAssigneeDisplayName ?? "",
  );
  const [commonRoomType, setCommonRoomType] = useState<FamilyBookingRoomType>(
    initialBooking?.dogs.find((draft) => draft.serviceType === "hotel")?.roomType ?? "unspecified",
  );
  const [commonRequest, setCommonRequest] = useState(initialBooking?.commonRequest ?? "");
  const [commonMemo, setCommonMemo] = useState(initialBooking?.commonMemo ?? "");
  const [combinePayment, setCombinePayment] = useState(initialBooking?.combinePayment ?? true);
  const [sharedDeluxeRoom, setSharedDeluxeRoom] = useState(
    () => Boolean(initialBooking?.dogs.some((draft) => draft.sharedRoomGroupKey)),
  );
  const [requestId, setRequestId] = useState<string | undefined>(
    initialBooking?.requestId,
  );
  const [error, setError] = useState("");

  const commonDefaults = {
    serviceType: commonService,
    startsOn: commonStartsOn,
    endsOn: commonEndsOn,
    assigneeDisplayName: commonAssignee,
    roomType: commonRoomType,
    memo: commonMemo,
  };

  const toggleDog = (dog: SelectableDog) => {
    setDrafts((current) =>
      current.some((draft) => draft.dogId === dog.id)
        ? current.filter((draft) => draft.dogId !== dog.id)
        : [...current, newDogDraft(dog, commonDefaults)],
    );
    setCollapsedDogIds((current) => current.filter((id) => id !== dog.id));
    setSharedDeluxeRoom(false);
    setError("");
  };

  const updateDog = (dogId: string, change: Partial<FamilyBookingDogDraft>) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.dogId === dogId
          ? { ...draft, ...change, sharedRoomGroupKey: null }
          : draft,
      ),
    );
    setSharedDeluxeRoom(false);
    setError("");
  };

  const applyToAll = (
    field: "service" | "period" | "assignee" | "room" | "memo",
  ) => {
    setDrafts((current) =>
      current.map((draft) => {
        if (field === "service") {
          return {
            ...draft,
            serviceType: commonService,
            roomType: commonService === "hotel" ? commonRoomType : null,
            sharedRoomGroupKey: null,
          };
        }
        if (field === "period") return { ...draft, startsOn: commonStartsOn, endsOn: commonEndsOn };
        if (field === "assignee") return { ...draft, assigneeDisplayName: commonAssignee };
        if (field === "room") return draft.serviceType === "hotel" ? { ...draft, roomType: commonRoomType, sharedRoomGroupKey: null } : draft;
        return { ...draft, memo: commonMemo || undefined };
      }),
    );
    if (field === "service" || field === "room") setSharedDeluxeRoom(false);
  };

  const deluxeHotelDogs = drafts.filter(
    (draft) => draft.serviceType === "hotel" && draft.roomType === "deluxe",
  );
  const canShareDeluxe = deluxeHotelDogs.length >= 2;

  const toggleSharedDeluxe = (checked: boolean) => {
    setSharedDeluxeRoom(checked);
    const groupKey = checked ? `shared-deluxe-${customerId}` : null;
    const eligibleIds = new Set(deluxeHotelDogs.map((draft) => draft.dogId));
    setDrafts((current) =>
      current.map((draft) =>
        eligibleIds.has(draft.dogId)
          ? { ...draft, sharedRoomGroupKey: groupKey }
          : draft,
      ),
    );
  };

  const complete = () => {
    if (!drafts.length) {
      setError("예약에 포함할 반려견을 한 마리 이상 선택해 주세요.");
      return;
    }
    const invalidPeriod = drafts.find(
      (draft) => !draft.startsOn || !draft.endsOn || draft.endsOn < draft.startsOn,
    );
    if (invalidPeriod) {
      setError(`${invalidPeriod.dogName}의 예약 기간을 확인해 주세요.`);
      return;
    }
    const activeRequestId = requestId ?? crypto.randomUUID();
    if (!requestId) setRequestId(activeRequestId);
    void onComplete({
      id: `family-booking-${Date.now()}`,
      customerId,
      commonRequest: commonRequest.trim() || undefined,
      commonMemo: commonMemo.trim() || undefined,
      combinePayment,
      multiDogDiscountPlanned: drafts.length >= 2,
      defaultAssigneeDisplayName: commonAssignee.trim(),
      dogs: drafts,
      status: "mock",
      requestId: activeRequestId,
    });
  };

  return (
    <div className="space-y-5 pb-24 sm:pb-20">
      <div className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={17} className="text-primary" />
            <strong className="text-text-primary">{customerName} 가족 예약</strong>
          </div>
          <p className="mt-1 text-sm leading-5 text-text-secondary">
            각 반려견 예약을 한 화면에서 독립적으로 설정하고 한 번에 생성합니다.
          </p>
        </div>
        {import.meta.env.DEV ? <Badge tone="blue">QA 연결</Badge> : null}
      </div>

      <section aria-labelledby="family-booking-dogs" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div><h3 id="family-booking-dogs" className="font-bold text-text-primary">반려견 선택</h3><p className="mt-1 text-sm text-text-secondary">예약할 반려견을 선택하면 개별 예약 카드가 생성됩니다.</p></div>
          <Badge tone={drafts.length ? "blue" : "gray"}>{drafts.length}마리 선택</Badge>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {dogs.map((dog) => {
            const selected = drafts.some((draft) => draft.dogId === dog.id);
            return (
              <button key={dog.id} type="button" aria-pressed={selected} onClick={() => toggleDog(dog)} className={`flex min-w-44 items-center gap-3 rounded-2xl border p-3 text-left transition-all duration-200 ${selected ? "border-primary/40 bg-primary-soft shadow-sm ring-1 ring-primary/10" : "border-border bg-surface hover:border-primary/25"}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selected ? "bg-primary text-white" : "bg-surface-secondary text-text-muted"}`}>{selected ? <Check size={18} /> : <Dog size={18} />}</span>
                <span className="min-w-0"><strong className="block truncate text-sm text-text-primary">{dog.name}</strong><span className="mt-1 block truncate text-xs text-text-muted">{dog.breed || "견종 미등록"}</span></span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="family-booking-common" className="space-y-4 rounded-2xl border border-border bg-surface-secondary/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3 id="family-booking-common" className="font-bold text-text-primary">가족 공통 정보</h3><p className="mt-1 text-sm text-text-secondary">공통값은 초기값이며, 아래 버튼으로 현재 Dog 카드에 복사할 수 있습니다.</p></div>
          {drafts.length >= 2 ? <Badge tone="amber">다견 할인 예정</Badge> : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="전체 서비스 기본값"><Select value={commonService} onChange={(event) => setCommonService(event.target.value as FamilyBookingServiceType)}><option value="hotel">호텔</option><option value="training">교육</option><option value="daycare">유치원</option></Select><ApplyButton disabled={!drafts.length} onClick={() => applyToAll("service")}>전체 서비스 적용</ApplyButton></Field>
          <Field label="전체 시작일"><Input type="date" value={commonStartsOn} onChange={(event) => setCommonStartsOn(event.target.value)} /></Field>
          <Field label="전체 종료일"><Input type="date" min={commonStartsOn} value={commonEndsOn} onChange={(event) => setCommonEndsOn(event.target.value)} /><ApplyButton disabled={!drafts.length} onClick={() => applyToAll("period")}>전체 기간 적용</ApplyButton></Field>
          <Field label="공통 담당자 기본값"><Input value={commonAssignee} onChange={(event) => setCommonAssignee(event.target.value)} placeholder="담당자 이름 입력" /><ApplyButton disabled={!drafts.length} onClick={() => applyToAll("assignee")}>전체 담당자 적용</ApplyButton></Field>
          <Field label="전체 객실 유형 기본값"><Select value={commonRoomType} onChange={(event) => setCommonRoomType(event.target.value as FamilyBookingRoomType)}><option value="unspecified">객실 미정</option><option value="standard">STANDARD</option><option value="deluxe">DELUXE</option></Select><ApplyButton disabled={!drafts.length} onClick={() => applyToAll("room")}>호텔 Dog에 적용</ApplyButton></Field>
          <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-text-primary"><input type="checkbox" checked={combinePayment} onChange={(event) => setCombinePayment(event.target.checked)} className="h-4 w-4 accent-primary" />결제를 가족 단위로 묶기</label>
          <div className="sm:col-span-2 lg:col-span-3"><Field label="공통 요청사항"><Textarea value={commonRequest} onChange={(event) => setCommonRequest(event.target.value)} className="min-h-20" placeholder="보호자가 전달한 가족 공통 요청사항" /></Field></div>
          <div className="sm:col-span-2 lg:col-span-3"><Field label="공통 메모"><Textarea value={commonMemo} onChange={(event) => setCommonMemo(event.target.value)} className="min-h-20" placeholder="내부 공유용 공통 메모" /><ApplyButton disabled={!drafts.length} onClick={() => applyToAll("memo")}>전체 메모 적용</ApplyButton></Field></div>
        </div>
      </section>

      <section aria-labelledby="family-booking-members" className="space-y-3">
        <div><h3 id="family-booking-members" className="font-bold text-text-primary">Dog별 예약</h3><p className="mt-1 text-sm text-text-secondary">복사한 공통값을 각 반려견별로 자유롭게 수정하세요.</p></div>
        {drafts.length ? drafts.map((draft, index) => (
          <DogBookingCard
            key={draft.dogId}
            draft={draft}
            number={index + 1}
            collapsed={collapsedDogIds.includes(draft.dogId)}
            onToggle={() => setCollapsedDogIds((current) => current.includes(draft.dogId) ? current.filter((id) => id !== draft.dogId) : [...current, draft.dogId])}
            onChange={(change) => updateDog(draft.dogId, change)}
          />
        )) : <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-text-muted">반려견을 선택하면 개별 예약 카드가 표시됩니다.</div>}
      </section>

      {canShareDeluxe ? (
        <section className="rounded-2xl border border-primary/20 bg-primary-subtle p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={sharedDeluxeRoom} onChange={(event) => toggleSharedDeluxe(event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
            <span><strong className="block text-sm text-text-primary">{deluxeHotelDogs.map((draft) => draft.dogName).join(" · ")} 같은 DELUXE 방 사용</strong><span className="mt-1 block text-xs leading-5 text-text-secondary">실제 호실은 선택하지 않으며 같은 방 사용 예정 그룹만 미리보기에 표시합니다.</span></span>
          </label>
        </section>
      ) : null}

      {error || submissionError ? <p role="alert" className="rounded-xl bg-error-soft px-3 py-2 text-sm font-medium text-error">{error || submissionError}</p> : null}

      <div className="sticky bottom-0 -mx-1 flex flex-col-reverse gap-2 border-t border-border bg-surface/95 px-1 pb-1 pt-4 backdrop-blur sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}><ArrowLeft size={16} />보호자 프로필</Button>
        <Button type="button" onClick={complete} disabled={submitting}><Check size={16} />{submitting ? "예약 생성 중…" : "예약 생성"}</Button>
      </div>
    </div>
  );
}

function ApplyButton({ children, disabled, onClick }: { children: string; disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="mt-2 text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline">{children}</button>;
}

function DogBookingCard({ draft, number, collapsed, onToggle, onChange }: { draft: FamilyBookingDogDraft; number: number; collapsed: boolean; onToggle: () => void; onChange: (change: Partial<FamilyBookingDogDraft>) => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary-subtle">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-sm font-bold text-primary">{number}</span>
        <span className="min-w-0 flex-1"><strong className="block truncate text-base text-text-primary">{draft.dogName}</strong><span className="mt-0.5 block text-xs text-text-muted">{serviceLabel(draft.serviceType)} · {draft.startsOn} ~ {draft.endsOn}</span></span>
        <Badge tone="blue">{serviceLabel(draft.serviceType)}</Badge>
        {collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
      </button>
      {!collapsed ? (
        <div className="space-y-4 border-t border-border p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {serviceOptions.map((option) => { const Icon = option.icon; const selected = draft.serviceType === option.value; return <button key={option.value} type="button" aria-pressed={selected} onClick={() => onChange({ serviceType: option.value, roomType: option.value === "hotel" ? draft.roomType ?? "unspecified" : null })} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold ${selected ? "border-primary/40 bg-primary-soft text-primary" : "border-border text-text-secondary hover:border-primary/25"}`}><Icon size={16} />{option.label}</button>; })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={draft.serviceType === "hotel" ? "입실일" : "시작일"} required><Input type="date" value={draft.startsOn} onChange={(event) => onChange({ startsOn: event.target.value })} /></Field>
            <Field label={draft.serviceType === "hotel" ? "퇴실일" : "종료일"} required><Input type="date" min={draft.startsOn} value={draft.endsOn} onChange={(event) => onChange({ endsOn: event.target.value })} /></Field>
            {draft.serviceType === "hotel" ? <>
              <TimeField label="입실시간" value={draft.checkInTime} unspecified={draft.checkInTimeUnspecified} onTime={(value) => onChange({ checkInTime: value })} onUnspecified={(value) => onChange({ checkInTimeUnspecified: value })} />
              <TimeField label="퇴실시간" value={draft.checkOutTime} unspecified={draft.checkOutTimeUnspecified} onTime={(value) => onChange({ checkOutTime: value })} onUnspecified={(value) => onChange({ checkOutTimeUnspecified: value })} />
              <Field label="객실 유형"><Select value={draft.roomType ?? "unspecified"} onChange={(event) => onChange({ roomType: event.target.value as FamilyBookingRoomType })}><option value="unspecified">객실 미정</option><option value="standard">STANDARD</option><option value="deluxe">DELUXE</option></Select><span className="mt-1.5 block text-xs text-text-secondary">{draft.roomType === "standard" ? "STANDARD는 1마리 전용입니다." : draft.roomType === "deluxe" ? "동일 보호자의 DELUXE 예약과 같은 방 후보가 될 수 있습니다." : "객실 유형은 추후 확정할 수 있습니다."}</span></Field>
            </> : null}
            <Field label="담당자"><Input value={draft.assigneeDisplayName} onChange={(event) => onChange({ assigneeDisplayName: event.target.value })} placeholder="담당자 이름 입력" /></Field>
            <div className="sm:col-span-2"><Field label="개별 메모"><Textarea value={draft.memo ?? ""} onChange={(event) => onChange({ memo: event.target.value || undefined })} className="min-h-20" placeholder={`${draft.dogName} 예약에만 적용할 메모`} /></Field></div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function TimeField({ label, value, unspecified, onTime, onUnspecified }: { label: string; value: string; unspecified: boolean; onTime: (value: string) => void; onUnspecified: (value: boolean) => void }) {
  return <Field label={label}><div className="flex gap-2"><Input type="time" value={value} disabled={unspecified} onChange={(event) => onTime(event.target.value)} /><label className="flex shrink-0 items-center gap-2 rounded-xl border border-border px-3 text-xs font-medium text-text-secondary"><input type="checkbox" checked={unspecified} onChange={(event) => onUnspecified(event.target.checked)} className="h-4 w-4 accent-primary" />시간 미정</label></div></Field>;
}

export function FamilyBookingMockCard({ booking, customerName }: { booking: FamilyBookingDraft; customerName: string }) {
  const sharedGroups = new Map<string, FamilyBookingDogDraft[]>();
  booking.dogs.forEach((dog) => { if (!dog.sharedRoomGroupKey) return; sharedGroups.set(dog.sharedRoomGroupKey, [...(sharedGroups.get(dog.sharedRoomGroupKey) ?? []), dog]); });
  const sharedDogIds = new Set([...sharedGroups.values()].flat().map((dog) => dog.dogId));
  return (
    <article className="space-y-3 rounded-2xl border border-primary/20 bg-[linear-gradient(145deg,#ffffff_0%,#f3f7fb_100%)] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><strong className="text-base text-text-primary">{customerName} 가족 예약</strong><Badge tone={booking.status === "created" ? "green" : "amber"}>{booking.status === "created" ? "생성 완료" : "미리보기"}</Badge></div><p className="mt-1 text-sm text-text-secondary">반려견 {booking.dogs.length}마리 · {booking.combinePayment ? "결제 묶음" : "개별 결제"}</p>{booking.familyBookingId ? <p className="mt-1 text-xs text-text-muted">예약 ID {booking.familyBookingId}</p> : null}</div>{booking.multiDogDiscountPlanned ? <Badge tone="amber">다견 할인 예정</Badge> : null}</div>
      {[...sharedGroups.entries()].map(([groupKey, dogs]) => <div key={groupKey} className="rounded-xl border border-primary/20 bg-primary-subtle p-3"><div className="flex items-center gap-2"><UsersRound size={17} className="text-primary" /><strong className="text-text-primary">{dogs.map((dog) => dog.dogName).join(" + ")}</strong></div><p className="mt-1 text-sm text-text-secondary">호텔 · DELUXE · 같은 방 사용 예정</p><p className="mt-1 text-xs text-text-muted">{dogs[0]?.startsOn} ~ {dogs[0]?.endsOn} · 실제 호실 미배정</p></div>)}
      {booking.dogs.filter((dog) => !sharedDogIds.has(dog.dogId)).map((dog) => <div key={dog.dogId} className="rounded-xl border border-border bg-surface p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-text-primary">{dog.dogName}</strong><Badge tone="blue">{serviceLabel(dog.serviceType)}</Badge></div><p className="mt-1 text-sm text-text-secondary">{dog.startsOn} ~ {dog.endsOn}</p>{dog.serviceType === "hotel" ? <p className="mt-1 text-xs text-text-muted">{roomTypeLabel(dog.roomType)} · 객실 미배정</p> : null}{dog.assigneeDisplayName ? <p className="mt-1 text-xs text-text-muted">담당자 {dog.assigneeDisplayName}</p> : null}</div>)}
      {booking.commonRequest ? <p className="rounded-xl bg-surface px-3 py-2 text-sm text-text-secondary"><b className="text-text-primary">공통 요청</b> · {booking.commonRequest}</p> : null}
    </article>
  );
}

export function FamilyBookingRecordCard({
  booking,
  expanded,
}: {
  booking: FamilyBookingRecord;
  expanded: boolean;
}) {
  return (
    <article className="rounded-2xl border border-primary/20 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-base text-text-primary">가족 예약</strong>
            <Badge tone="green">생성 완료</Badge>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            {booking.members.length}마리 · {booking.paymentBundleRequested ? "결제 묶음" : "개별 결제"}
          </p>
          <p className="mt-1 text-xs text-text-muted">예약 ID {booking.id}</p>
        </div>
        <Badge tone="blue">{booking.status}</Badge>
      </div>
      {expanded ? (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          {booking.members.map((member) => (
            <div key={member.id} className="rounded-xl bg-surface-secondary px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-text-primary">{member.dogName || "반려견"}</strong>
                <Badge tone="blue">{serviceLabel(member.serviceType)}</Badge>
              </div>
              <p className="mt-1 text-xs text-text-secondary">
                {member.service?.startsAt ? new Date(member.service.startsAt).toLocaleDateString("ko-KR") : "시작일 미확인"}
                {member.service?.endsAt ? ` ~ ${new Date(member.service.endsAt).toLocaleDateString("ko-KR")}` : ""}
                {member.service?.roomTypeCode ? ` · ${member.service.roomTypeCode}` : ""}
              </p>
            </div>
          ))}
          <p className="rounded-xl bg-primary-subtle px-3 py-2 text-xs text-text-secondary">
            생성 후 일정 변경은 각 반려견 예약에서 진행합니다.
          </p>
        </div>
      ) : null}
    </article>
  );
}
