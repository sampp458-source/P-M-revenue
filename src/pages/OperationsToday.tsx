import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  MoreHorizontal,
  Pencil,
  Plus,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
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
  ModalActions,
  Select,
  Textarea,
  Toast,
  cn,
} from "../components/ui";
import { SearchSelect } from "../components/SearchSelect";
import { CustomerDogSearchFields } from "../components/CustomerDogSearchFields";
import {
  createHotelReservation,
  fetchHotelOperationsSnapshot,
  fetchHotelStay,
  type HotelOperationsSnapshot,
  type HotelReservationInput,
  type HotelStay,
} from "./hotelOperationsRepository";
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
  isHotelReservationSchedule,
  isLegacyHotelSchedule,
  isOperationScheduleAssignedTo,
  isOperationScheduleConflictError,
  mergeOperationTodaySchedule,
  nextSeoulDate,
  oneHourScheduleEnd,
  operationPersonColor,
  operationPersonDisplayName,
  operationScheduleDisplayTitle,
  operationScheduleTimeLabel,
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
import { LegacyHotelConversionModal } from "./LegacyHotelConversionModal";

export interface ScheduleForm {
  hotelScheduleMode: "reservation" | "operation";
  calendarId: string;
  scheduleTypeId: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  timeUnspecified: boolean;
  dogIds: string[];
  customerIds: string[];
  assigneeIds: string[];
  title: string;
  memo: string;
  hotelRoomTypeId: string;
  hotelCheckInTimeUnspecified: boolean;
  hotelCheckOutDate: string;
  hotelCheckOutTime: string;
  hotelCheckOutTimeUnspecified: boolean;
}

export type CalendarCreateProduct = "hotel" | "daycare" | "long-stay" | "general";

interface PendingAction {
  type: "cancel" | "archive";
  schedule: OperationSchedule;
}

export const emptyForm = (): ScheduleForm => {
  const scheduleWindow = defaultOperationScheduleWindow();
  return {
    hotelScheduleMode: "operation",
    calendarId: "",
    scheduleTypeId: "",
    ...scheduleWindow,
    allDay: false,
    timeUnspecified: false,
    dogIds: [],
    customerIds: [],
    assigneeIds: [],
    title: "",
    memo: "",
    hotelRoomTypeId: "",
    hotelCheckInTimeUnspecified: false,
    hotelCheckOutDate: scheduleWindow.endDate,
    hotelCheckOutTime: "11:00",
    hotelCheckOutTimeUnspecified: false,
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
    hotelScheduleMode: "operation",
    calendarId: schedule.calendarId,
    scheduleTypeId: schedule.scheduleTypeId,
    date: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    allDay: schedule.allDay,
    timeUnspecified: schedule.timeUnspecified,
    dogIds: schedule.dogs.map((dog) => dog.id),
    customerIds: schedule.customers.map((customer) => customer.id),
    assigneeIds: schedule.assignees.map((assignee) => assignee.id),
    title: schedule.title,
    memo: schedule.memo ?? "",
    hotelRoomTypeId: "",
    hotelCheckInTimeUnspecified: false,
    hotelCheckOutDate: end.date,
    hotelCheckOutTime: end.time,
    hotelCheckOutTimeUnspecified: false,
  };
};

export const HOTEL_SCHEDULE_TYPE_NAME = "입실·퇴실";

export function selectedOperationCalendar(
  calendarId: string,
  options: OperationScheduleOptions | null,
) {
  return options?.calendars.find((calendar) => calendar.id === calendarId) ?? null;
}

export function isHotelScheduleCalendar(
  calendarId: string,
  options: OperationScheduleOptions | null,
) {
  return selectedOperationCalendar(calendarId, options)?.businessUnitCode === "hotel";
}

export function hotelScheduleTypeForCalendar(
  calendarId: string,
  options: OperationScheduleOptions | null,
) {
  if (!isHotelScheduleCalendar(calendarId, options)) return null;
  return options?.scheduleTypes.find(
    (scheduleType) =>
      scheduleType.name.trim() === HOTEL_SCHEDULE_TYPE_NAME &&
      scheduleType.calendarIds?.includes(calendarId),
  ) ?? null;
}

export function initializeHotelScheduleForm(
  form: ScheduleForm,
  options: OperationScheduleOptions,
  snapshot: HotelOperationsSnapshot,
  initialCalendarId?: string,
): ScheduleForm {
  const calendar = options.calendars.find(
    (item) =>
      item.businessUnitCode === "hotel" &&
      (!initialCalendarId || item.id === initialCalendarId),
  );
  const calendarId = calendar?.id ?? "";
  const scheduleTypeId =
    hotelScheduleTypeForCalendar(calendarId, options)?.id ?? "";
  return {
    ...form,
    hotelScheduleMode: "reservation",
    calendarId,
    scheduleTypeId,
    allDay: false,
    timeUnspecified: false,
    hotelCheckInTimeUnspecified: false,
    startTime:
      snapshot.settings?.defaultCheckInTime.slice(0, 5) || form.startTime,
    hotelCheckOutDate: nextSeoulDate(form.date),
    hotelCheckOutTime:
      snapshot.settings?.defaultCheckOutTime.slice(0, 5) || "11:00",
    hotelRoomTypeId: snapshot.roomTypes[0]?.id ?? "",
    hotelCheckOutTimeUnspecified: false,
    dogIds: form.dogIds.slice(0, 1),
    customerIds: form.customerIds.slice(0, 1),
  };
}

