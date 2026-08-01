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
  scheduleInputFromForm,
  type ScheduleForm,
} from "./OperationsToday";
import {
  OperationScheduleRepositoryError,
  archiveOperationSchedule,
  attachOperationAssigneeColors,
  canManageOperationSchedule,
  compactDogNames,
  compactNames,
  createOperationSchedule,
  defaultOperationCalendarId,
  defaultOperationScheduleTypeId,
  fetchCurrentOperationRole,
  fetchOperationScheduleOptions,
  fetchOperationSchedulesForRange,
  isOperationScheduleAssignedTo,
  mergeOperationScheduleCollection,
  nextSeoulDate,
  operationPersonColor,
  operationScheduleTimeLabel,
  schedulePrimaryAssignee,
  seoulDateKey,
  setOperationScheduleStatus,
  toSeoulInstant,
  updateOperationSchedule,
  type OperationSchedule,
  type OperationScheduleOptions,
  type OperationRole,
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
  const [currentOperationRole, setCurrentOperationRole] =
    useState<OperationRole | null>(null);
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

  useEffect(() => {
    if (!profile?.id) return;
    void fetchCurrentOperationRole(profile.id)
      .then(setCurrentOperationRole)
      .catch(() => setCurrentOperationRole(null));
  }, [profile?.id]);

  useEffect(() => {
    if (!notice || noticeTone !== "success") return;
    const timeoutId = window.setTimeout(() => setNotice(""), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [notice, noticeTone]);

  const schedulesByDate = useMemo(() => {
    return new Map(
      gridDates.map((date) => [
        date,
        schedules.filter((schedule) => occursOn(schedule, date)),
      ]),
    );
  }, [gridDates, schedules]);
  const selectedSchedules = schedulesByDate.get(selectedDate) ?? [];
  const canManageSchedule = useCallback(
    (schedule: OperationSchedule) =>
      canManageOperationSchedule(
        schedule,
        profile?.id,
        currentOperationRole,
      ),
    [currentOperationRole, profile?.id],
  );

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
    const prepared = scheduleInputFromForm(form, options);
    if (!prepared.input) {
      setFormError(prepared.error);
      return;
    }
    const input = prepared.input;
    setSaving(true);
    try {
      if (editing === "new") {
        const created = attachOperationAssigneeColors(
          await createOperationSchedule(input, crypto.randomUUID()),
          options?.assignees ?? [],
        );
        setSchedules((current) =>
          mergeOperationScheduleCollection(current, created),
        );
        showNotice("새 일정을 등록했습니다.");
      } else if (editing) {
        const updated = attachOperationAssigneeColors(
          await updateOperationSchedule(
            editing.id,
            editing.version,
            input,
            crypto.randomUUID(),
          ),
          options?.assignees ?? [],
        );
        setSchedules((current) =>
          mergeOperationScheduleCollection(current, updated),
        );
        showNotice("일정을 수정했습니다.");
      }
      setEditing(null);
      setSelectedDate(form.date);
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
      const updated = attachOperationAssigneeColors(await setOperationScheduleStatus(
        schedule.id,
        schedule.version,
        "completed",
        "일정 완료",
        crypto.randomUUID(),
      ), options?.assignees ?? []);
      setSchedules((current) =>
        mergeOperationScheduleCollection(current, updated),
      );
      setDetail(null);
      showNotice("일정을 완료 처리했습니다.");
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
    if (!pendingAction) return;
    const actionReason =
      pendingAction.type === "cancel" ? "일정 취소" : "오등록 일정 삭제";
    setSaving(true);
    try {
      if (pendingAction.type === "cancel") {
        const updated = attachOperationAssigneeColors(await setOperationScheduleStatus(
          pendingAction.schedule.id,
          pendingAction.schedule.version,
          "cancelled",
          actionReason,
          crypto.randomUUID(),
        ), options?.assignees ?? []);
        setSchedules((current) =>
          mergeOperationScheduleCollection(current, updated),
        );
        showNotice("일정을 취소했습니다.");
      } else {
        const updated = await archiveOperationSchedule(
          pendingAction.schedule.id,
          pendingAction.schedule.version,
          actionReason,
          crypto.randomUUID(),
        );
        setSchedules((current) =>
          mergeOperationScheduleCollection(current, updated),
        );
        showNotice("일정을 삭제했습니다.");
      }
      setPendingAction(null);
      setDetail(null);
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "일정을 처리하지 못했습니다.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const returnToScheduleDetail = () => {
    const schedule = pendingAction?.schedule ?? null;
    setPendingAction(null);
    setDetail(schedule);
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

      <div className="overflow-hidden rounded-[22px] border border-border/90 bg-surface shadow-[var(--pm-shadow-surface)] ring-1 ring-inset ring-white/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="이전 달"
              onClick={() => moveMonth(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-text-secondary transition-[color,background-color,border-color,transform] duration-[180ms] ease-out hover:border-primary/30 hover:bg-primary-soft hover:text-primary active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-text-secondary transition-[color,background-color,border-color,transform] duration-[180ms] ease-out hover:border-primary/30 hover:bg-primary-soft hover:text-primary active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                    currentUserId={profile?.id}
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
        loading={loading}
        error={loadError}
        onRetry={() => void loadMonth()}
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
        currentUserId={profile?.id}
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
        currentUserName={profile?.name}
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
          setPendingAction({ type: "cancel", schedule });
          setDetail(null);
        }}
        onArchive={(schedule) => {
          setPendingAction({ type: "archive", schedule });
          setDetail(null);
        }}
        onOpenDog={(id) =>
          navigate(`/operations/customers?dogId=${encodeURIComponent(id)}`)
        }
        onOpenCustomer={(id) =>
          navigate(
            `/operations/customers?customerId=${encodeURIComponent(id)}`,
          )
        }
        canManage={detail ? canManageSchedule(detail) : false}
      />
      <Modal
        open={pendingAction !== null}
        title={
          pendingAction?.type === "cancel"
            ? "이 일정을 취소할까요?"
            : "이 일정을 삭제할까요?"
        }
        onClose={returnToScheduleDetail}
      >
        <p className="text-sm leading-6 text-text-secondary">
          {pendingAction?.type === "cancel"
            ? "취소된 일정은 기록에 남으며 필요하면 다시 상태를 변경할 수 있습니다."
            : "삭제된 일정은 오늘과 캘린더에서 표시되지 않습니다."}
        </p>
        <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 mt-6 grid grid-cols-2 gap-2 border-t border-border bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] sm:static sm:mx-0 sm:mb-0 sm:flex sm:justify-end sm:border-0 sm:p-0 sm:shadow-none">
          <Button variant="secondary" onClick={returnToScheduleDetail}>
            돌아가기
          </Button>
          <Button
            variant="danger"
            disabled={saving}
            onClick={() => void confirmAction()}
          >
            {saving
              ? "처리 중..."
              : pendingAction?.type === "cancel"
                ? "일정 취소"
                : "일정 삭제"}
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
  currentUserId,
  onClick,
}: {
  date: string;
  schedules: OperationSchedule[];
  currentMonth: string;
  today: string;
  selected: boolean;
  currentUserId?: string | null;
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
        "group relative min-h-[78px] border-b border-r border-border p-1.5 text-left transition-[background-color,border-color,border-radius,box-shadow,transform] duration-[160ms] ease-out sm:min-h-[134px] sm:p-2.5 lg:min-h-[154px] lg:p-3",
        "focus:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
        outside ? "bg-surface-secondary/35" : "bg-surface",
        selected && "z-[2] -translate-y-px rounded-lg bg-[linear-gradient(145deg,#ffffff_0%,#eaf1f7_100%)] shadow-[0_10px_28px_rgb(39_76_119_/_0.2)] ring-2 ring-inset ring-primary",
        !selected && "hover:z-[1] hover:-translate-y-px hover:rounded-lg hover:bg-primary-soft/40 hover:shadow-[0_7px_20px_rgb(23_36_58_/_0.1),inset_0_0_0_1px_rgb(39_76_119_/_0.12)]",
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
            isToday && "bg-primary text-white shadow-[0_4px_10px_rgb(39_76_119_/_0.28)] ring-2 ring-primary/15 ring-offset-1",
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
            className="h-2.5 w-2.5 rounded-full shadow-[0_1px_4px_rgb(15_23_42_/_0.2)] ring-1 ring-white"
            style={{
              backgroundColor:
                schedulePrimaryAssignee(schedule)
                  ? operationPersonColor(schedulePrimaryAssignee(schedule)!)
                  : schedule.calendarColor,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 hidden space-y-1 sm:block">
        {schedules.slice(0, 2).map((schedule) => (
          <MonthScheduleCard
            key={schedule.id}
            schedule={schedule}
            currentUserId={currentUserId}
          />
        ))}
        {schedules.length > 2 && (
          <span className="mt-1 inline-flex rounded-full border border-primary/15 bg-primary-soft px-2 py-1 text-[10px] font-bold leading-none text-primary shadow-[0_1px_3px_rgb(39_76_119_/_0.08)] transition-colors duration-[160ms] group-hover:bg-primary/10 lg:text-[11px]">
            +{schedules.length - 2}개 일정
          </span>
        )}
      </div>
    </button>
  );
}

function MonthScheduleCard({
  schedule,
  currentUserId,
}: {
  schedule: OperationSchedule;
  currentUserId?: string | null;
}) {
  const assignee = schedulePrimaryAssignee(schedule);
  const displayTitle = schedule.title || schedule.dogs[0]?.name || "제목 없음";
  const isMine = isOperationScheduleAssignedTo(schedule, currentUserId);
  return (
    <div
      className={cn(
        "relative min-h-[38px] overflow-hidden rounded-lg border border-border/80 bg-surface px-2.5 py-2 shadow-[0_2px_6px_rgb(15_23_42_/_0.06)] transition-[border-color,background-color,box-shadow,opacity,transform] duration-[160ms] ease-out group-hover:border-primary/20 group-hover:shadow-[0_5px_12px_rgb(15_23_42_/_0.09)] lg:min-h-[42px] lg:px-3",
        isMine && "border-primary/30 bg-primary-soft/65 shadow-[0_3px_8px_rgb(39_76_119_/_0.1)]",
        schedule.status !== "scheduled" && "opacity-55",
      )}
    >
      <span
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ backgroundColor: schedule.calendarColor }}
      />
      <div className="min-w-0 pl-0.5">
        <span
          className={cn(
            "block truncate text-[10px] font-bold leading-4 tracking-[-0.01em] text-text-primary lg:text-xs",
            isMine && "font-extrabold",
            schedule.status === "cancelled" && "line-through",
          )}
        >
          {displayTitle}
        </span>
        <div className="mt-px flex min-w-0 items-center gap-1">
          <span
            className={cn(
              "shrink-0 text-[9px] font-semibold leading-3 tabular-nums lg:text-[10px]",
              schedule.timeUnspecified
                ? "rounded-full bg-surface-secondary px-1.5 py-0.5 text-text-secondary"
                : "text-text-secondary",
            )}
          >
            {operationScheduleTimeLabel(schedule)}
          </span>
          <span
            className="h-3 w-3 shrink-0 rounded-full shadow-[0_1px_4px_rgb(15_23_42_/_0.24)] ring-2 ring-white"
            style={{
              backgroundColor: assignee
                ? operationPersonColor(assignee)
                : "#5B7FA3",
            }}
            aria-label={assignee?.name ?? "담당자"}
          />
          {schedule.assignees.slice(1, 3).map((person) => (
            <span
              key={person.id}
              className="h-2 w-2 shrink-0 rounded-full shadow-sm ring-1 ring-white"
            style={{ backgroundColor: operationPersonColor(person) }}
              aria-label={person.name ?? "담당자"}
            />
          ))}
          {schedule.status === "completed" && (
            <Check size={10} className="ml-auto shrink-0 text-success" />
          )}
        </div>
      </div>
    </div>
  );
}

function DayDrawer({
  open,
  date,
  schedules,
  loading,
  error,
  onRetry,
  onClose,
  onPrevious,
  onNext,
  onAdd,
  onOpen,
  currentUserId,
}: {
  open: boolean;
  date: string;
  schedules: OperationSchedule[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onAdd: () => void;
  onOpen: (schedule: OperationSchedule) => void;
  currentUserId?: string | null;
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
        "fixed inset-0 z-40 transition duration-[180ms] ease-out",
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
          "absolute inset-0 bg-slate-950/20 backdrop-blur-[1px] transition-opacity duration-[180ms] ease-out",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${fullDateLabel(date)} 일정`}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-border bg-surface shadow-2xl transition-transform duration-[180ms] ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="border-b border-border px-4 pb-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.06em] text-primary">DAY SCHEDULE</p>
              <h2 className="mt-0.5 text-xl font-bold tracking-[-0.03em] text-text-primary">
                {fullDateLabel(date)}
              </h2>
              <p className="mt-1 text-sm font-medium text-text-secondary">
                {date === seoulDateKey() ? "오늘 일정" : "총 일정"}{" "}
                {schedules.length}건
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-text-secondary transition-[color,background-color,transform] duration-[180ms] ease-out hover:bg-surface-secondary hover:text-text-primary active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X size={20} />
            </button>
          </div>
          <div className="mt-3.5 flex items-center justify-between gap-2">
            <div className="inline-flex rounded-xl border border-border bg-surface-secondary p-1">
              <button
                type="button"
                onClick={onPrevious}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-[color,background-color,transform] duration-[180ms] ease-out hover:bg-surface hover:text-text-primary active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="이전 날짜"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                onClick={onNext}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-[color,background-color,transform] duration-[180ms] ease-out hover:bg-surface hover:text-text-primary active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3.5 sm:px-6">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState
              title={error || "날짜 일정을 불러오지 못했습니다"}
              retry={onRetry}
            />
          ) : schedules.length === 0 ? (
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
            <div className="space-y-2">
              {schedules.map((schedule) => (
                <DayScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  currentUserId={currentUserId}
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
  currentUserId,
  onClick,
}: {
  schedule: OperationSchedule;
  currentUserId?: string | null;
  onClick: () => void;
}) {
  const assignee = schedulePrimaryAssignee(schedule);
  const dogName = compactDogNames(schedule.dogs);
  const isMine = isOperationScheduleAssignedTo(schedule, currentUserId);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border border-border/90 bg-surface px-4 py-3.5 text-left shadow-[0_2px_7px_rgb(23_36_58_/_0.05),0_8px_20px_rgb(23_36_58_/_0.045)] transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out",
        "hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary-subtle/35 hover:shadow-[var(--pm-shadow-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        isMine && "border-primary/30 bg-[linear-gradient(135deg,#ffffff_0%,#edf3f8_100%)] shadow-[0_4px_14px_rgb(39_76_119_/_0.1)]",
        schedule.status !== "scheduled" && "opacity-60",
      )}
    >
      <span
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ backgroundColor: schedule.calendarColor }}
      />
      <div className="flex min-w-0 items-start gap-3 pl-1">
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "truncate text-[15px] font-bold leading-5 tracking-[-0.015em] text-text-primary",
              schedule.status === "cancelled" && "line-through",
            )}
          >
            {schedule.title}
          </h3>
          <div className="mt-1.5 flex items-center gap-1 text-xs font-bold tabular-nums text-text-primary">
            <Clock3 size={13} className="text-text-muted" />
            {schedule.timeUnspecified ? (
              <Badge tone="gray">시간 미정</Badge>
            ) : (
              operationScheduleTimeLabel(schedule)
            )}
          </div>
          <div className="mt-1.5 truncate text-sm font-semibold text-text-secondary">
            {dogName}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="flex items-center gap-1 font-bold tabular-nums text-text-primary">
              <span
                className="h-3 w-3 shrink-0 rounded-full shadow-[0_1px_4px_rgb(15_23_42_/_0.2)] ring-2 ring-white"
                style={{
                  backgroundColor: assignee
                    ? operationPersonColor(assignee)
                    : "#5B7FA3",
                }}
              />
              <span className="truncate">
                {compactNames(schedule.assignees, "담당자 미지정")}
              </span>
              {schedule.assignees.slice(1).map((person) => (
                <span
                  key={person.id}
                  className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ring-1 ring-white"
                  style={{ backgroundColor: operationPersonColor(person) }}
                  aria-label={person.name ?? "담당자"}
                />
              ))}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="gray">
              {schedule.status === "completed"
                ? "완료"
                : schedule.status === "cancelled"
                  ? "취소"
                  : "예정"}
            </Badge>
            {isMine && <Badge tone="blue">내 일정</Badge>}
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-1 text-xs text-text-secondary">
            <UserRound size={13} className="shrink-0 text-text-muted" />
            <span className="truncate">
              {schedule.customers[0]?.name ?? "보호자 미연결"}
            </span>
          </div>
          {schedule.memo && (
            <p className="mt-1.5 line-clamp-2 border-t border-border/70 pt-1.5 text-xs leading-5 text-text-muted">
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
