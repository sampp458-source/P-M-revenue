import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CalendarDays, LockKeyhole, Tags } from "lucide-react";
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
    <section className="mx-auto max-w-5xl">
      <PageHeader
        title="일정 설정"
        description="Operations에서 사용할 캘린더와 일정 유형을 확인합니다."
      />

      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-border bg-surface-secondary px-4 py-3 text-sm leading-6 text-text-secondary">
        <LockKeyhole
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-primary"
          size={17}
        />
        이번 단계에서는 설정을 조회만 할 수 있습니다. 추가·수정 기능은 권한
        확인 후 제공됩니다.
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
        <div className="grid gap-5 lg:grid-cols-2">
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
                <p className="truncate text-sm font-semibold text-text-primary">
                  {scheduleType.name}
                </p>
              </li>
            ))}
          </SettingsListCard>
        </div>
      )}
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