export function transitionScheduleFormCalendar(
  form: ScheduleForm,
  calendarId: string,
  options: OperationScheduleOptions,
  snapshot: HotelOperationsSnapshot | null,
): ScheduleForm {
  if (isHotelScheduleCalendar(calendarId, options)) {
    if (snapshot) {
      return initializeHotelScheduleForm(
        { ...form, calendarId },
        options,
        snapshot,
        calendarId,
      );
    }
    return {
      ...form,
      hotelScheduleMode: "reservation",
      calendarId,
      scheduleTypeId:
        hotelScheduleTypeForCalendar(calendarId, options)?.id ?? "",
      allDay: false,
      timeUnspecified: false,
      hotelCheckInTimeUnspecified: false,
      hotelRoomTypeId: "",
      hotelCheckOutDate: nextSeoulDate(form.date),
      hotelCheckOutTimeUnspecified: false,
      dogIds: form.dogIds.slice(0, 1),
      customerIds: form.customerIds.slice(0, 1),
    };
  }
  const allowedTypes = options.scheduleTypes.filter((scheduleType) =>
    scheduleType.calendarIds?.includes(calendarId),
  );
  return {
    ...form,
    hotelScheduleMode: "operation",
    calendarId,
    scheduleTypeId: defaultOperationScheduleTypeId(allowedTypes),
    hotelRoomTypeId: "",
    hotelCheckInTimeUnspecified: false,
    hotelCheckOutDate: "",
    hotelCheckOutTime: "",
    hotelCheckOutTimeUnspecified: false,
  };
}

export function hotelReservationInputFromForm(
  form: ScheduleForm,
  options: OperationScheduleOptions | null,
  snapshot: HotelOperationsSnapshot | null,
): { input: HotelReservationInput | null; error: string } {
  if (
    !isHotelScheduleCalendar(form.calendarId, options) ||
    form.hotelScheduleMode !== "reservation"
  ) {
    return { input: null, error: "호텔 캘린더를 선택해 주세요." };
  }
  if (!snapshot) {
    return {
      input: null,
      error: "호텔 객실 유형과 기본 시간을 불러오지 못했습니다.",
    };
  }
  const hotelScheduleType = hotelScheduleTypeForCalendar(
    form.calendarId,
    options,
  );
  if (!hotelScheduleType || form.scheduleTypeId !== hotelScheduleType.id) {
    return {
      input: null,
      error: "호텔 캘린더의 입실·퇴실 일정 유형을 확인해 주세요.",
    };
  }
  const missingFields = [
    !form.date && "입실 날짜",
    !form.hotelCheckInTimeUnspecified && !form.startTime && "입실 시간",
    !form.hotelCheckOutDate && "퇴실 날짜",
    !form.hotelCheckOutTimeUnspecified && !form.hotelCheckOutTime && "퇴실 시간",
    form.dogIds.length !== 1 && "반려견",
    form.customerIds.length !== 1 && "보호자",
    form.assigneeIds.length === 0 && "담당자",
  ].filter(Boolean) as string[];
  if (missingFields.length > 0) {
    return {
      input: null,
      error: `${missingFields.join(", ")}을(를) 확인해 주세요.`,
    };
  }
  const selectedDog = options?.dogs.find((dog) => dog.id === form.dogIds[0]);
  if (
    selectedDog?.customerId &&
    selectedDog.customerId !== form.customerIds[0]
  ) {
    return {
      input: null,
      error: "선택한 반려견과 연결된 보호자를 확인해 주세요.",
    };
  }
  if (form.hotelCheckOutDate < form.date) {
    return {
      input: null,
      error: "퇴실 날짜는 입실 날짜보다 빠를 수 없습니다.",
    };
  }
  if (
    form.hotelCheckOutDate === form.date &&
    !form.hotelCheckInTimeUnspecified &&
    !form.hotelCheckOutTimeUnspecified &&
    form.hotelCheckOutTime <= form.startTime
  ) {
    return {
      input: null,
      error: "같은 날 예약의 퇴실 시간은 입실 시간보다 늦어야 합니다.",
    };
  }
  return {
    error: "",
    input: {
      calendarId: form.calendarId,
      scheduleTypeId: form.scheduleTypeId,
      checkInDate: form.date,
      checkInTime: form.hotelCheckInTimeUnspecified ? null : form.startTime,
      checkInTimeUnspecified: form.hotelCheckInTimeUnspecified,
      checkOutDate: form.hotelCheckOutDate,
      checkOutTime: form.hotelCheckOutTimeUnspecified
        ? null
        : form.hotelCheckOutTime,
      checkOutTimeUnspecified: form.hotelCheckOutTimeUnspecified,
      roomTypeId: form.hotelRoomTypeId || null,
      dogId: form.dogIds[0],
      customerId: form.customerIds[0],
      assigneeIds: form.assigneeIds,
      memo: form.memo.trim(),
    },
  };
}

