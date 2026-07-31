import {
  CheckCircle2,
  CircleX,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Dog,
  Pencil,
  Plus,
  UserRound,
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
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Select,
  Textarea,
  Toast,
  cn,
} from "../components/ui";
import { SearchSelect } from "../components/SearchSelect";
import { formatPhoneForDisplay } from "../lib/phone";
import {
  OperationScheduleRepositoryError,
  attachOperationAssigneeColors,
  archiveOperationSchedule,
  canManageOperationSchedule,
  calculateOperationTodaySummary,
  compactNames,
  createOperationSchedule,
  DEFAULT_OPERATION_SCHEDULE_COLOR,
  defaultOperationCalendarId,
  defaultOperationScheduleTitle,
  defaultOperationScheduleWindow,
  defaultOperationScheduleTypeId,
  fetchCurrentOperationRole,
  fetchOperationScheduleOptions,
  fetchOperationSchedulesForDay,
  isOperationScheduleAssignedTo,
  mergeOperationTodaySchedule,
  nextSeoulDate,
  oneHourScheduleEnd,
  operationDogProfileLine,
  operationPersonColor,
  operationPersonDisplayName,
  seoulDateKey,
  schedulePrimaryAssignee,
  setOperationScheduleStatus,
  sortOperationSchedulesForViewer,
  suggestOperationCustomerIds,
  toSeoulInstant,
  updateOperationSchedule,
  type OperationSchedule,
  type OperationScheduleInput,
  type OperationScheduleOptions,
  type OperationRole,
} from "./operationsScheduleRepository";

export interface ScheduleForm {
  calendarId: string;
  scheduleTypeId: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  dogIds: string[];
  customerIds: string[];
  assigneeIds: string[];
  title: string;
  memo: string;
}

interface PendingAction {
  type: "cancel" | "archive";
  schedule: OperationSchedule;
}

export const emptyForm = (): ScheduleForm => {
  const scheduleWindow = defaultOperationScheduleWindow();
  return {
    calendarId: "",
    scheduleTypeId: "",
    ...scheduleWindow,
    allDay: false,
    dogIds: [],
    customerIds: [],
    assigneeIds: [],
    title: "",
    memo: "",
  };
};

const seoulParts = (value: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
};

export const formFromSchedule = (schedule: OperationSchedule): ScheduleForm => {
  const start = seoulParts(schedule.startsAt);
  const end = seoulParts(schedule.endsAt);
  return {
    calendarId: schedule.calendarId,
    scheduleTypeId: schedule.scheduleTypeId,
    date: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    allDay: schedule.allDay,
    dogIds: schedule.dogs.map((dog) => dog.id),
    customerIds: schedule.customers.map((customer) => customer.id),
    assigneeIds: schedule.assignees.map((assignee) => assignee.id),
    title: schedule.title,
    memo: schedule.memo ?? "",
  };
};

export function scheduleInputFromForm(
  form: ScheduleForm,
  options: OperationScheduleOptions | null,
): { input: OperationScheduleInput | null; error: string } {
  const calendarId =
    form.calendarId || defaultOperationCalendarId(options?.calendars ?? []);
  const scheduleTypeId =
    form.scheduleTypeId ||
    defaultOperationScheduleTypeId(options?.scheduleTypes ?? []);
  if (
    !calendarId ||
    !scheduleTypeId ||
    !form.date ||
    (!form.allDay &&
      (!form.startTime || !form.endDate || !form.endTime)) ||
    form.assigneeIds.length === 0 ||
    !form.title.trim()
  ) {
    return {
      input: null,
      error: "제목, 날짜, 시간, 담당자를 확인해 주세요.",
    };
  }
  const startsAt = form.allDay
    ? toSeoulInstant(form.date, "00:00")
    : toSeoulInstant(form.date, form.startTime);
  const endsAt = form.allDay
    ? toSeoulInstant(nextSeoulDate(form.date), "00:00")
    : toSeoulInstant(form.endDate, form.endTime);
  if (new Date(endsAt) <= new Date(startsAt)) {
    return {
      input: null,
      error: "종료 시간은 시작 시간보다 늦어야 합니다.",
    };
  }
  return {
    error: "",
    input: {
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
    },
  };
}

const todayCopy = (date: Date) => ({
  fullDate: new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date),
  weekday: new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    weekday: "long",
  }).format(date),
});

