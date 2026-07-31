import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  Toast,
  cn,
} from "../components/ui";
import {
  ScheduleDetailModal,
  ScheduleFormModal,
  emptyForm,
  formFromSchedule,
  type ScheduleForm,
} from "./OperationsToday";
import {
  OperationScheduleRepositoryError,
  archiveOperationSchedule,
  attachOperationAssigneeColors,
  compactDogNames,
  compactNames,
  createOperationSchedule,
  defaultOperationCalendarId,
  defaultOperationScheduleTypeId,
  fetchOperationScheduleOptions,
  fetchOperationSchedulesForRange,
  nextSeoulDate,
  schedulePrimaryAssignee,
  seoulDateKey,
  setOperationScheduleStatus,
  toSeoulInstant,
  updateOperationSchedule,
  type OperationSchedule,
  type OperationScheduleInput,
  type OperationScheduleOptions,
} from "./operationsScheduleRepository";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type PendingAction =
  | { type: "cancel"; schedule: OperationSchedule }
  | { type: "archive"; schedule: OperationSchedule };

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function dateKey(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, amount: number) {
  const date = parseDateKey(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  return dateKey(new Date(Date.UTC(year, month - 1 + amount, 1, 12))).slice(
    0,
    7,
  );
}

function monthGrid(value: string) {
  const [year, month] = value.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const last = new Date(Date.UTC(year, month, 0, 12));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  const cells: string[] = [];
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    cells.push(dateKey(cursor));
  }
  return cells;
}

function occursOn(schedule: OperationSchedule, localDate: string) {
  const start = new Date(toSeoulInstant(localDate, "00:00")).getTime();
  const end = new Date(
    toSeoulInstant(nextSeoulDate(localDate), "00:00"),
  ).getTime();
  return (
    schedule.archivedAt === null &&
    new Date(schedule.startsAt).getTime() < end &&
    new Date(schedule.endsAt).getTime() > start
  );
}

function timeLabel(schedule: OperationSchedule) {
  if (schedule.allDay) return "종일";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(schedule.startsAt));
}

function fullDateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T12:00:00+09:00`));
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return `${year}년 ${month}월`;
}

export function OperationsCalendarFoundationPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const today = seoulDateKey();
  const [visibleMonth, setVisibleMonth] = useState(monthKey(today));
  const [selectedDate, setSelectedDate] = useState(today);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [schedules, setSchedules] = useState<OperationSchedule[]>([]);
  const [options, setOptions] = useState<OperationScheduleOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detail, setDetail] = useState<OperationSchedule | null>(null);
  const [editing, setEditing] = useState<OperationSchedule | "new" | null>(
    null,
  );
  const [form, setForm] = useState<ScheduleForm>(() => emptyForm());
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [actionReason, setActionReason] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<
    "success" | "warning" | "error"
  >("success");
  const gridDates = useMemo(() => monthGrid(visibleMonth), [visibleMonth]);
  const rangeStart = gridDates[0];
  const rangeEnd = addDays(gridDates[gridDates.length - 1], 1);

  const loadMonth = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const nextOptions = options ?? (await fetchOperationScheduleOptions());
      setOptions(nextOptions);
      const rows = await fetchOperationSchedulesForRange(
        rangeStart,
        rangeEnd,
        nextOptions,
      );
      setSchedules(rows);
      setDetail((current) =>
        current
          ? rows.find((schedule) => schedule.id === current.id) ?? null
          : null,
      );
    } catch (error) {
      setSchedules([]);
      setLoadError(
        error instanceof Error
          ? error.message
          : "캘린더 일정을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [options, rangeEnd, rangeStart]);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  const schedulesByDate = useMemo(() => {
    return new Map(
      gridDates.map((date) => [
        date,
        schedules.filter((schedule) => occursOn(schedule, date)),
      ]),
    );
  }, [gridDates, schedules]);
  const selectedSchedules = schedulesByDate.get(selectedDate) ?? [];

  const showNotice = (
    message: string,
    tone: "success" | "warning" | "error" = "success",
  ) => {
    setNotice(message);
    setNoticeTone(tone);
  };

  const openDate = (date: string) => {
    setSelectedDate(date);
    setDrawerOpen(true);
  };

  const openNew = () => {
    if (!options) {
      showNotice("일정 등록 정보를 불러오는 중입니다.", "warning");
      return;
    }
    const initial = emptyForm();
    initial.date = selectedDate;
    initial.endDate = selectedDate;
    initial.calendarId = defaultOperationCalendarId(options.calendars);
    initial.scheduleTypeId = defaultOperationScheduleTypeId(
      options.scheduleTypes.filter((item) =>
        item.calendarIds?.includes(initial.calendarId),
      ),
    );
    initial.assigneeIds = profile?.id ? [profile.id] : [];
    setForm(initial);
    setTitleManuallyEdited(false);
    setFormError("");
    setEditing("new");
  };

  const openEdit = (schedule: OperationSchedule) => {
    setDetail(null);
    setForm(formFromSchedule(schedule));
    setTitleManuallyEdited(true);
    setFormError("");
    setEditing(schedule);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    const calendarId =
      form.calendarId ||
      defaultOperationCalendarId(options?.calendars ?? []);
    const scheduleTypeId =
      form.scheduleTypeId ||
      defaultOperationScheduleTypeId(options?.scheduleTypes ?? []);
    if (
      !calendarId ||
      !scheduleTypeId ||
      !form.date ||
      (!form.allDay &&
        (!form.startTime || !form.endDate || !form.endTime)) ||
      (editing === "new" && form.dogIds.length === 0) ||
      form.assigneeIds.length === 0 ||
      !form.title.trim()
    ) {
      setFormError("반려견, 날짜, 시간, 담당자를 확인해 주세요.");
      return;
    }
    const startsAt = form.allDay
      ? toSeoulInstant(form.date, "00:00")
      : toSeoulInstant(form.date, form.startTime);
    const endsAt = form.allDay
      ? toSeoulInstant(nextSeoulDate(form.date), "00:00")
      : toSeoulInstant(form.endDate, form.endTime);
    if (new Date(endsAt) <= new Date(startsAt)) {
      setFormError("종료 시간은 시작 시간보다 늦어야 합니다.");
      return;
    }
    const input: OperationScheduleInput = {
      calendarId,
      scheduleTypeId,
      title: form.title.trim(),
      startsAt,
      endsAt,
      allDay: form.allDay,
      memo: form.memo.trim(),
      assigneeIds: form.assigneeIds,
      customerIds: form.customerIds,
      dogIds: form.dogIds,
    };
    setSaving(true);
    try {
      if (editing === "new") {
        await createOperationSchedule(input, crypto.randomUUID());
        showNotice("새 일정을 등록했습니다.");
      } else if (editing) {
        await updateOperationSchedule(
          editing.id,
          editing.version,
          input,
          crypto.randomUUID(),
        );
        showNotice("일정을 수정했습니다.");
      }
      setEditing(null);
      setSelectedDate(form.date);
      await loadMonth();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "일정을 저장하지 못했습니다.",
      );
      if (
        error instanceof OperationScheduleRepositoryError &&
        error.kind === "conflict"
      ) {
        await loadMonth();
      }
    } finally {
      setSaving(false);
    }
  };

  const completeSchedule = async (schedule: OperationSchedule) => {
    setSaving(true);
    try {
      await setOperationScheduleStatus(
        schedule.id,
        schedule.version,
        "completed",
        "일정 완료",
        crypto.randomUUID(),
      );
      setDetail(null);
      showNotice("일정을 완료 처리했습니다.");
      await loadMonth();
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "일정을 처리하지 못했습니다.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmAction = async () => {
    if (!pendingAction || !actionReason.trim()) return;
    setSaving(true);
    try {
      if (pendingAction.type === "cancel") {
        await setOperationScheduleStatus(
          pendingAction.schedule.id,
          pendingAction.schedule.version,
          "cancelled",
          actionReason.trim(),
          crypto.randomUUID(),
        );
        showNotice("일정을 취소했습니다.");
      } else {
        await archiveOperationSchedule(
          pendingAction.schedule.id,
          pendingAction.schedule.version,
          actionReason.trim(),
          crypto.randomUUID(),
        );
        showNotice("일정을 보관했습니다.");
      }
      setPendingAction(null);
      setActionReason("");
      setDetail(null);
      await loadMonth();
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "일정을 처리하지 못했습니다.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const moveMonth = (amount: number) => {
    const next = shiftMonth(visibleMonth, amount);
    setVisibleMonth(next);
    setSelectedDate(`${next}-01`);
  };

  const goToday = () => {
    setVisibleMonth(monthKey(today));
    setSelectedDate(today);
    setDrawerOpen(true);
  };

  return (
    <section className="mx-auto max-w-[1480px]">
      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">Operations</p>
          <h1 className="mt-1 text-[clamp(1.75rem,4vw,2.5rem)] font-bold tracking-[-0.045em] text-text-primary">
            캘린더
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            사업부와 담당자별 일정을 한 달 흐름으로 확인하세요.
          </p>
        </div>
        <Button onClick={openNew} disabled={!options || loading}>
          <Plus size={18} aria-hidden="true" />
          새 일정
        </Button>
      </header>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="이전 달"
              onClick={() => moveMonth(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-text-secondary transition hover:border-primary/30 hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="min-w-[8.5rem] text-center text-lg font-bold tracking-[-0.02em] text-text-primary sm:text-xl">
              {monthLabel(visibleMonth)}
            </h2>
            <button
              type="button"
              aria-label="다음 달"
              onClick={() => moveMonth(1)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-text-secondary transition hover:border-primary/30 hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <Button variant="secondary" onClick={goToday}>
            오늘
          </Button>
        </div>

        {loading ? (
          <LoadingState />
        ) : loadError ? (
          <div className="p-5">
            <ErrorState
              title={loadError || "캘린더를 불러오지 못했습니다"}
              retry={() => void loadMonth()}
            />
          </div>
        ) : (
          <div key={visibleMonth} className="animate-[fadeIn_180ms_ease-out]">
            <div className="grid grid-cols-7 border-b border-border bg-surface-secondary/60">
              {WEEKDAYS.map((weekday, index) => (
                <div
                  key={weekday}
                  className={cn(
                    "px-1 py-2 text-center text-xs font-semibold",
                    index === 0
                      ? "text-error"
                      : index === 6
                        ? "text-primary"
                        : "text-text-muted",
                  )}
                >
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {gridDates.map((date) => {
                const daySchedules = schedulesByDate.get(date) ?? [];
                return (
                  <CalendarCell
                    key={date}
                    date={date}
                    schedules={daySchedules}
                    currentMonth={visibleMonth}
                    today={today}
                    selected={date === selectedDate}
                    onClick={() => openDate(date)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      <DayDrawer
        open={drawerOpen}
        date={selectedDate}
        schedules={selectedSchedules}
        onClose={() => setDrawerOpen(false)}
        onPrevious={() => {
          const next = addDays(selectedDate, -1);
          setSelectedDate(next);
          if (monthKey(next) !== visibleMonth) setVisibleMonth(monthKey(next));
        }}
        onNext={() => {
          const next = addDays(selectedDate, 1);
          setSelectedDate(next);
          if (monthKey(next) !== visibleMonth) setVisibleMonth(monthKey(next));
        }}
        onAdd={openNew}
        onOpen={setDetail}
      />

      <ScheduleFormModal
        open={editing !== null}
        editing={editing}
        form={form}
        options={options}
        error={formError}
        saving={saving}
        recentScope={profile?.id ?? "calendar"}
        titleManuallyEdited={titleManuallyEdited}
        onTitleManuallyEdited={setTitleManuallyEdited}
        onChange={setForm}
        onSubmit={save}
        onClose={() => setEditing(null)}
        minimalCalendarMode
      />
      <ScheduleDetailModal
        schedule={
          detail && options
            ? attachOperationAssigneeColors(detail, options.assignees)
            : detail
        }
        processing={saving}
        onClose={() => setDetail(null)}
        onEdit={openEdit}
        onComplete={(schedule) => void completeSchedule(schedule)}
        onCancel={(schedule) => {
          setActionReason("");
          setPendingAction({ type: "cancel", schedule });
        }}
        onArchive={(schedule) => {
          setActionReason("");
          setPendingAction({ type: "archive", schedule });
        }}
        onOpenDog={(id) => navigate(`/customers?dog=${id}`)}
        onOpenCustomer={(id) => navigate(`/customers?customer=${id}`)}
        archiveLabel="삭제"
      />
      <Modal
        open={pendingAction !== null}
        title={pendingAction?.type === "cancel" ? "일정 취소" : "일정 삭제"}
        onClose={() => setPendingAction(null)}
      >
        <p className="text-sm leading-6 text-text-secondary">
          {pendingAction?.type === "cancel"
            ? "취소 일정은 감사 기록을 유지한 채 캘린더에 취소 상태로 남습니다."
            : "삭제한 일정은 감사 기록을 유지한 채 보관되며 캘린더에서 제외됩니다."}
        </p>
        <label className="mt-4 block text-sm font-semibold text-text-primary">
          사유
          <Input
            className="mt-2"
            value={actionReason}
            onChange={(event) => setActionReason(event.target.value)}
            placeholder="처리 사유를 입력하세요"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPendingAction(null)}>
            닫기
          </Button>
          <Button
            variant={pendingAction?.type === "cancel" ? "danger" : "primary"}
            disabled={saving || !actionReason.trim()}
            onClick={() => void confirmAction()}
          >
            {saving ? "처리 중..." : "확인"}
          </Button>
        </div>
      </Modal>
      {notice && (
        <Toast
          message={notice}
          tone={noticeTone}
          onClose={() => setNotice("")}
        />
      )}
    </section>
  );
}

function CalendarCell({
  date,
  schedules,
  currentMonth,
  today,
  selected,
  onClick,
}: {
  date: string;
  schedules: OperationSchedule[];
  currentMonth: string;
  today: string;
  selected: boolean;
  onClick: () => void;
}) {
  const outside = monthKey(date) !== currentMonth;
  const isToday = date === today;
  const weekday = parseDateKey(date).getUTCDay();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${fullDateLabel(date)}, 일정 ${schedules.length}건`}
      aria-pressed={selected}
      className={cn(
        "group relative min-h-[78px] border-b border-r border-border p-1.5 text-left transition sm:min-h-[132px] sm:p-2 lg:min-h-[154px]",
        "focus:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
        outside ? "bg-surface-secondary/35" : "bg-surface",
        selected && "z-[1] bg-primary-soft/55 ring-2 ring-inset ring-primary",
        !selected && "hover:bg-primary-soft/25",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums sm:text-sm",
            outside && "text-text-muted/60",
            !outside &&
              weekday === 0 &&
              "text-error",
            !outside &&
              weekday === 6 &&
              "text-primary",
            !outside &&
              weekday > 0 &&
              weekday < 6 &&
              "text-text-secondary",
            isToday && "bg-primary text-white",
          )}
        >
          {Number(date.slice(-2))}
        </span>
        {schedules.length > 0 && (
          <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-text-muted sm:text-xs">
            {schedules.length}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1 sm:hidden" aria-hidden="true">
        {schedules.slice(0, 4).map((schedule) => (
          <span
            key={schedule.id}
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor:
                schedulePrimaryAssignee(schedule)?.scheduleColor ??
                schedule.calendarColor,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 hidden space-y-1 sm:block">
        {schedules.slice(0, 2).map((schedule) => (
          <MonthScheduleCard key={schedule.id} schedule={schedule} />
        ))}
        {schedules.length > 2 && (
          <p className="px-1 text-[11px] font-semibold text-text-muted">
            +{schedules.length - 2}건 더 보기
          </p>
        )}
      </div>
    </button>
  );
}

function MonthScheduleCard({ schedule }: { schedule: OperationSchedule }) {
  const assignee = schedulePrimaryAssignee(schedule);
  const dogName = schedule.dogs[0]?.name ?? schedule.title;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border/80 bg-surface px-2 py-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        schedule.status !== "scheduled" && "opacity-55",
      )}
    >
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: schedule.calendarColor }}
      />
      <div className="flex min-w-0 items-center gap-1.5 pl-0.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: assignee?.scheduleColor ?? "#5B7FA3" }}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px] font-bold text-text-primary",
            schedule.status === "cancelled" && "line-through",
          )}
        >
          {dogName}
        </span>
        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-text-muted">
          {timeLabel(schedule)}
        </span>
        {schedule.status === "completed" && (
          <Check size={11} className="shrink-0 text-success" />
        )}
      </div>
    </div>
  );
}