export function scheduleInputFromForm(
  form: ScheduleForm,
  options: OperationScheduleOptions | null,
): { input: OperationScheduleInput | null; error: string } {
  if (form.allDay && form.timeUnspecified) {
    return {
      input: null,
      error: "종일 일정과 시간 미정은 동시에 선택할 수 없습니다.",
    };
  }
  const calendarId =
    form.calendarId || defaultOperationCalendarId(options?.calendars ?? []);
  const scheduleTypeId =
    form.scheduleTypeId ||
    defaultOperationScheduleTypeId(options?.scheduleTypes ?? []);
  const missingFields = [
    !calendarId && "캘린더",
    !scheduleTypeId && "일정 유형",
    !form.title.trim() && "제목",
    !form.date && "날짜",
    !form.allDay && !form.timeUnspecified && !form.startTime && "시작 시간",
    !form.allDay && !form.timeUnspecified && !form.endTime && "종료 시간",
    form.assigneeIds.length === 0 && "담당자",
  ].filter(Boolean) as string[];
  if (missingFields.length > 0) {
    return {
      input: null,
      error: `${missingFields.join(", ")}을(를) 확인해 주세요.`,
    };
  }
  const technicalStartTime = form.startTime || "12:00";
  const technicalEnd = oneHourScheduleEnd(form.date, technicalStartTime);
  const confirmedEndDate =
    form.endDate ||
    (form.endTime && form.endTime <= technicalStartTime
      ? nextSeoulDate(form.date)
      : form.date);
  const startsAt = form.allDay
    ? toSeoulInstant(form.date, "00:00")
    : toSeoulInstant(form.date, technicalStartTime);
  const endsAt = form.allDay
    ? toSeoulInstant(nextSeoulDate(form.date), "00:00")
    : form.timeUnspecified
      ? toSeoulInstant(technicalEnd.endDate, technicalEnd.endTime)
      : toSeoulInstant(confirmedEndDate, form.endTime);
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
      timeUnspecified: form.timeUnspecified,
      memo: form.memo.trim(),
      assigneeIds: form.assigneeIds,
      customerIds: form.customerIds,
      dogIds: form.dogIds,
    },
  };
}

export interface NewScheduleCreateDependencies {
  createHotel: (
    input: HotelReservationInput,
    requestId: string,
  ) => Promise<HotelStay>;
  createOperation: (
    input: OperationScheduleInput,
    requestId: string,
  ) => Promise<OperationSchedule>;
}

export type NewScheduleCreateResult =
  | { kind: "hotel"; value: HotelStay }
  | { kind: "operation"; value: OperationSchedule };