export function OperationsTodayPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const localDate = seoulDateKey();
  const { fullDate, weekday } = todayCopy(new Date());
  const [schedules, setSchedules] = useState<OperationSchedule[]>([]);
  const [options, setOptions] = useState<OperationScheduleOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [currentOperationRole, setCurrentOperationRole] =
    useState<OperationRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<OperationScheduleRepositoryError | null>(null);
  const [detail, setDetail] = useState<OperationSchedule | null>(null);
  const [editing, setEditing] = useState<OperationSchedule | "new" | null>(null);
  const [form, setForm] = useState<ScheduleForm>(() => emptyForm());
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning" | "error">("success");

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const scheduleRows = await fetchOperationSchedulesForDay(localDate);
      setSchedules(scheduleRows);
      setDetail((current) =>
        current
          ? scheduleRows.find((schedule) => schedule.id === current.id) ?? null
          : null,
      );
    } catch (error) {
      setSchedules([]);
      setLoadError(
        error instanceof OperationScheduleRepositoryError
          ? error
          : new OperationScheduleRepositoryError(
              "오늘 일정을 불러오지 못했습니다.",
            ),
      );
    } finally {
      setLoading(false);
    }
  }, [localDate]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const optionRows = await fetchOperationScheduleOptions();
      setOptions(optionRows);
      if (profile?.id) {
        setCurrentOperationRole(
          await fetchCurrentOperationRole(profile.id).catch(() => null),
        );
      }
      return optionRows;
    } catch {
      setOptions(null);
      return null;
    } finally {
      setOptionsLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    void loadSchedules();
    void loadOptions();
  }, [loadOptions, loadSchedules]);

  useEffect(() => {
    if (!options) return;
    setSchedules((current) =>
      current.map((schedule) =>
        attachOperationAssigneeColors(schedule, options.assignees),
      ),
    );
    setDetail((current) =>
      current
        ? attachOperationAssigneeColors(current, options.assignees)
        : null,
    );
  }, [options]);

  const showNotice = (
    message: string,
    tone: "success" | "warning" | "error" = "success",
  ) => {
    setNotice(message);
    setNoticeTone(tone);
  };

  const openNew = async () => {
    const availableOptions = options ?? (await loadOptions());
    if (!availableOptions) {
      showNotice("일정 등록 정보를 불러오지 못했습니다. 다시 시도해 주세요.", "error");
      return;
    }
    const initial = emptyForm();
    initial.calendarId = defaultOperationCalendarId(
      availableOptions.calendars,
    );
    initial.scheduleTypeId = defaultOperationScheduleTypeId(
      availableOptions.scheduleTypes.filter((scheduleType) =>
        scheduleType.calendarIds?.includes(initial.calendarId),
      ),
    );
    initial.assigneeIds = profile?.id ? [profile.id] : [];
    setForm(initial);
    setTitleManuallyEdited(false);
    setFormError("");
    setEditing("new");
  };

  const openEdit = (schedule: OperationSchedule) => {
    setForm(formFromSchedule(schedule));
    setTitleManuallyEdited(true);
    setFormError("");
    setDetail(null);
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
        const created = attachOperationAssigneeColors(await createOperationSchedule(
          input,
          crypto.randomUUID(),
        ), options?.assignees ?? []);
        setSchedules((current) =>
          mergeOperationTodaySchedule(current, created, localDate),
        );
        showNotice("새 일정을 등록했습니다.");
      } else if (editing) {
        const updated = attachOperationAssigneeColors(await updateOperationSchedule(
          editing.id,
          editing.version,
          input,
          crypto.randomUUID(),
        ), options?.assignees ?? []);
        setSchedules((current) =>
          mergeOperationTodaySchedule(current, updated, localDate),
        );
        showNotice("일정을 수정했습니다.");
      }
      setEditing(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "일정을 저장하지 못했습니다.";
      setFormError(message);
      if (
        error instanceof OperationScheduleRepositoryError &&
        error.kind === "conflict"
      ) {
        showNotice(message, "warning");
        await loadSchedules();
      }
    } finally {
      setSaving(false);
    }
  };

  const completeSchedule = async (schedule: OperationSchedule) => {
    setSaving(true);
    try {
      const updated = await setOperationScheduleStatus(
        schedule.id,
        schedule.version,
        "completed",
        "일정 완료",
        crypto.randomUUID(),
      );
      setSchedules((current) =>
        mergeOperationTodaySchedule(current, updated, localDate),
      );
      setDetail(null);
      showNotice("일정을 완료 처리했습니다.");
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "일정을 완료하지 못했습니다.",
        "error",
      );
      await loadSchedules();
    } finally {
      setSaving(false);
    }
  };

  const confirmAction = async () => {
    if (!pendingAction || !actionReason.trim()) return;
    setSaving(true);
    try {
      if (pendingAction.type === "cancel") {
        const updated = await setOperationScheduleStatus(
          pendingAction.schedule.id,
          pendingAction.schedule.version,
          "cancelled",
          actionReason.trim(),
          crypto.randomUUID(),
        );
        setSchedules((current) =>
          mergeOperationTodaySchedule(current, updated, localDate),
        );
        showNotice("일정을 취소했습니다.");
      } else {
        const updated = await archiveOperationSchedule(
          pendingAction.schedule.id,
          pendingAction.schedule.version,
          actionReason.trim(),
          crypto.randomUUID(),
        );
        setSchedules((current) =>
          mergeOperationTodaySchedule(current, updated, localDate),
        );
        showNotice("일정을 보관했습니다.");
      }
      setPendingAction(null);
      setActionReason("");
      setDetail(null);
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "일정을 처리하지 못했습니다.",
        "error",
      );
      await loadSchedules();
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    return calculateOperationTodaySummary(schedules);
  }, [schedules]);
  const orderedSchedules = useMemo(
    () => sortOperationSchedulesForViewer(schedules, profile?.id),
    [profile?.id, schedules],
  );
  const canManageSchedule = useCallback(
    (schedule: OperationSchedule) =>
      canManageOperationSchedule(
        schedule,
        profile?.id,
        currentOperationRole,
      ),
    [currentOperationRole, profile?.id],
  );

  const alerts = useMemo(() => {
    const rows: string[] = [];
    const unassigned = schedules.filter((schedule) => schedule.assignees.length === 0).length;
    const pending = schedules.filter((schedule) => schedule.status === "scheduled").length;
    const overdue = schedules.filter(
      (schedule) =>
        schedule.status === "scheduled" &&
        !schedule.allDay &&
        new Date(schedule.endsAt) < new Date(),
    ).length;
    if (unassigned) rows.push(`담당자 미지정 일정 ${unassigned}건`);
    if (overdue) rows.push(`완료 처리 확인 일정 ${overdue}건`);
    if (pending) rows.push(`미완료 일정 ${pending}건`);
    return rows;
  }, [schedules]);

  return (
    <section className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">{fullDate}</p>
          <h1 className="mt-1 text-[clamp(1.75rem,4vw,2.5rem)] font-bold tracking-[-0.045em] text-text-primary">
            {weekday}, 오늘의 일정
          </h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            오늘 오는 반려견과 해야 할 일을 한눈에 확인하세요.
          </p>
        </div>
        <Button
          onClick={() => void openNew()}
          disabled={optionsLoading}
        >
          <Plus aria-hidden="true" size={18} />
          새 일정
        </Button>
      </header>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1.65fr)_minmax(17rem,0.85fr)] lg:gap-6">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-lg font-bold tracking-[-0.025em] text-text-primary">
                오늘 일정
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                종일 일정 이후 시간순으로 표시합니다
              </p>
            </div>
            <span className="tabular-nums text-sm font-semibold text-text-secondary">
              {schedules.length}건
            </span>
          </div>
          {loading ? (
            <LoadingState />
          ) : loadError ? (
            <ErrorState
              title={
                loadError.kind === "permission"
                  ? "Operations 일정 조회 권한이 없습니다."
                  : loadError.message
              }
              retry={() => void loadSchedules()}
            />
          ) : schedules.length ? (
            <ol className="divide-y divide-border/80">
              {orderedSchedules.map((schedule) => (
                <li key={schedule.id}>
                  <ScheduleRow
                    schedule={schedule}
                    currentUserId={profile?.id}
                    onOpen={() => setDetail(schedule)}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <div className="pb-5">
              <EmptyState
                title="오늘 등록된 일정이 없습니다"
                description="새 일정을 등록하면 시간순으로 표시됩니다."
              />
              <div className="-mt-4 flex justify-center">
                <Button
                  onClick={() => void openNew()}
                  disabled={optionsLoading}
                >
                  <Plus size={17} /> 새 일정 등록
                </Button>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-5" role="complementary" aria-label="오늘 요약과 운영 알림">
          <TodaySummary total={summary.total} counts={summary.counts} />
          <TodayAlerts alerts={alerts} />
        </div>
      </div>

      <ScheduleFormModal
        open={editing !== null}
        editing={editing}
        form={form}
        options={options}
        error={formError}
        saving={saving}
        recentScope={profile?.id ?? "current-user"}
        titleManuallyEdited={titleManuallyEdited}
        onTitleManuallyEdited={setTitleManuallyEdited}
        onChange={setForm}
        onSubmit={save}
        onClose={() => !saving && setEditing(null)}
        currentUserName={profile?.name}
      />

      <ScheduleDetailModal
        schedule={detail}
        processing={saving}
        onClose={() => !saving && setDetail(null)}
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
        onOpenDog={(dogId) =>
          navigate(
            `/operations/customers?dogId=${encodeURIComponent(dogId)}`,
          )
        }
        onOpenCustomer={(customerId) =>
          navigate(
            `/operations/customers?customerId=${encodeURIComponent(customerId)}`,
          )
        }
        canManage={detail ? canManageSchedule(detail) : false}
      />

      <Modal
        open={pendingAction !== null}
        title={pendingAction?.type === "cancel" ? "일정 취소" : "일정 보관"}
        onClose={() => !saving && setPendingAction(null)}
      >
        <p className="text-sm leading-6 text-text-secondary">
          {pendingAction?.type === "cancel"
            ? "취소된 일정은 Today 기본 목록에서 제외되며 이력은 유지됩니다."
            : "잘못 등록했거나 숨길 일정만 보관하세요. 물리 삭제되지 않습니다."}
        </p>
        <div className="mt-4">
          <Field label="사유" required>
            <Textarea
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder="변경 사유를 입력하세요"
            />
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" disabled={saving} onClick={() => setPendingAction(null)}>
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

function ScheduleRow({
  schedule,
  currentUserId,
  onOpen,
}: {
  schedule: OperationSchedule;
  currentUserId?: string | null;
  onOpen: () => void;
}) {
  const primaryAssignee = schedulePrimaryAssignee(schedule);
  const secondaryAssignees = schedule.assignees.filter(
    (assignee) => assignee.id !== primaryAssignee?.id,
  );
  const primaryAssigneeColor = primaryAssignee
    ? operationPersonColor(primaryAssignee)
    : DEFAULT_OPERATION_SCHEDULE_COLOR;
  const isMine = isOperationScheduleAssignedTo(schedule, currentUserId);
  const completed = schedule.status === "completed";
  const cancelled = schedule.status === "cancelled";
  const time = schedule.allDay
    ? "종일"
    : new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(schedule.startsAt));
  return (
    <button
      type="button"
      aria-label={`${schedule.title} 일정 상세 보기`}
      onClick={onOpen}
      className={cn(
        "group relative grid w-full grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-3 border-l-[3px] px-4 py-4 text-left transition hover:bg-surface-secondary/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:px-5",
        isMine && "bg-primary-soft/35",
        completed && "bg-surface-secondary/30 opacity-70",
        cancelled && "bg-surface-secondary/20 opacity-55",
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: schedule.calendarColor }}
      />
      <time
        className={cn(
          "self-start pt-0.5 text-base font-bold tabular-nums",
          completed || cancelled ? "text-text-muted" : "text-text-primary",
        )}
      >
        {time}
      </time>
      <div className="min-w-0">
        <p
          className={cn(
            "flex min-w-0 items-center gap-1.5 truncate font-semibold transition group-hover:text-primary",
            completed || cancelled
              ? "text-text-secondary"
              : "text-text-primary",
            cancelled && "line-through",
          )}
        >
          {completed && (
            <CheckCircle2
              aria-label="완료"
              size={14}
              className="shrink-0 text-text-muted"
            />
          )}
          {cancelled && (
            <CircleX
              aria-label="취소"
              size={14}
              className="shrink-0 text-text-muted"
            />
          )}
          <span className={cn("truncate", isMine && "font-bold")}>
            {schedule.title}
          </span>
          {isMine && (
            <Badge tone="blue">
              내 일정
            </Badge>
          )}
        </p>
        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-text-secondary">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ring-2 ring-white"
              style={{ backgroundColor: primaryAssigneeColor }}
            />
            <span className="truncate">
              {primaryAssignee
                ? operationPersonDisplayName(primaryAssignee)
                : "담당자 미정"}
            </span>
            {secondaryAssignees.map((assignee) => (
              <span
                key={assignee.id}
                aria-label={`${operationPersonDisplayName(assignee)} 색상`}
                title={operationPersonDisplayName(assignee)}
                className="h-2 w-2 shrink-0 rounded-full border border-white shadow-sm"
                style={{
                  backgroundColor:
                    operationPersonColor(assignee),
                }}
              />
            ))}
          </span>
        </div>
      </div>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl text-text-muted transition group-hover:bg-primary-soft group-hover:text-primary">
        <ChevronRight size={18} />
      </span>
    </button>
  );
}

function TodaySummary({
  total,
  counts,
}: {
  total: number;
  counts: { daycare: number; training: number; hotel: number; common: number };
}) {
  const rows = [
    ["유치원", counts.daycare, "#52B8D0"],
    ["교육센터", counts.training, "#4568B2"],
    ["호텔", counts.hotel, "#C99845"],
    ["공통", counts.common, "#5B7FA3"],
  ] as const;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-text-muted">오늘 요약</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-[-0.04em] text-text-primary">
            {total}
            <span className="ml-1 text-sm font-semibold text-text-secondary">건</span>
          </p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Clock3 size={19} />
        </span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-2.5">
        {rows.map(([label, count, color]) => (
          <div key={label} className="rounded-xl border border-border bg-surface-secondary/65 px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
              {label}
            </dt>
            <dd className="mt-1 font-bold tabular-nums text-text-primary">{count}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function TodayAlerts({ alerts }: { alerts: string[] }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-text-primary">오늘 확인</h2>
          <p className="mt-1 text-xs text-text-muted">일정에서 자동 계산한 운영 알림</p>
        </div>
        <ClipboardCheck size={19} className="text-text-muted" />
      </div>
      {alerts.length ? (
        <ul className="mt-4 space-y-1">
          {alerts.map((alert) => (
            <li key={alert} className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm text-text-secondary">
              <span className="h-2 w-2 rounded-full bg-warning" />
              {alert}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-success-soft px-3 py-3 text-sm text-success">
          <CheckCircle2 size={17} /> 확인이 필요한 일정이 없습니다.
        </div>
      )}
    </Card>
  );
}

export function ScheduleFormModal({
  open,
  editing,
  form,
  options,
  error,
  saving,
  recentScope,
  titleManuallyEdited,
  onTitleManuallyEdited,
  onChange,
  onSubmit,
  onClose,
  currentUserName,
}: {
  open: boolean;
  editing: OperationSchedule | "new" | null;
  form: ScheduleForm;
  options: OperationScheduleOptions | null;
  error: string;
  saving: boolean;
  recentScope: string;
  titleManuallyEdited: boolean;
  onTitleManuallyEdited: (value: boolean) => void;
  onChange: (value: ScheduleForm) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  currentUserName?: string | null;
}) {
  const patch = (values: Partial<ScheduleForm>) => onChange({ ...form, ...values });
  const patchWithAutoTitle = (values: Partial<ScheduleForm>) => {
    const nextForm = { ...form, ...values };
    if (editing === "new" && !titleManuallyEdited) {
      const dogName = options?.dogs.find(
        (dog) => dog.id === nextForm.dogIds[0],
      )?.name;
      const scheduleTypeName = options?.scheduleTypes.find(
        (scheduleType) => scheduleType.id === nextForm.scheduleTypeId,
      )?.name;
      nextForm.title = defaultOperationScheduleTitle(
        dogName,
        scheduleTypeName,
      );
    }
    onChange(nextForm);
  };
  const customerById = new Map(
    (options?.customers ?? []).map((customer) => [customer.id, customer]),
  );
  const dogsByCustomer = new Map<string, string[]>();
  (options?.dogs ?? []).forEach((dog) => {
    if (dog.customerId) {
      dogsByCustomer.set(dog.customerId, [
        ...(dogsByCustomer.get(dog.customerId) ?? []),
        dog.name,
      ]);
    }
  });
  const changeDogs = (dogIds: string[]) => {
    const customerIds = suggestOperationCustomerIds(
      form.customerIds,
      form.dogIds,
      dogIds,
      options?.dogs ?? [],
    );
    patchWithAutoTitle({ dogIds, customerIds });
  };
  const creatorName =
    editing === "new"
      ? currentUserName
      : editing
        ? editing.createdByName
        : null;
  return (
    <Modal
      open={open}
      title={editing === "new" ? "새 일정" : "일정 수정"}
      onClose={onClose}
      wide
      resetKey={editing === "new" ? "new" : editing?.id}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <>
          <div className="grid gap-4 sm:grid-cols-2">
              <Field label="캘린더" required>
                <Select value={form.calendarId} onChange={(event) => patchWithAutoTitle({ calendarId: event.target.value, scheduleTypeId: "" })}>
                  <option value="">캘린더 선택</option>
                  {options?.calendars.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              <Field label="일정 유형">
                <Select value={form.scheduleTypeId} disabled={!form.calendarId} onChange={(event) => patchWithAutoTitle({ scheduleTypeId: event.target.value })}>
                  <option value="">선택 안 함 · 기타로 저장</option>
                  {options?.scheduleTypes.filter((row) => row.calendarIds?.includes(form.calendarId)).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
          </div>
          <Field label="제목" required>
              <Input
                required
                value={form.title}
                onChange={(event) => {
                  onTitleManuallyEdited(true);
                  patch({ title: event.target.value });
                }}
                placeholder="반려견과 일정 유형을 선택하면 자동 입력됩니다"
              />
          </Field>
        </>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="날짜" required>
            <Input
              required
              type="date"
              value={form.date}
              onChange={(event) => {
                const date = event.target.value;
                if (!date) {
                  patch({ date: "", endDate: "" });
                  return;
                }
                patch({
                  date,
                  endDate:
                    form.endDate === form.date
                      ? date
                      : nextSeoulDate(date),
                });
              }}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-border px-3.5 text-sm font-medium text-text-primary">
            <input type="checkbox" checked={form.allDay} onChange={(event) => patch({ allDay: event.target.checked })} />
            종일 일정
          </label>
          <>
            <div className={cn(form.allDay && "opacity-50")}>
              <Field label="시작 시간" required={!form.allDay}>
                <Input
                  required={!form.allDay}
                  disabled={form.allDay}
                  type="time"
                  value={form.startTime}
                  onChange={(event) => {
                    const startTime = event.target.value;
                    const nextEnd = oneHourScheduleEnd(form.date, startTime);
                    patch({
                      startTime,
                      endDate: nextEnd.endDate,
                      endTime: nextEnd.endTime,
                    });
                  }}
                />
              </Field>
            </div>
            <div className={cn(form.allDay && "opacity-50")}>
              <Field label="종료 시간" required={!form.allDay}>
                <Input
                  required={!form.allDay}
                  disabled={form.allDay}
                  type="time"
                  value={form.endTime}
                  onChange={(event) => {
                    const endTime = event.target.value;
                    patch({
                      endTime,
                      endDate:
                        form.date &&
                        endTime &&
                        endTime <= form.startTime
                          ? nextSeoulDate(form.date)
                          : form.date,
                    });
                  }}
                />
              </Field>
            </div>
          </>
        </div>
        <div className="rounded-xl border border-border bg-surface-secondary px-3.5 py-3">
          <p className="text-xs font-semibold text-text-muted">등록자</p>
          <p className="mt-1 text-sm font-semibold text-text-primary">
            {creatorName?.trim() || "현재 로그인 사용자"}
            <span className="ml-1.5 font-normal text-text-muted">
              · 자동 기록
            </span>
          </p>
        </div>
        <SearchSelect
          label="담당자"
          required
          items={options?.assignees ?? []}
          selectedIds={form.assigneeIds}
          onChange={(assigneeIds) => patch({ assigneeIds })}
          multiple
          showAllOnEmpty
          getItemId={(row) => row.id}
          getSearchText={(row) =>
            `${row.name ?? ""} ${row.operationRole ?? ""}`
          }
          renderOption={(row) => (
            <span className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: operationPersonColor(row) }}
              />
              <span className="min-w-0">
                <strong className="block truncate text-sm text-text-primary">
                  {operationPersonDisplayName(row)}
                </strong>
                {row.operationRole && (
                  <span className="mt-0.5 block text-xs text-text-muted">
                    {row.operationRole === "owner"
                      ? "최고 관리자"
                      : row.operationRole === "manager"
                        ? "관리자"
                        : "직원"}
                  </span>
                )}
              </span>
            </span>
          )}
          renderSelected={(row) => (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: operationPersonColor(row) }}
              />
              {operationPersonDisplayName(row)}
            </span>
          )}
          placeholder="담당자 이름 검색"
          emptyMessage="활성 담당자가 없습니다."
          recentStorageKey={`pm-os:${recentScope}:schedule-staff`}
        />
        <SearchSelect
          label="반려견"
          items={options?.dogs ?? []}
          selectedIds={form.dogIds}
          onChange={changeDogs}
          multiple
          getItemId={(row) => row.id}
          getSearchText={(row) => {
            const customer = customerById.get(row.customerId ?? "");
            return `${row.name} ${customer?.name ?? ""} ${customer?.phone ?? ""}`;
          }}
          renderOption={(row) => {
            const customer = customerById.get(row.customerId ?? "");
            const profileLine = operationDogProfileLine(row);
            const ownerLine = [
              customer?.name?.trim() || "",
              formatPhoneForDisplay(customer?.phone),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <Dog size={18} />
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm text-text-primary">
                    {row.name}
                  </strong>
                  {profileLine && (
                    <span className="mt-0.5 block truncate text-xs text-text-secondary">
                      {profileLine}
                    </span>
                  )}
                  {ownerLine && (
                    <span className="mt-0.5 block truncate text-xs text-text-muted">
                      {ownerLine}
                    </span>
                  )}
                </span>
              </span>
            );
          }}
          renderSelected={(row) => (
            <span className="inline-flex items-center gap-1.5">
              <Dog aria-hidden="true" size={14} />
              {row.name}
            </span>
          )}
          placeholder="반려견, 보호자 또는 전화번호 검색"
          emptyMessage="최근 선택한 반려견이 없습니다."
          recentStorageKey={`pm-os:${recentScope}:schedule-dogs`}
        />
        <SearchSelect
            label="보호자"
            items={options?.customers ?? []}
            selectedIds={form.customerIds}
            onChange={(customerIds) => patch({ customerIds })}
            getItemId={(row) => row.id}
            getSearchText={(row) =>
              `${row.name ?? ""} ${row.phone ?? ""} ${(dogsByCustomer.get(row.id) ?? []).join(" ")}`
            }
            renderOption={(row) => (
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <UserRound size={18} />
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm text-text-primary">
                    {row.name || "이름 미등록"}
                  </strong>
                  <span className="mt-0.5 block truncate text-xs text-text-muted">
                    {(dogsByCustomer.get(row.id) ?? []).join(", ") ||
                      "연결된 반려견 없음"}{" "}
                    · {formatPhoneForDisplay(row.phone) || "전화번호 미등록"}
                  </span>
                </span>
              </span>
            )}
            renderSelected={(row) => row.name || "이름 미등록"}
            placeholder="보호자, 전화번호 또는 반려견 검색"
            emptyMessage="최근 선택한 보호자가 없습니다."
            recentStorageKey={`pm-os:${recentScope}:schedule-customers`}
        />
        <Field label="메모">
          <Textarea
            rows={2}
            value={form.memo}
            className="min-h-[4.5rem] resize-none overflow-hidden"
            onInput={(event) => {
              const element = event.currentTarget;
              element.style.height = "auto";
              element.style.height = `${element.scrollHeight}px`;
            }}
            onChange={(event) => patch({ memo: event.target.value })}
            placeholder="필요한 내용을 기록하세요"
          />
        </Field>
        {error && <p role="alert" className="rounded-xl bg-error-soft px-3 py-2 text-sm text-error">{error}</p>}
        <div className="sticky -bottom-5 z-20 -mx-5 -mb-5 flex justify-end gap-2 border-t border-border bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] sm:static sm:mx-0 sm:mb-0 sm:border-0 sm:p-0 sm:shadow-none">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>닫기</Button>
          <Button type="submit" disabled={saving}>{saving ? "저장 중..." : "저장"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function ScheduleDetailModal({
  schedule,
  processing,
  onClose,
  onEdit,
  onComplete,
  onCancel,
  onArchive,
  onOpenDog,
  onOpenCustomer,
  archiveLabel = "보관",
  canManage = true,
}: {
  schedule: OperationSchedule | null;
  processing: boolean;
  onClose: () => void;
  onEdit: (schedule: OperationSchedule) => void;
  onComplete: (schedule: OperationSchedule) => void;
  onCancel: (schedule: OperationSchedule) => void;
  onArchive: (schedule: OperationSchedule) => void;
  onOpenDog: (id: string) => void;
  onOpenCustomer: (id: string) => void;
  archiveLabel?: string;
  canManage?: boolean;
}) {
  if (!schedule) return null;
  const start = seoulParts(schedule.startsAt);
  const end = seoulParts(schedule.endsAt);
  return (
    <Modal open title="일정 상세" onClose={onClose} wide resetKey={schedule.id}>
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="gray">
              {schedule.status === "completed"
                ? "완료"
                : schedule.status === "cancelled"
                  ? "취소"
                  : "예정"}
            </Badge>
            <Badge>{schedule.calendarName}</Badge>
            <Badge>{schedule.scheduleTypeName}</Badge>
          </div>
          <h3 className="mt-3 text-2xl font-bold tracking-[-0.03em] text-text-primary">{schedule.title}</h3>
          <p className="mt-2 text-sm text-text-secondary">
            {start.date} · {schedule.allDay ? "종일" : `${start.time}–${end.time}`}
          </p>
        </div>
        {canManage && schedule.status !== "cancelled" && (
          <Button variant="secondary" onClick={() => onEdit(schedule)}><Pencil size={16} />수정</Button>
        )}
      </div>
      <p className="mt-4 text-sm font-medium text-text-secondary">
        담당 {compactNames(schedule.assignees, "미지정")}
        <span className="mx-1.5 text-text-muted">·</span>
        등록 {schedule.createdByName || "이름 미등록"}
      </p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <Detail label="담당자" value={compactNames(schedule.assignees, "미지정")} />
        <Detail label="생성자" value={schedule.createdByName || "이름 미등록"} />
        <Detail label="사업부" value={schedule.calendarName} />
        <Detail label="마지막 수정" value={new Date(schedule.updatedAt).toLocaleString("ko-KR")} />
      </dl>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <LinkList title="반려견" rows={schedule.dogs} empty="연결된 반려견 없음" onOpen={onOpenDog} />
        <LinkList title="보호자" rows={schedule.customers} empty="연결된 보호자 없음" onOpen={onOpenCustomer} />
      </div>
      {schedule.memo && (
        <div className="mt-5 rounded-xl bg-surface-secondary p-4">
          <p className="text-xs font-semibold text-text-muted">메모</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-primary">{schedule.memo}</p>
        </div>
      )}
      {canManage && (
        <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-border pt-5">
          <Button variant="ghost" disabled={processing} onClick={() => onArchive(schedule)}>{archiveLabel}</Button>
        <div className="flex flex-wrap gap-2">
          {schedule.status !== "cancelled" && (
            <Button variant="secondary" disabled={processing} onClick={() => onCancel(schedule)}>취소</Button>
          )}
          {schedule.status === "scheduled" && (
            <Button disabled={processing} onClick={() => onComplete(schedule)}>완료 처리</Button>
          )}
        </div>
        </div>
      )}
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold text-text-muted">{label}</dt><dd className="mt-1 text-sm font-medium text-text-primary">{value}</dd></div>;
}

function LinkList<T extends { id: string; name: string | null }>({
  title,
  rows,
  empty,
  onOpen,
}: {
  title: string;
  rows: T[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted">{title}</p>
      {rows.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {rows.map((row) => (
            <button key={row.id} type="button" onClick={() => onOpen(row.id)} className="rounded-full bg-primary-soft px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/15">
              {row.name || "이름 미등록"}
            </button>
          ))}
        </div>
      ) : <p className="mt-2 text-sm text-text-muted">{empty}</p>}
    </div>
  );
}
