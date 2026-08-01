import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Bell,
  CalendarDays,
  CalendarOff,
  Clock3,
  LockKeyhole,
  Repeat2,
  Settings2,
  Tags,
} from "lucide-react";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "../components/ui";
import {
  fetchOperationSettings,
  type OperationCalendar,
  type OperationSettings,
} from "./operationsSettingsRepository";

const scopeLabel = (calendar: OperationCalendar) => {
  if (calendar.scopeType === "common") return "공통 일정";
  if (calendar.scopeType === "personal") return "개인 일정";
  return calendar.businessUnitName ?? "사업부";
};

const settingCategories = [
  {
    id: "calendar",
    title: "캘린더·일정 유형",
    description: "운영 범위와 일정 분류",
    icon: CalendarDays,
    available: true,
  },
  {
    id: "business-hours",
    title: "운영시간",
    description: "업무일과 운영 시간대",
    futureNote: "영업일과 시간대별 운영 기준을 설정할 수 있게 됩니다.",
    icon: Clock3,
    available: false,
  },
  {
    id: "recurrence",
    title: "반복 일정",
    description: "반복 생성과 변경 기준",
    futureNote: "반복 주기와 수정 범위를 설정할 수 있게 됩니다.",
    icon: Repeat2,
    available: false,
  },
  {
    id: "holidays",
    title: "휴일",
    description: "공휴일과 휴무일 관리",
    futureNote: "공휴일과 회사 휴무일을 캘린더에 반영할 수 있게 됩니다.",
    icon: CalendarOff,
    available: false,
  },
  {
    id: "notifications",
    title: "알림",
    description: "일정 알림과 전달 기준",
    futureNote: "일정 전후 알림과 전달 대상을 설정할 수 있게 됩니다.",
    icon: Bell,
    available: false,
  },
] as const;

export function OperationsSettingsPage() {
  const [settings, setSettings] = useState<OperationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setSettings(await fetchOperationSettings());
    } catch {
      setSettings(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mx-auto max-w-6xl">
      <PageHeader
        title="일정 설정"
        description="스케줄 운영에 필요한 기준을 한곳에서 관리합니다."
      />

      <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="relative overflow-visible lg:sticky lg:top-16">
          <div className="flex items-center gap-3 border-b border-border px-4 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Settings2 aria-hidden="true" size={18} />
            </span>
            <div>
              <h2 className="text-sm font-bold text-text-primary">설정 메뉴</h2>
              <p className="mt-0.5 text-xs text-text-muted">Operations 공통 기준</p>
            </div>
          </div>
          <nav aria-label="일정 설정 범주" className="space-y-1 p-2">
            {settingCategories.map(({ id, title, description, icon: Icon, available, ...category }) => (
              <div
                key={id}
                aria-current={available ? "page" : undefined}
                tabIndex={available ? undefined : 0}
                className={`group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-[160ms] ease-out ${
                  available
                    ? "border-primary/15 bg-primary-soft text-primary shadow-[inset_0_1px_0_rgb(255_255_255_/_0.65)]"
                    : "cursor-help border-transparent bg-surface text-text-secondary hover:border-border hover:bg-surface-secondary/75 focus:border-primary/25 focus:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${available ? "bg-white/75 text-primary" : "bg-surface-secondary text-text-secondary"}`}>
                  <Icon aria-hidden="true" size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${available ? "font-bold" : "font-semibold"}`}>
                    {title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                    {description}
                  </span>
                </span>
                {!available && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-white px-2 py-1 text-[9px] font-bold text-text-secondary shadow-sm">
                    <LockKeyhole aria-hidden="true" size={10} /> 준비 중
                  </span>
                )}
                {!available && "futureNote" in category && (
                  <span
                    role="tooltip"
                    className="pointer-events-none invisible absolute left-2 right-2 top-[calc(100%+0.35rem)] z-30 rounded-xl border border-border bg-slate-900 px-3 py-2 text-[11px] font-medium leading-5 text-white opacity-0 shadow-xl transition-opacity duration-[160ms] ease-out group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100 lg:left-[calc(100%+0.5rem)] lg:right-auto lg:top-1/2 lg:w-64 lg:-translate-y-1/2"
                  >
                    {category.futureNote}
                  </span>
                )}
              </div>
            ))}
          </nav>
        </Card>

        <div className="min-w-0">
          <div className="mb-4">
            <h2 className="text-lg font-bold tracking-[-0.025em] text-text-primary">
              캘린더·일정 유형
            </h2>
            <p className="mt-1 text-sm leading-6 text-text-secondary">
              일정이 표시될 운영 범위와 업무 성격을 확인합니다.
            </p>
          </div>

          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-primary/15 bg-primary-soft/55 px-4 py-3.5 text-sm leading-6 text-text-secondary">
            <LockKeyhole
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-primary"
              size={17}
            />
            <div>
              <span className="mb-0.5 block font-bold text-primary">조회 전용</span>
              현재 값은 일정 등록과 캘린더에 사용됩니다. 이 화면에서는 변경할
              수 없으며, 담당자 색상은 기존 직원 관리에서 설정합니다.
            </div>
          </div>

          {loading ? (
            <Card>
              <LoadingState />
            </Card>
          ) : loadError ? (
            <Card>
              <ErrorState
                title="일정 설정을 불러오지 못했습니다. 관리자에게 문의하세요."
                retry={() => void load()}
              />
            </Card>
          ) : (
            <div className="grid gap-5 xl:grid-cols-2">
              <SettingsListCard
                icon={CalendarDays}
                title="캘린더"
                description="사업부·공통·개인 일정의 범위를 구분합니다."
                emptyTitle="활성 캘린더가 없습니다."
              >
                {settings?.calendars.map((calendar) => (
                  <li
                    key={calendar.id}
                    className="flex min-h-14 items-center gap-3 px-4 py-3"
                  >
                    <ColorDot color={calendar.color} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-primary">
                        {calendar.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        {scopeLabel(calendar)}
                      </p>
                    </div>
                  </li>
                ))}
              </SettingsListCard>

              <SettingsListCard
                icon={Tags}
                title="일정 유형"
                description="일정의 성격을 사업부와 별도로 분류합니다."
                emptyTitle="활성 일정 유형이 없습니다."
              >
                {settings?.scheduleTypes.map((scheduleType) => (
                  <li
                    key={scheduleType.id}
                    className="flex min-h-14 items-center gap-3 px-4 py-3"
                  >
                    <ColorDot color={scheduleType.color} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text-primary">
                        {scheduleType.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        {settings.calendars
                          .filter((calendar) => scheduleType.calendarIds?.includes(calendar.id))
                          .map((calendar) => calendar.name)
                          .join(" · ") || "연결된 캘린더 없음"}
                      </p>
                    </div>
                  </li>
                ))}
              </SettingsListCard>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-3 w-3 shrink-0 rounded-full ring-4 ring-slate-100"
      style={{ backgroundColor: color }}
    />
  );
}

function SettingsListCard({
  icon: Icon,
  title,
  description,
  emptyTitle,
  children,
}: {
  icon: typeof CalendarDays;
  title: string;
  description: string;
  emptyTitle: string;
  children: ReactNode;
}) {
  const hasItems = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Icon aria-hidden="true" size={18} />
        </div>
        <div>
          <h2 className="font-bold text-text-primary">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-text-secondary">
            {description}
          </p>
        </div>
      </div>
      {hasItems ? (
        <ul className="divide-y divide-border">{children}</ul>
      ) : (
        <EmptyState title={emptyTitle} />
      )}
    </Card>
  );
}