export async function createNewScheduleFromForm(
  form: ScheduleForm,
  options: OperationScheduleOptions | null,
  snapshot: HotelOperationsSnapshot | null,
  requestId: string,
  dependencies: NewScheduleCreateDependencies = {
    createHotel: createHotelReservation,
    createOperation: createOperationSchedule,
  },
): Promise<NewScheduleCreateResult> {
  if (
    isHotelScheduleCalendar(form.calendarId, options) &&
    form.hotelScheduleMode === "reservation"
  ) {
    const prepared = hotelReservationInputFromForm(form, options, snapshot);
    if (!prepared.input) throw new Error(prepared.error);
    return {
      kind: "hotel",
      value: await dependencies.createHotel(prepared.input, requestId),
    };
  }
  const prepared = scheduleInputFromForm(form, options);
  if (!prepared.input) throw new Error(prepared.error);
  return {
    kind: "operation",
    value: await dependencies.createOperation(prepared.input, requestId),
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
  const [hotelSnapshot, setHotelSnapshot] =
    useState<HotelOperationsSnapshot | null>(null);
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
  const [hotelManagementGuideOpen, setHotelManagementGuideOpen] =
    useState(false);
  const [hotelManagementStayId, setHotelManagementStayId] =
    useState<string | null>(null);
  const [legacyConversionSchedule, setLegacyConversionSchedule] =
    useState<OperationSchedule | null>(null);
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

  const openHotelManagementGuide = (schedule: OperationSchedule) => {
    setHotelManagementStayId(schedule.hotelStayId ?? null);
    setHotelManagementGuideOpen(true);
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
    setHotelSnapshot(
      await fetchHotelOperationsSnapshot(initial.date).catch(() => null),
    );
    setForm(initial);
    setTitleManuallyEdited(false);
    setFormError("");
    setEditing("new");
  };

  const openEdit = (schedule: OperationSchedule) => {
    if (isHotelReservationSchedule(schedule)) {
      setDetail(null);
      openHotelManagementGuide(schedule);
      return;
    }
    setForm(formFromSchedule(schedule));
    setTitleManuallyEdited(true);
    setFormError("");
    setDetail(null);
    setEditing(schedule);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (editing === "new") {
      setSaving(true);
      try {
        const created = await createNewScheduleFromForm(
          form,
          options,
          hotelSnapshot,
          crypto.randomUUID(),
        );
        if (created.kind === "hotel") {
          await loadSchedules();
          showNotice("호텔 예약과 입·퇴실 일정을 등록했습니다.");
        } else {
          const schedule = attachOperationAssigneeColors(
            created.value,
            options?.assignees ?? [],
          );
          setSchedules((current) =>
            mergeOperationTodaySchedule(current, schedule, localDate),
          );
          showNotice("새 일정을 등록했습니다.");
        }
        setEditing(null);
      } catch (error) {
        setFormError(
          error instanceof Error
            ? error.message
            : "일정을 저장하지 못했습니다.",
        );
      } finally {
        setSaving(false);
      }
      return;
    }
    const prepared = scheduleInputFromForm(form, options);
    if (!prepared.input) {
      setFormError(prepared.error);
      return;
    }
    const input = prepared.input;
    setSaving(true);
    try {
      if (editing) {
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
    if (isHotelReservationSchedule(schedule)) {
      setDetail(null);
      openHotelManagementGuide(schedule);
      return;
    }
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
      const conflict = isOperationScheduleConflictError(error);
      showNotice(
        error instanceof Error ? error.message : "일정을 완료하지 못했습니다.",
        conflict ? "warning" : "error",
      );
      await loadSchedules();
    } finally {
      setSaving(false);
    }
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    if (isHotelReservationSchedule(pendingAction.schedule)) {
      openHotelManagementGuide(pendingAction.schedule);
      setPendingAction(null);
      return;
    }
    const actionReason =
      pendingAction.type === "cancel" ? "일정 취소" : "오등록 일정 삭제";
    setSaving(true);
    try {
      if (pendingAction.type === "cancel") {
        const updated = await setOperationScheduleStatus(
          pendingAction.schedule.id,
          pendingAction.schedule.version,
          "cancelled",
          actionReason,
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
          actionReason,
          crypto.randomUUID(),
        );
        setSchedules((current) =>
          mergeOperationTodaySchedule(current, updated, localDate),
        );
        showNotice("일정을 삭제했습니다.");
      }
      setPendingAction(null);
      setDetail(null);
    } catch (error) {
      const conflict = isOperationScheduleConflictError(error);
      showNotice(
        error instanceof Error ? error.message : "일정을 처리하지 못했습니다.",
        conflict ? "warning" : "error",
      );
      await loadSchedules();
    } finally {
      setSaving(false);
    }
  };

  const returnToScheduleDetail = () => {
    const schedule = pendingAction?.schedule ?? null;
    setPendingAction(null);
    setDetail(schedule);
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
  const openLegacyConversion = async (schedule: OperationSchedule) => {
    setDetail(null);
    setLegacyConversionSchedule(schedule);
    setHotelSnapshot(
      await fetchHotelOperationsSnapshot(seoulParts(schedule.startsAt).date).catch(
        () => null,
      ),
    );
  };

  const alerts = useMemo(() => {
    const rows: string[] = [];
    const unassigned = schedules.filter((schedule) => schedule.assignees.length === 0).length;
    const pending = schedules.filter((schedule) => schedule.status === "scheduled").length;
    const overdue = schedules.filter(
      (schedule) =>
        schedule.status === "scheduled" &&
        !schedule.allDay &&
        !schedule.timeUnspecified &&
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
                종일 일정, 시간 확정 일정, 시간 미정 순으로 표시합니다
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
            <ol className="grid gap-2.5 bg-surface-secondary/55 p-3 sm:p-4">
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
                description="새 일정을 등록하면 시간 확정 일정부터 표시됩니다."
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
        hotelSnapshot={hotelSnapshot}
      />

      <ScheduleDetailModal
        schedule={detail}
        processing={saving}
        onClose={() => !saving && setDetail(null)}
        onEdit={openEdit}
        onComplete={(schedule) => void completeSchedule(schedule)}
        onCancel={(schedule) => {
          if (isHotelReservationSchedule(schedule)) {
            setDetail(null);
            openHotelManagementGuide(schedule);
            return;
          }
          setPendingAction({ type: "cancel", schedule });
          setDetail(null);
        }}
        onArchive={(schedule) => {
          if (isHotelReservationSchedule(schedule)) {
            setDetail(null);
            openHotelManagementGuide(schedule);
            return;
          }
          setPendingAction({ type: "archive", schedule });
          setDetail(null);
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
        showLegacyHotelConversion={Boolean(
          detail &&
          isLegacyHotelSchedule(detail) &&
          (currentOperationRole === "owner" || currentOperationRole === "manager"),
        )}
        onConvertToHotel={(schedule) => void openLegacyConversion(schedule)}
      />

      <Modal
        open={pendingAction !== null}
        title={
          pendingAction?.type === "cancel"
            ? "이 일정을 취소할까요?"
            : "이 일정을 삭제할까요?"
        }
        onClose={() => !saving && returnToScheduleDetail()}
      >
        <p className="text-sm leading-6 text-text-secondary">
          {pendingAction?.type === "cancel"
            ? "취소된 일정은 기록에 남으며 필요하면 다시 상태를 변경할 수 있습니다."
            : "삭제된 일정은 오늘과 캘린더에서 표시되지 않습니다."}
        </p>
        <ModalActions>
          <Button variant="secondary" disabled={saving} onClick={returnToScheduleDetail}>
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
        </ModalActions>
      </Modal>

      <HotelScheduleManagementDialog
        open={hotelManagementGuideOpen}
        onClose={() => {
          setHotelManagementGuideOpen(false);
          setHotelManagementStayId(null);
        }}
        onOpenHotel={() => {
          if (!hotelManagementStayId) return;
          navigate(
            `/operations/hotel?stayId=${encodeURIComponent(hotelManagementStayId)}&mode=edit`,
          );
        }}
      />
      <LegacyHotelConversionModal
        open={legacyConversionSchedule !== null}
        anchor={legacyConversionSchedule}
        options={options}
        snapshot={hotelSnapshot}
        onClose={() => setLegacyConversionSchedule(null)}
        onConverted={async (stay) => {
          const [, nextSnapshot] = await Promise.all([
            loadSchedules(),
            fetchHotelOperationsSnapshot(localDate),
            fetchHotelStay(stay.id),
          ]);
          setHotelSnapshot(nextSnapshot);
          setLegacyConversionSchedule(null);
          showNotice("기존 일정을 호텔 예약으로 전환했습니다.");
        }}
      />

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
  const time = operationScheduleTimeLabel(schedule);
  return (
    <button
      type="button"
      aria-label={`${operationScheduleDisplayTitle(schedule)} 일정 상세 보기`}
      onClick={onOpen}
      className={cn(
        "group relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-2xl border border-border/90 bg-surface px-4 py-3.5 text-left shadow-[0_2px_7px_rgb(23_36_58_/_0.045),0_8px_22px_rgb(23_36_58_/_0.055)] transition-[background-color,border-color,box-shadow,opacity,transform,filter] duration-[160ms] ease-out hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[var(--pm-shadow-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:px-5",
        isMine && "border-primary/25 bg-primary/[0.07] shadow-[0_3px_10px_rgb(39_76_119_/_0.08),0_12px_28px_rgb(39_76_119_/_0.09)]",
        completed && "bg-surface-secondary/45 opacity-70 saturate-50",
        cancelled && "bg-surface-secondary/35 opacity-60 saturate-50",
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: primaryAssigneeColor }}
      />
      <div className="min-w-0">
        <p
          className={cn(
            "flex min-w-0 items-center gap-2 truncate text-[15px] font-bold tracking-[-0.015em] transition-colors duration-[160ms] group-hover:text-primary sm:text-base",
            completed || cancelled
              ? "text-text-secondary"
              : "text-text-primary",
            cancelled && "line-through",
          )}
        >
          <span className={cn("truncate", isMine && "font-bold")}>
            {operationScheduleDisplayTitle(schedule)}
          </span>
          {isMine && (
            <Badge tone="blue">
              내 일정
            </Badge>
          )}
        </p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-text-secondary sm:text-[13px]">
          {schedule.timeUnspecified ? (
            <Badge tone="gray">시간 미정</Badge>
          ) : (
            <time className="shrink-0 font-bold tabular-nums text-text-primary">
              {time}
            </time>
          )}
          <span aria-hidden="true" className="text-border-strong">·</span>
          <span className="max-w-[13rem] truncate">
            {schedule.dogs.length
              ? schedule.dogs.map((dog) => dog.name).join(", ")
              : "반려견 미연결"}
          </span>
          <span aria-hidden="true" className="text-border-strong">·</span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full shadow-[0_1px_4px_rgb(15_23_42_/_0.18)] ring-2 ring-white"
              style={{ backgroundColor: primaryAssigneeColor }}
            />
            <span className="max-w-[9rem] truncate">
              {primaryAssignee
                ? operationPersonDisplayName(primaryAssignee)
                : "담당자 미정"}
            </span>
            {secondaryAssignees.map((assignee) => (
              <span
                key={assignee.id}
                aria-label={`${operationPersonDisplayName(assignee)} 색상`}
                title={operationPersonDisplayName(assignee)}
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-white shadow-sm"
                style={{
                  backgroundColor:
                    operationPersonColor(assignee),
                }}
              />
            ))}
          </span>
        </div>
      </div>
      <span className="flex flex-col items-end gap-2">
        <Badge tone={completed ? "gray" : cancelled ? "red" : "blue"}>
          {completed ? "완료" : cancelled ? "취소" : "예정"}
        </Badge>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-[color,background-color,transform] duration-[160ms] ease-out group-hover:translate-x-0.5 group-hover:bg-primary-soft group-hover:text-primary">
          <ChevronRight size={17} />
        </span>
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

export function halfHourTimeOptions(priorityTime?: string | null) {
  const values = Array.from({ length: 48 }, (_, index) => {
    const hour = Math.floor(index / 2).toString().padStart(2, "0");
    const minute = index % 2 === 0 ? "00" : "30";
    return `${hour}:${minute}`;
  });
  const normalizedPriority = priorityTime?.slice(0, 5) ?? "";
  return normalizedPriority && values.includes(normalizedPriority)
    ? [normalizedPriority, ...values.filter((value) => value !== normalizedPriority)]
    : values;
}

function QuickTimeInput({
  label,
  value,
  disabled,
  required,
  priorityTime,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  required: boolean;
  priorityTime?: string | null;
  onChange: (value: string) => void;
}) {
  const options = halfHourTimeOptions(priorityTime);
  return (
    <div className={cn("space-y-2", disabled && "opacity-50")}>
      <Input
        aria-label={label}
        required={required}
        disabled={disabled}
        type="time"
        value={value}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      <Select
        aria-label={`30분 단위 빠른 선택 · ${label.replace(" 시간", "")}`}
        disabled={disabled}
        value={options.includes(value) ? value : ""}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
      >
        <option value="">30분 단위 빠른 선택</option>
        {options.map((time, index) => (
          <option key={time} value={time}>
            {time}
            {priorityTime?.slice(0, 5) === time && index === 0
              ? " · 기본 시간"
              : ""}
          </option>
        ))}
      </Select>
    </div>
  );
}

function ScheduleFormContainer({
  embedded,
  onSubmit,
  children,
}: {
  embedded: boolean;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  return embedded ? (
    <div className="space-y-5">{children}</div>
  ) : (
    <form onSubmit={onSubmit} className="space-y-5">{children}</form>
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
  hotelSnapshot,
  modalTitle,
  modalResetKey,
  calendarLocked = false,
  calendarCreateProduct,
  onCalendarCreateProductChange,
  createProductContent,
  longStayAllowed = true,
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
  hotelSnapshot?: HotelOperationsSnapshot | null;
  modalTitle?: string;
  modalResetKey?: string;
  calendarLocked?: boolean;
  calendarCreateProduct?: CalendarCreateProduct | null;
  onCalendarCreateProductChange?: (value: CalendarCreateProduct | null) => void;
  createProductContent?: ReactNode;
  longStayAllowed?: boolean;
}) {
  const patch = (values: Partial<ScheduleForm>) => onChange({ ...form, ...values });
  const selectedCalendar = selectedOperationCalendar(form.calendarId, options);
  const selectedCalendarIsHotel =
    selectedCalendar?.businessUnitCode === "hotel";
  const hotelMode =
    editing === "new" &&
    selectedCalendarIsHotel &&
    form.hotelScheduleMode === "reservation";
  const hotelScheduleType = hotelMode
    ? hotelScheduleTypeForCalendar(form.calendarId, options)
    : null;
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
  const changeDogs = (dogIds: string[]) => {
    const normalizedDogIds = hotelMode ? dogIds.slice(-1) : dogIds;
    const customerIds = suggestOperationCustomerIds(
      form.customerIds,
      form.dogIds,
      normalizedDogIds,
      options?.dogs ?? [],
    );
    patchWithAutoTitle({
      dogIds: normalizedDogIds,
      customerIds: hotelMode ? customerIds.slice(-1) : customerIds,
    });
  };
  const creatorName =
    editing === "new"
      ? currentUserName
      : editing
        ? editing.createdByName
        : null;
  const selectCalendarProduct = (product: CalendarCreateProduct) => {
    if (product === "hotel") {
      if (options && hotelSnapshot) {
        onChange(initializeHotelScheduleForm(form, options, hotelSnapshot, form.calendarId));
      }
    } else if (product === "general") {
      const generalTypes =
        options?.scheduleTypes.filter(
          (scheduleType) =>
            scheduleType.name.trim() !== HOTEL_SCHEDULE_TYPE_NAME &&
            scheduleType.calendarIds?.includes(form.calendarId),
        ) ?? [];
      patchWithAutoTitle({
        hotelScheduleMode: "operation",
        scheduleTypeId: defaultOperationScheduleTypeId(generalTypes),
        hotelRoomTypeId: "",
      });
    }
    onCalendarCreateProductChange?.(product);
  };
  return (
    <Modal
      open={open}
      title={modalTitle ?? (editing === "new" ? "새 일정" : "일정 수정")}
      onClose={onClose}
      wide
      resetKey={modalResetKey ?? (editing === "new" ? "new" : editing?.id)}
    >
      <ScheduleFormContainer embedded={Boolean(createProductContent)} onSubmit={onSubmit}>
        <>
          <div className="grid gap-4 sm:grid-cols-2">
              <Field label="캘린더" required>
                <Select aria-label="캘린더" disabled={calendarLocked} value={form.calendarId} onChange={(event) => {
                  const calendarId = event.target.value;
                  const nextForm =
                    editing === "new" && options
                      ? transitionScheduleFormCalendar(
                          form,
                          calendarId,
                          options,
                          hotelSnapshot ?? null,
                        )
                      : { ...form, calendarId, scheduleTypeId: "" };
                  patchWithAutoTitle(nextForm);
                  if (editing === "new" && onCalendarCreateProductChange) {
                    onCalendarCreateProductChange(
                      options?.calendars.find((item) => item.id === calendarId)?.businessUnitCode === "hotel"
                        ? "hotel"
                        : null,
                    );
                  }
                }}>
                  <option value="">캘린더 선택</option>
                  {options?.calendars.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              <Field label="일정 유형" required={hotelMode}>
                {editing === "new" && selectedCalendarIsHotel && onCalendarCreateProductChange ? (
                  <Select
                    aria-label="일정 유형"
                    value={calendarCreateProduct ?? "hotel"}
                    onChange={(event) => selectCalendarProduct(event.target.value as CalendarCreateProduct)}
                  >
                    <option value="hotel">호텔 예약</option>
                    <option value="daycare">데이케어 예약</option>
                    <option value="long-stay" disabled={!longStayAllowed}>장기호텔</option>
                    <option value="general">상담·일반 일정</option>
                  </Select>
                ) : (
                <Select
                  value={form.scheduleTypeId}
                  disabled={!form.calendarId || hotelMode}
                  onChange={(event) =>
                    patchWithAutoTitle({ scheduleTypeId: event.target.value })
                  }
                >
                  <option value="">
                    {hotelMode
                      ? "입실·퇴실 유형을 찾을 수 없음"
                      : "선택 안 함 · 기타로 저장"}
                  </option>
                  {(hotelMode
                    ? hotelScheduleType
                      ? [hotelScheduleType]
                      : []
                    : options?.scheduleTypes.filter((row) =>
                        row.calendarIds?.includes(form.calendarId) &&
                        (!selectedCalendarIsHotel ||
                          row.name.trim() !== HOTEL_SCHEDULE_TYPE_NAME),
                      ) ?? []
                  ).map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </Select>
                )}
              </Field>
          </div>
        </>
          {editing === "new" && selectedCalendarIsHotel && !calendarLocked && !onCalendarCreateProductChange ? (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-text-primary">
                등록 유형
              </legend>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-secondary p-1">
                {([
                  ["reservation", "호텔 예약"],
                  ["operation", "상담·일반 일정"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={form.hotelScheduleMode === value}
                    className={cn(
                      "min-h-11 rounded-lg px-3 text-sm font-semibold transition duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      form.hotelScheduleMode === value
                        ? "bg-surface text-primary shadow-sm"
                        : "text-text-secondary hover:bg-surface/70",
                    )}
                    onClick={() => {
                      if (value === "reservation") {
                        if (options && hotelSnapshot) {
                          onChange(
                            initializeHotelScheduleForm(
                              { ...form, hotelScheduleMode: value },
                              options,
                              hotelSnapshot,
                              form.calendarId,
                            ),
                          );
                        } else {
                          patch({
                            hotelScheduleMode: value,
                            scheduleTypeId:
                              hotelScheduleTypeForCalendar(form.calendarId, options)?.id ?? "",
                          });
                        }
                        return;
                      }
                      const generalTypes =
                        options?.scheduleTypes.filter(
                          (scheduleType) =>
                            scheduleType.name.trim() !== HOTEL_SCHEDULE_TYPE_NAME &&
                            scheduleType.calendarIds?.includes(form.calendarId),
                        ) ?? [];
                      patchWithAutoTitle({
                        hotelScheduleMode: value,
                        scheduleTypeId: defaultOperationScheduleTypeId(generalTypes),
                        hotelRoomTypeId: "",
                      });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-muted">
                상담·일반 일정은 객실 점유와 Hotel Stay를 생성하지 않습니다.
              </p>
            </fieldset>
          ) : null}
          {createProductContent ? createProductContent : <>
          {calendarCreateProduct === "general" && selectedCalendarIsHotel ? (
            <Field label="세부 일정 유형">
              <Select value={form.scheduleTypeId} onChange={(event) => patchWithAutoTitle({ scheduleTypeId: event.target.value })}>
                <option value="">선택 안 함 · 기타로 저장</option>
                {options?.scheduleTypes.filter((row) => row.calendarIds?.includes(form.calendarId) && row.name.trim() !== HOTEL_SCHEDULE_TYPE_NAME).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </Select>
            </Field>
          ) : null}
          {!hotelMode ? <Field label="제목" required>
              <Input
                aria-label="제목"
                required
                value={form.title}
                onChange={(event) => {
                  onTitleManuallyEdited(true);
                  patch({ title: event.target.value });
                }}
                placeholder="반려견과 일정 유형을 선택하면 자동 입력됩니다"
              />
          </Field> : null}
        {hotelMode ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="입실 날짜" required>
              <Input
                required
                type="date"
                value={form.date}
                onChange={(event) => {
                  const date = event.target.value;
                  patch({
                    date,
                    hotelCheckOutDate: date ? nextSeoulDate(date) : "",
                  });
                }}
              />
            </Field>
            <div className="space-y-2">
              <Field
                label="입실 시간"
                required={!form.hotelCheckInTimeUnspecified}
              >
                <QuickTimeInput
                  label="입실 시간"
                  disabled={form.hotelCheckInTimeUnspecified}
                  required={!form.hotelCheckInTimeUnspecified}
                  value={form.startTime}
                  priorityTime={hotelSnapshot?.settings?.defaultCheckInTime}
                  onChange={(startTime) => patch({ startTime })}
                />
              </Field>
              <label className="flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={form.hotelCheckInTimeUnspecified}
                  onChange={(event) => patch({
                    hotelCheckInTimeUnspecified: event.target.checked,
                    startTime: "",
                  })}
                />
                시간 미정
              </label>
            </div>
            <Field label="퇴실 날짜" required>
              <Input
                required
                type="date"
                value={form.hotelCheckOutDate}
                onChange={(event) =>
                  patch({ hotelCheckOutDate: event.target.value })
                }
              />
            </Field>
            <div className="space-y-2">
              <Field
                label="퇴실 시간"
                required={!form.hotelCheckOutTimeUnspecified}
              >
                <QuickTimeInput
                  label="퇴실 시간"
                  disabled={form.hotelCheckOutTimeUnspecified}
                  required={!form.hotelCheckOutTimeUnspecified}
                  value={form.hotelCheckOutTime}
                  priorityTime={hotelSnapshot?.settings?.defaultCheckOutTime}
                  onChange={(hotelCheckOutTime) => patch({ hotelCheckOutTime })}
                />
              </Field>
              <label className="flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={form.hotelCheckOutTimeUnspecified}
                  onChange={(event) => patch({
                    hotelCheckOutTimeUnspecified: event.target.checked,
                    hotelCheckOutTime: "",
                  })}
                />
                시간 미정
              </label>
            </div>
            <div className="sm:col-span-2">
              <Field label="객실 유형">
                <Select
                  value={form.hotelRoomTypeId}
                  onChange={(event) =>
                    patch({ hotelRoomTypeId: event.target.value })
                  }
                >
                  <option value="">객실 미정</option>
                  {hotelSnapshot?.roomTypes.map((roomType) => (
                    <option key={roomType.id} value={roomType.id}>
                      {roomType.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        ) : (
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
          <div className="grid gap-2 self-end min-[430px]:grid-cols-2 sm:grid-cols-1 lg:grid-cols-2">
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3.5 text-sm font-medium text-text-primary">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(event) =>
                  patch({
                    allDay: event.target.checked,
                    timeUnspecified: event.target.checked
                      ? false
                      : form.timeUnspecified,
                  })
                }
              />
              종일 일정
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3.5 text-sm font-medium text-text-primary">
              <input
                type="checkbox"
                checked={form.timeUnspecified}
                onChange={(event) => {
                  const timeUnspecified = event.target.checked;
                  patch({
                    timeUnspecified,
                    allDay: timeUnspecified ? false : form.allDay,
                    startTime: "",
                    endTime: "",
                    endDate: timeUnspecified ? form.endDate : form.date,
                  });
                }}
              />
              시간 미정
            </label>
          </div>
          <>
            <div
              className={cn(
                (form.allDay || form.timeUnspecified) && "opacity-50",
              )}
            >
              <Field
                label="시작 시간"
                required={!form.allDay && !form.timeUnspecified}
              >
                <QuickTimeInput
                  label="시작 시간"
                  disabled={form.allDay || form.timeUnspecified}
                  required={!form.allDay && !form.timeUnspecified}
                  value={form.startTime}
                  onChange={(startTime) => {
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
            <div
              className={cn(
                (form.allDay || form.timeUnspecified) && "opacity-50",
              )}
            >
              <Field
                label="종료 시간"
                required={!form.allDay && !form.timeUnspecified}
              >
                <QuickTimeInput
                  label="종료 시간"
                  disabled={form.allDay || form.timeUnspecified}
                  required={!form.allDay && !form.timeUnspecified}
                  value={form.endTime}
                  onChange={(endTime) => {
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
        )}
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
        <CustomerDogSearchFields
          customers={options?.customers ?? []}
          dogs={
            hotelMode && form.customerIds[0]
              ? (options?.dogs ?? []).filter((dog) => dog.customerId === form.customerIds[0])
              : options?.dogs ?? []
          }
          customerIds={form.customerIds}
          dogIds={form.dogIds}
          onDogIdsChange={changeDogs}
          onCustomerIdsChange={(customerIds) => {
            const normalizedCustomerIds = hotelMode ? customerIds.slice(-1) : customerIds;
            patch({
              customerIds: normalizedCustomerIds,
              dogIds:
                hotelMode && normalizedCustomerIds[0]
                  ? form.dogIds.filter(
                      (dogId) => options?.dogs.find((dog) => dog.id === dogId)?.customerId === normalizedCustomerIds[0],
                    )
                  : form.dogIds,
            });
          }}
          multiple={!hotelMode}
          recentScope={`${recentScope}:schedule`}
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
        {hotelMode && !hotelScheduleType && !error && (
          <p role="alert" className="rounded-xl bg-error-soft px-3 py-2 text-sm text-error">
            Hotel 캘린더에 입실·퇴실 일정 유형이 연결되어 있지 않습니다.
          </p>
        )}
        <ModalActions>
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>닫기</Button>
          <Button type="submit" disabled={saving || (hotelMode && !hotelScheduleType)}>{saving ? "저장 중..." : "저장"}</Button>
        </ModalActions>
        </>}
      </ScheduleFormContainer>
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
  onConvertToHotel,
  showLegacyHotelConversion = false,
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
  onConvertToHotel?: (schedule: OperationSchedule) => void;
  showLegacyHotelConversion?: boolean;
  canManage?: boolean;
}) {
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  if (!schedule) return null;
  const start = seoulParts(schedule.startsAt);
  const end = seoulParts(schedule.endsAt);
  return (
    <Modal
      open
      title="일정 상세"
      onClose={() => {
        setActionMenuOpen(false);
        onClose();
      }}
      wide
      resetKey={schedule.id}
    >
      <div className="relative flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="pr-14 sm:pr-0">
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
            {showLegacyHotelConversion ? <Badge tone="gray">기존 수동 일정</Badge> : null}
          </div>
          <h3 className="mt-3 text-2xl font-bold tracking-[-0.03em] text-text-primary">{operationScheduleDisplayTitle(schedule)}</h3>
          <p className="mt-2 text-sm text-text-secondary">
            {start.date} · {schedule.allDay
              ? "종일"
              : schedule.timeUnspecified
                ? "날짜 확정 · 시간 미정"
                : `${start.time}–${end.time}`}
          </p>
        </div>
        {canManage && (
          <div
            className="absolute right-0 top-0 sm:static sm:self-start"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setActionMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              aria-label="일정 관리 더보기"
              aria-haspopup="menu"
              aria-expanded={actionMenuOpen}
              disabled={processing}
              onClick={() => setActionMenuOpen((open) => !open)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border-strong bg-surface text-text-secondary shadow-sm transition duration-150 ease-out hover:-translate-y-px hover:border-primary/30 hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MoreHorizontal size={20} />
              <span className="sr-only">일정 관리 더보기</span>
            </button>
            {actionMenuOpen && (
              <div
                role="menu"
                aria-label="일정 관리"
                className="absolute right-0 top-[calc(100%+0.5rem)] z-20 min-w-44 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionMenuOpen(false);
                    onEdit(schedule);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-text-secondary transition hover:bg-surface-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Pencil size={15} />
                  일정 수정
                </button>
                {showLegacyHotelConversion && onConvertToHotel ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionMenuOpen(false);
                      onConvertToHotel(schedule);
                    }}
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-primary transition hover:bg-primary-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    호텔 예약으로 전환
                  </button>
                ) : null}
                {schedule.status !== "cancelled" && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionMenuOpen(false);
                      onCancel(schedule);
                    }}
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-text-secondary transition hover:bg-surface-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    일정 취소
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionMenuOpen(false);
                    onArchive(schedule);
                  }}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-error transition hover:bg-error-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-error"
                >
                  일정 삭제
                </button>
              </div>
            )}
          </div>
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
      {canManage && schedule.status === "scheduled" && (
        <div className="mt-6 flex justify-end border-t border-border pt-5">
          <Button disabled={processing} onClick={() => onComplete(schedule)}>완료 처리</Button>
        </div>
      )}
    </Modal>
  );
}

export function HotelScheduleManagementDialog({
  open,
  onClose,
  onOpenHotel,
}: {
  open: boolean;
  onClose: () => void;
  onOpenHotel: () => void;
}) {
  return (
    <Modal open={open} title="호텔 예약 일정" onClose={onClose}>
      <p className="text-sm font-semibold leading-6 text-text-primary">
        이 일정은 호텔 예약과 연결되어 있습니다.
      </p>
      <p className="mt-2 text-sm leading-6 text-text-secondary">
        호텔 운영에서 예약을 수정하거나 예약 취소를 진행해주세요.
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
        <Button
          onClick={() => {
            onClose();
            onOpenHotel();
          }}
        >
          호텔 운영 열기
        </Button>
      </div>
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
