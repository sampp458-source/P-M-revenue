import {
  CalendarCheck2,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Dog,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { Card, cn } from "../components/ui";

type BusinessTheme = "daycare" | "training" | "hotel" | "common";

export interface TodaySchedule {
  id: string;
  startsAt: string;
  title: string;
  dogId?: string;
  dogName?: string;
  scheduleType: string;
  assignee?: string;
  business: BusinessTheme;
}

const businessPresentation: Record<
  BusinessTheme,
  { label: string; accent: string; dot: string; soft: string }
> = {
  daycare: {
    label: "유치원",
    accent: "border-l-cyan-500",
    dot: "bg-cyan-500",
    soft: "bg-cyan-50 text-cyan-800",
  },
  training: {
    label: "교육센터",
    accent: "border-l-indigo-500",
    dot: "bg-indigo-500",
    soft: "bg-indigo-50 text-indigo-800",
  },
  hotel: {
    label: "호텔",
    accent: "border-l-amber-500",
    dot: "bg-amber-500",
    soft: "bg-amber-50 text-amber-800",
  },
  common: {
    label: "공통",
    accent: "border-l-primary",
    dot: "bg-primary",
    soft: "bg-primary-soft text-primary",
  },
};

const previewSchedules: TodaySchedule[] = [
  {
    id: "preview-daycare",
    startsAt: "09:00",
    title: "오전 등원",
    dogName: "가을",
    scheduleType: "유치원",
    assignee: "이화인",
    business: "daycare",
  },
  {
    id: "preview-training",
    startsAt: "10:00",
    title: "개인 교육",
    dogName: "초코",
    scheduleType: "교육",
    assignee: "담당자 미정",
    business: "training",
  },
  {
    id: "preview-consultation",
    startsAt: "13:00",
    title: "신규 보호자 상담",
    scheduleType: "상담",
    assignee: "이화인",
    business: "common",
  },
  {
    id: "preview-hotel",
    startsAt: "15:00",
    title: "호텔 체크인",
    dogName: "토비",
    scheduleType: "입실·퇴실",
    assignee: "담당자 미정",
    business: "hotel",
  },
];

const previewTasks = ["오전 픽업 확인", "오후 픽업 확인", "직원 회의", "확인 필요 일정"];

function todayCopy(date: Date) {
  return {
    fullDate: new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date),
    weekday: new Intl.DateTimeFormat("ko-KR", { weekday: "long" }).format(date),
  };
}

export function OperationsTodayPage() {
  const { fullDate, weekday } = todayCopy(new Date());

  return (
    <section className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">{fullDate}</p>
          <h1 className="mt-1 text-[clamp(1.75rem,4vw,2.5rem)] font-bold tracking-[-0.045em] text-text-primary">
            {weekday}, 오늘의 Operations
          </h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            오늘 오는 반려견과 해야 할 일을 한눈에 확인하세요.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/15 bg-primary-soft px-3.5 py-2 text-sm font-semibold text-primary">
          <CalendarCheck2 aria-hidden="true" size={17} />
          오늘 일정 {previewSchedules.length}건
        </div>
      </header>

      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-primary/12 bg-primary-subtle px-4 py-3 text-sm text-text-secondary">
        <Sparkles className="mt-0.5 shrink-0 text-primary" aria-hidden="true" size={17} />
        <p>
          <strong className="font-semibold text-text-primary">Today UX 미리보기</strong>
          <span className="ml-1.5">
            일정 DB 연결 전 레이아웃 예시이며, 실제 일정 기능은 다음 Sprint에서 연결됩니다.
          </span>
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1.65fr)_minmax(17rem,0.85fr)] lg:gap-6">
        <TodayScheduleSection
          schedules={previewSchedules}
          onOpenDogProfile={(dogId) => {
            // 실제 일정 조회 연결 후 기존 Dog Profile 진입 동작을 주입한다.
            void dogId;
          }}
        />

        <aside className="space-y-5">
          <TodaySummary schedules={previewSchedules} />
          <TodayChecklist tasks={previewTasks} />
        </aside>
      </div>
    </section>
  );
}

