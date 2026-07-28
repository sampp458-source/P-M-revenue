import type { CSSProperties, ReactNode } from "react";
import { Card, cn } from "./ui";

export function ProfileContent({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-7", className)}>{children}</div>;
}

export function ProfileHeader({
  title,
  status,
  tags,
  summary,
  actions,
}: {
  title: string;
  status?: ReactNode;
  tags?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {(status || tags) && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {status}
            {tags}
          </div>
        )}
        <h2 className="truncate text-3xl font-bold tracking-[-0.04em] text-text-primary sm:text-4xl">
          {title}
        </h2>
        {summary && (
          <div className="mt-2 text-sm leading-6 text-text-secondary">
            {summary}
          </div>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}

export function ProfileSection({
  id,
  title,
  description,
  action,
  children,
  className = "",
}: {
  id: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 id={id} className="text-base font-bold text-text-primary">
            {title}
          </h3>
          {description && (
            <div className="mt-1 text-xs leading-5 text-text-muted">
              {description}
            </div>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ProfileInfoGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className="p-5">
      <dl
        className={cn(
          "grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4",
          className,
        )}
      >
        {children}
      </dl>
    </Card>
  );
}

export function ProfileField({
  label,
  value,
  icon,
  className = "",
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm font-medium text-text-primary">
        {value}
      </dd>
    </div>
  );
}

export function ProfileTimeline({
  countLabel,
  children,
}: {
  countLabel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {countLabel && (
        <div className="mb-4 flex justify-end text-xs font-semibold text-text-muted">
          {countLabel}
        </div>
      )}
      <ol className="relative ml-2 border-l border-border">{children}</ol>
    </>
  );
}

export function ProfileTimelineItem({
  date,
  badge,
  title,
  meta,
  style,
  last = false,
}: {
  date: ReactNode;
  badge?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  style?: CSSProperties;
  last?: boolean;
}) {
  return (
    <li
      style={style}
      className={cn("relative pl-6", last ? "pb-0" : "pb-6")}
    >
      <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--pm-theme-accent,#274c77)] ring-4 ring-white" />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-text-primary">{date}</span>
            {badge}
          </div>
          <div className="mt-1 break-words text-sm text-text-secondary">
            {title}
          </div>
        </div>
        {meta && (
          <div className="shrink-0 text-xs text-text-muted">{meta}</div>
        )}
      </div>
    </li>
  );
}

export function ProfileHistory({
  id = "profile-history-title",
  description = "수정자, 수정시간과 변경 내용을 보존합니다.",
  children,
}: {
  id?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ProfileSection id={id} title="변경 이력" description={description}>
      {children}
    </ProfileSection>
  );
}