function DayDrawer({
  open,
  date,
  schedules,
  onClose,
  onPrevious,
  onNext,
  onAdd,
  onOpen,
}: {
  open: boolean;
  date: string;
  schedules: OperationSchedule[];
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onAdd: () => void;
  onOpen: (schedule: OperationSchedule) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 transition",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="날짜 상세 닫기"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-slate-950/20 backdrop-blur-[1px] transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${fullDateLabel(date)} 일정`}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-border bg-surface shadow-2xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="border-b border-border px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-primary">DAY SCHEDULE</p>
              <h2 className="mt-1 text-xl font-bold tracking-[-0.03em] text-text-primary">
                {fullDateLabel(date)}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                일정 {schedules.length}건
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-text-secondary transition hover:bg-surface-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X size={20} />
            </button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="inline-flex rounded-xl border border-border bg-surface-secondary p-1">
              <button
                type="button"
                onClick={onPrevious}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface hover:text-text-primary"
                aria-label="이전 날짜"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                onClick={onNext}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface hover:text-text-primary"
                aria-label="다음 날짜"
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <Button onClick={onAdd}>
              <Plus size={17} />
              일정 추가
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {schedules.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <CalendarDays size={22} />
              </span>
              <h3 className="mt-4 font-bold text-text-primary">
                등록된 일정이 없습니다
              </h3>
              <p className="mt-2 text-sm text-text-secondary">
                이 날짜의 첫 일정을 추가해 보세요.
              </p>
              <Button className="mt-4" onClick={onAdd}>
                <Plus size={17} />
                일정 추가
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {schedules.map((schedule) => (
                <DayScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  onClick={() => onOpen(schedule)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DayScheduleCard({
  schedule,
  onClick,
}: {
  schedule: OperationSchedule;
  onClick: () => void;
}) {
  const assignee = schedulePrimaryAssignee(schedule);
  const dogName = compactDogNames(schedule.dogs);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border border-border bg-surface px-4 py-3.5 text-left transition duration-150",
        "hover:-translate-y-px hover:border-primary/25 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        schedule.status !== "scheduled" && "opacity-60",
      )}
    >
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: schedule.calendarColor }}
      />
      <div className="flex items-start gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-surface-secondary px-1 py-2 text-center">
          <Clock3 size={14} className="text-text-muted" />
          <span className="mt-1 text-xs font-bold tabular-nums text-text-primary">
            {timeLabel(schedule)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3
              className={cn(
                "truncate font-bold text-text-primary",
                schedule.status === "cancelled" && "line-through",
              )}
            >
              {dogName}
            </h3>
            <Badge tone="gray">
              {schedule.status === "completed"
                ? "완료"
                : schedule.status === "cancelled"
                  ? "취소"
                  : "예정"}
            </Badge>
          </div>
          {schedule.title !== dogName && (
            <p className="mt-1 truncate text-xs font-medium text-text-secondary">
              {schedule.title}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
            <span className="flex items-center gap-1">
              <UserRound size={13} />
              {schedule.customers[0]?.name ?? "보호자 미연결"}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: assignee?.scheduleColor ?? "#5B7FA3",
              }}
            />
            {compactNames(schedule.assignees, "담당자 미지정")}
            {schedule.assignees.slice(1).map((person) => (
              <span
                key={person.id}
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: person.scheduleColor ?? "#5B7FA3" }}
                aria-label={person.name ?? "담당자"}
              />
            ))}
          </div>
          {schedule.memo && (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-muted">
              {schedule.memo}
            </p>
          )}
        </div>
        <ChevronRight
          size={17}
          className="mt-1 shrink-0 text-text-muted transition group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </div>
    </button>
  );
}