function TodayScheduleSection({
  schedules,
  onOpenDogProfile,
}: {
  schedules: TodaySchedule[];
  onOpenDogProfile: (dogId: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-lg font-bold tracking-[-0.025em] text-text-primary">
            오늘 일정
          </h2>
          <p className="mt-1 text-xs text-text-muted">시간순으로 확인합니다</p>
        </div>
        <span className="tabular-nums text-sm font-semibold text-text-secondary">
          {schedules.length}건
        </span>
      </div>

      {schedules.length > 0 ? (
        <ol className="divide-y divide-border/80">
          {schedules.map((schedule) => (
            <li key={schedule.id}>
              <ScheduleCard
                schedule={schedule}
                onOpenDogProfile={onOpenDogProfile}
              />
            </li>
          ))}
        </ol>
      ) : (
        <TodayEmptyState />
      )}
    </Card>
  );
}

function ScheduleCard({
  schedule,
  onOpenDogProfile,
}: {
  schedule: TodaySchedule;
  onOpenDogProfile: (dogId: string) => void;
}) {
  const theme = businessPresentation[schedule.business];
  const canOpenDog = Boolean(schedule.dogId);

  return (
    <button
      type="button"
      disabled={!canOpenDog}
      onClick={() => schedule.dogId && onOpenDogProfile(schedule.dogId)}
      className={cn(
        "group grid w-full grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-3 border-l-[3px] px-4 py-4 text-left transition-[background-color,border-color] duration-150 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:px-5",
        theme.accent,
        canOpenDog
          ? "cursor-pointer hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          : "cursor-default",
      )}
      aria-label={
        canOpenDog
          ? `${schedule.dogName} 반려견 프로필 열기`
          : `${schedule.startsAt} ${schedule.title}`
      }
    >
      <time className="self-start pt-0.5 text-base font-bold tabular-nums text-text-primary">
        {schedule.startsAt}
      </time>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {schedule.dogName && (
            <strong className="inline-flex items-center gap-1.5 text-[15px] text-text-primary">
              <Dog aria-hidden="true" size={16} className="text-text-muted" />
              {schedule.dogName}
            </strong>
          )}
          <span className="font-semibold text-text-primary">{schedule.title}</span>
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text-secondary">
          <span className={cn("rounded-full px-2 py-1 font-semibold", theme.soft)}>
            {schedule.scheduleType}
          </span>
          <span className="inline-flex items-center gap-1">
            <UsersRound aria-hidden="true" size={13} />
            담당 {schedule.assignee || "미정"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", theme.dot)} />
            {theme.label}
          </span>
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        size={18}
        className={cn(
          "text-text-muted transition-transform",
          canOpenDog && "group-hover:translate-x-0.5 group-hover:text-primary",
        )}
      />
    </button>
  );
}

function TodaySummary({ schedules }: { schedules: TodaySchedule[] }) {
  const counts = schedules.reduce<Record<BusinessTheme, number>>(
    (result, schedule) => {
      result[schedule.business] += 1;
      return result;
    },
    { daycare: 0, training: 0, hotel: 0, common: 0 },
  );

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-text-muted">오늘 요약</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-[-0.04em] text-text-primary">
            {schedules.length}
            <span className="ml-1 text-sm font-semibold text-text-secondary">건</span>
          </p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Clock3 aria-hidden="true" size={19} />
        </span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-2.5">
        {(Object.keys(businessPresentation) as BusinessTheme[]).map((business) => {
          const presentation = businessPresentation[business];
          return (
            <div
              key={business}
              className="rounded-xl border border-border bg-surface-secondary/65 px-3 py-2.5"
            >
              <dt className="flex items-center gap-1.5 text-xs text-text-secondary">
                <span className={cn("h-1.5 w-1.5 rounded-full", presentation.dot)} />
                {presentation.label}
              </dt>
              <dd className="mt-1 font-bold tabular-nums text-text-primary">
                {counts[business]}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

function TodayChecklist({ tasks }: { tasks: string[] }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-text-primary">오늘 할 일</h2>
          <p className="mt-1 text-xs text-text-muted">체크 기능은 다음 Sprint에서 연결됩니다</p>
        </div>
        <ClipboardCheck aria-hidden="true" size={19} className="text-text-muted" />
      </div>
      <ul className="mt-4 space-y-1">
        {tasks.map((task) => (
          <li
            key={task}
            className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm text-text-secondary"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface">
              <Check aria-hidden="true" size={12} className="text-transparent" />
            </span>
            {task}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TodayEmptyState() {
  return (
    <div className="flex min-h-72 items-center justify-center px-5 py-12 text-center">
      <div>
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-secondary text-text-muted">
          <CalendarCheck2 aria-hidden="true" size={20} />
        </span>
        <h3 className="mt-4 font-bold text-text-primary">오늘 등록된 일정이 없습니다</h3>
        <p className="mt-1.5 text-sm text-text-secondary">
          새로운 일정이 등록되면 시간순으로 표시됩니다.
        </p>
      </div>
    </div>
  );
}
