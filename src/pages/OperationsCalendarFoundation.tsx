import { useState } from "react";
import { CalendarDays, CalendarRange, Clock3 } from "lucide-react";
import { Card, PageHeader } from "../components/ui";

type CalendarView = "month" | "week" | "day";

const views = [
  { id: "month" as const, label: "월", icon: CalendarDays },
  { id: "week" as const, label: "주", icon: CalendarRange },
  { id: "day" as const, label: "일", icon: Clock3 },
];

export function OperationsCalendarFoundationPage() {
  const [view, setView] = useState<CalendarView>("month");
  const selected = views.find((item) => item.id === view) ?? views[0];
  const SelectedIcon = selected.icon;

  return (
    <section className="mx-auto max-w-6xl">
      <PageHeader
        title="캘린더"
        description="사업부·공통 일정을 월·주·일 기준으로 확인할 수 있는 화면을 준비합니다."
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="text-xs font-semibold text-text-muted">
              Calendar View
            </p>
            <h2 className="mt-1 font-bold text-text-primary">
              Operations Calendar
            </h2>
          </div>
          <div
            className="inline-flex w-fit rounded-xl border border-border bg-surface-secondary p-1"
            role="tablist"
            aria-label="캘린더 보기"
          >
            {views.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  view === id
                    ? "bg-surface text-primary shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                <Icon aria-hidden="true" size={15} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-[360px] items-center justify-center px-5 py-12 text-center sm:min-h-[440px]">
          <div className="max-w-md">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <SelectedIcon aria-hidden="true" size={21} />
            </span>
            <h3 className="mt-4 text-lg font-bold text-text-primary">
              {selected.label} 보기 기반 준비 완료
            </h3>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              실제 일정 조회와 캘린더 인터랙션은 다음 Sprint에서 연결됩니다.
            </p>
          </div>
        </div>
      </Card>
    </section>
  );
}
