import { dashboardThemeStyle } from "../pages/dashboard/dashboardTheme";

export function DaycareStudentBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      style={dashboardThemeStyle("daycare")}
      className={`inline-flex shrink-0 items-center rounded-full bg-[var(--pm-theme-tint-2)] font-semibold leading-4 text-[var(--pm-theme-accent)] ring-1 ring-inset ring-[var(--pm-theme-tint-4)] ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
    >
      유치원생
    </span>
  );
}
