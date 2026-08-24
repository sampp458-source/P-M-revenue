import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TableHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export const cn = (...v: (string | false | undefined)[]) =>
  v.filter(Boolean).join(" ");
export function Button({
  className = "",
  variant = "primary",
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:translate-y-px disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-primary text-white shadow-[0_5px_14px_rgb(39_76_119_/_0.16),inset_0_1px_0_rgb(255_255_255_/_0.18)] hover:-translate-y-px hover:bg-primary-hover hover:shadow-[0_8px_20px_rgb(39_76_119_/_0.22),inset_0_1px_0_rgb(255_255_255_/_0.2)]",
        variant === "secondary" &&
          "border border-border-strong bg-surface text-text-primary shadow-[0_1px_3px_rgb(23_36_58_/_0.05)] hover:-translate-y-px hover:border-primary/30 hover:bg-primary-subtle hover:shadow-[0_5px_14px_rgb(23_36_58_/_0.08)]",
        variant === "danger" && "bg-error text-white shadow-[0_5px_14px_rgb(194_77_77_/_0.16)] hover:-translate-y-px hover:bg-[#aa4141] hover:shadow-[0_8px_20px_rgb(194_77_77_/_0.22)]",
        variant === "ghost" && "text-text-secondary hover:bg-primary-soft hover:text-primary",
        className,
      )}
      {...p}
    />
  );
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = "", ...p }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "min-h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-sm text-text-primary outline-none transition-[border-color,box-shadow,background-color] duration-200 ease-out placeholder:text-text-muted hover:border-[#c5cfdb] focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-text-muted read-only:bg-surface-secondary aria-[invalid=true]:border-error aria-[invalid=true]:bg-error-soft aria-[invalid=true]:focus:ring-error/15",
        className,
      )}
      {...p}
    />
  );
});
export function SearchBox({ className = "", onClear, inputRef, ...props }: InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void; inputRef?: Ref<HTMLInputElement> }) {
  const internalInputRef = useRef<HTMLInputElement>(null);
  const hasValue = String(props.value ?? props.defaultValue ?? "").length > 0;
  const clear = () => { onClear?.(); requestAnimationFrame(() => internalInputRef.current?.focus()); };
  const assignRef = (element: HTMLInputElement | null) => {
    internalInputRef.current = element;
    if (typeof inputRef === "function") inputRef(element);
    else if (inputRef) inputRef.current = element;
  };
  return <div className={cn("relative", className)}><Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-3.5 text-text-muted" size={16} /><Input ref={assignRef} type="search" className={cn("pl-10", hasValue && onClear ? "pr-12" : "")} {...props} />{hasValue && onClear && <button type="button" aria-label="검색어 초기화" className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={clear}><X size={16} /></button>}</div>;
}
export function Select({
  className = "",
  children,
  ...p
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-11 w-full appearance-none rounded-xl border border-border-strong bg-surface px-3.5 text-sm text-text-primary outline-none transition-[border-color,box-shadow,background-color] duration-200 ease-out hover:border-[#c5cfdb] focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-text-muted aria-[invalid=true]:border-error aria-[invalid=true]:bg-error-soft",
        className,
      )}
      {...p}
    >
      {children}
    </select>
  );
}
export function Textarea({
  className = "",
  ...p
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full resize-y rounded-xl border border-border-strong bg-surface px-3.5 py-3 text-sm text-text-primary outline-none transition-[border-color,box-shadow,background-color] duration-200 ease-out placeholder:text-text-muted hover:border-[#c5cfdb] focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-text-muted read-only:bg-surface-secondary aria-[invalid=true]:border-error aria-[invalid=true]:bg-error-soft",
        className,
      )}
      {...p}
    />
  );
}
export function Field({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-text-primary">
        {label}
        {required && <span className="ml-1 text-error" aria-hidden="true">*</span>}
      </span>
      {children}
      {help && (
        <span className="mt-1.5 block text-xs leading-5 text-text-secondary">{help}</span>
      )}
    </label>
  );
}
export function FormSection({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cn("space-y-4", className)}>
      <div>
        <h3 id={titleId} className="text-sm font-bold text-text-primary">{title}</h3>
        {description ? <div className="mt-1 text-xs leading-5 text-text-muted">{description}</div> : null}
      </div>
      {children}
    </section>
  );
}
export function FormAlert({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "warning" | "info";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl px-3.5 py-3 text-sm leading-6",
        tone === "error" && "bg-error-soft font-medium text-error",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "info" && "bg-primary-subtle text-text-secondary",
      )}
    >
      {children}
    </div>
  );
}
export function Card({
  children,
  className = "",
  variant = "surface",
  selected = false,
}: {
  children: ReactNode;
  className?: string;
  variant?: "surface" | "emphasized" | "interactive" | "flat";
  selected?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-[20px]",
        variant === "surface" && "pm-card border border-border/90 bg-surface",
        variant === "emphasized" && "pm-card border border-primary/15 bg-[linear-gradient(145deg,#ffffff_0%,#f5f8fb_100%)]",
        variant === "interactive" && "pm-card pm-card-interactive border border-border/90 bg-surface transition-[background-color,border-color,transform,box-shadow] duration-150 ease-out hover:border-primary/25 hover:bg-primary-subtle",
        variant === "flat" && "bg-transparent",
        selected && "border-primary/35 bg-primary-soft ring-1 ring-primary/10",
        className,
      )}
    >
      {children}
    </section>
  );
}
export function FilterToolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Card className="mb-6 p-4 sm:p-5"><div className={cn("grid gap-3 sm:gap-4", className)}>{children}</div></Card>;
}
export function Table({
  className = "",
  children,
  scrollResetKey,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & {
  scrollResetKey?: string | number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollLeft = 0;
  }, [scrollResetKey]);
  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto overscroll-x-contain rounded-[inherit]"
    >
      <table className={cn("data-table", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, totalLabel, onPageChange }: { page: number; totalPages: number; totalLabel: string; onPageChange: (page: number) => void }) {
  return <nav className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label="페이지 이동"><p className="text-sm text-text-secondary"><span className="tabular-nums">{page} / {Math.max(1, totalPages)}</span> 페이지 · {totalLabel}</p><div className="grid grid-cols-2 gap-2 sm:flex"><Button type="button" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>이전</Button><Button type="button" variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>다음</Button></div></nav>;
}
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-text-primary sm:text-[1.625rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-text-secondary">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
export function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: "green" | "blue" | "red" | "amber" | "gray";
}) {
  const c = {
    green: "bg-success-soft text-success",
    blue: "bg-primary-soft text-primary",
    red: "bg-error-soft text-error",
    amber: "bg-warning-soft text-warning",
    gray: "bg-surface-secondary text-text-secondary ring-1 ring-inset ring-border",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold leading-4",
        c,
      )}
    >
      {children}
    </span>
  );
}
const statusPresentation = {
  active: { label: "활성", tone: "green" },
  inactive: { label: "비활성", tone: "gray" },
  normal: { label: "정상", tone: "green" },
  partial_refund: { label: "부분환불", tone: "amber" },
  full_refund: { label: "전체환불", tone: "red" },
  cancelled: { label: "취소", tone: "red" },
  outstanding: { label: "미수", tone: "amber" },
} as const;
export function StatusBadge({ status, tone }: { status: keyof typeof statusPresentation; tone?: "green" | "blue" | "red" | "amber" | "gray" }) {
  const presentation = statusPresentation[status];
  return <Badge tone={tone ?? presentation.tone}>{presentation.label}</Badge>;
}
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  size,
  wide = false,
  extraWide = false,
  resetKey,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: "small" | "medium" | "large" | "extraLarge";
  wide?: boolean;
  extraWide?: boolean;
  resetKey?: string | number;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    scrollRef.current.scrollTop = 0;
    scrollRef.current.scrollLeft = 0;
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    });
  }, [open, resetKey]);
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusableSelector = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    requestAnimationFrame(() => (dialog?.querySelector<HTMLElement>("[data-modal-initial], input:not([disabled]), select:not([disabled]), textarea:not([disabled])") ?? dialog?.querySelector<HTMLElement>(focusableSelector))?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.offsetParent !== null);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); openerRef.current?.focus(); };
  }, [open]);
  if (!open) return null;
  const resolvedSize = size ?? (extraWide ? "extraLarge" : wide ? "large" : "medium");
  return (
    <div
      className="pm-modal-overlay fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "pm-modal-panel flex max-h-[calc(100dvh-0.5rem)] w-full flex-col overflow-hidden rounded-t-[24px] bg-surface sm:max-h-[90vh] sm:rounded-[24px]",
          resolvedSize === "small" && "max-w-sm",
          resolvedSize === "medium" && "max-w-lg",
          resolvedSize === "large" && "max-w-3xl",
          resolvedSize === "extraLarge" && "max-w-6xl",
        )}
      >
        <div className="z-10 flex shrink-0 items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4 sm:px-6">
          <div className="min-w-0 py-1.5">
            <h2 id={titleId} className="text-lg font-semibold text-text-primary">{title}</h2>
            {description ? <div className="mt-1 text-sm leading-5 text-text-secondary">{description}</div> : null}
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X size={20} />
          </button>
        </div>
        <div
          ref={scrollRef}
          className="min-h-0 overflow-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
export function ResponsiveActionGroup({
  primary,
  secondary,
  destructive,
  overflowLabel = "더보기",
  className = "",
}: {
  primary?: ReactNode;
  secondary?: ReactNode;
  destructive?: ReactNode;
  overflowLabel?: string;
  className?: string;
}) {
  const hasOverflow = Boolean(secondary || destructive);
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 640,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      const update = () => setMobile(window.innerWidth < 640);
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-testid="responsive-action-group">
      {primary ? <div className="flex flex-wrap gap-2">{primary}</div> : null}
      {hasOverflow && mobile ? (
        <details className="group relative">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center rounded-xl border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
            {overflowLabel} ···
          </summary>
          <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 grid min-w-52 gap-2 rounded-2xl border border-border bg-surface p-2 shadow-[var(--pm-shadow-modal)] [&>button]:w-full">
            {secondary}
            {destructive}
          </div>
        </details>
      ) : hasOverflow ? <div className="flex flex-wrap gap-2">{secondary}{destructive}</div> : null}
    </div>
  );
}
export function ModalActions({
  children,
  className = "",
  stickyDesktop = false,
}: {
  children: ReactNode;
  className?: string;
  stickyDesktop?: boolean;
}) {
  return (
    <div
      data-testid="modal-actions"
      className={cn(
        "sticky -bottom-5 z-20 -mx-5 -mb-5 mt-6 grid grid-cols-2 gap-2 border-t border-border bg-surface/95 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur",
        stickyDesktop
          ? "sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:flex sm:justify-end sm:px-6 sm:py-4"
          : "sm:static sm:mx-0 sm:mb-0 sm:flex sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
export function ConfirmModal({ open, title, description, confirmLabel = "확인", cancelLabel = "취소", processing = false, tone = "danger", onConfirm, onClose }: { open: boolean; title: string; description: ReactNode; confirmLabel?: string; cancelLabel?: string; processing?: boolean; tone?: "primary" | "danger"; onConfirm: () => void; onClose: () => void }) {
  return <Modal open={open} title={title} onClose={() => !processing && onClose()}><div className="text-sm leading-6 text-text-secondary">{description}</div><ModalActions><Button type="button" variant="secondary" disabled={processing} onClick={onClose}>{cancelLabel}</Button><Button type="button" data-modal-initial variant={tone} disabled={processing} onClick={onConfirm}>{processing ? "처리 중..." : confirmLabel}</Button></ModalActions></Modal>;
}
export function EmptyState({
  title = "표시할 데이터가 없습니다",
  description,
  compact = false,
}: {
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "min-h-28 p-4" : "min-h-48 p-6 sm:p-8",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl bg-primary-subtle",
          compact ? "mb-3 h-10 w-10" : "mb-4 h-12 w-12",
        )}
      >
        <Search className="text-text-muted" size={compact ? 18 : 22} />
      </div>
      <p className="font-semibold text-text-primary">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-md text-sm leading-6 text-text-secondary">{description}</p>
      )}
    </div>
  );
}
export function LoadingSpinner({ label = "불러오는 중" }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-primary"><LoaderCircle aria-hidden="true" className="animate-spin" size={20} /><span className="sr-only">{label}</span></span>;
}
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={cn("pm-skeleton rounded-[18px] bg-[#edf0f4]", className)} />;
}
export function LoadingState() {
  return (
    <div className="flex min-h-48 items-center justify-center gap-2.5 text-sm text-text-secondary">
      <LoadingSpinner /> 데이터를 불러오는 중입니다.
    </div>
  );
}
export function ErrorState({
  retry,
  title = "데이터를 불러오지 못했습니다.",
}: {
  retry?: () => void;
  title?: string;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center sm:p-8">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-error-soft"><AlertCircle className="text-error" size={22} /></div>
      <p className="max-w-lg font-semibold text-text-primary">{title}</p>
      {retry && (
        <Button variant="secondary" onClick={retry} className="mt-3">
          다시 시도
        </Button>
      )}
    </div>
  );
}
export function Toast({
  message,
  onClose,
  title,
  description,
  tone = "success",
}: {
  message: string;
  onClose: () => void;
  title?: string;
  description?: string;
  tone?: "success" | "warning" | "error";
}) {
  const presentation = {
    success: { icon: CheckCircle2, surface: "bg-success-soft", color: "text-success", role: "status" as const },
    warning: { icon: AlertCircle, surface: "bg-warning-soft", color: "text-warning", role: "status" as const },
    error: { icon: AlertCircle, surface: "bg-error-soft", color: "text-error", role: "alert" as const },
  }[tone];
  const Icon = presentation.icon;
  return (
    <div
      role={presentation.role}
      className={cn("pm-toast fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-[60] flex items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 text-sm text-text-primary shadow-[var(--pm-shadow-modal)] sm:left-auto sm:right-5 sm:w-full sm:max-w-md", presentation.surface)}
    >
      <Icon size={19} className={cn("mt-0.5 shrink-0", presentation.color)} />
      <div className="min-w-0 flex-1"><p className="font-semibold">{title || message}</p>{title && <p className="mt-0.5 leading-5 text-text-secondary">{message}</p>}{description && <p className="mt-1 leading-5 text-text-secondary">{description}</p>}</div>
      <button type="button" aria-label="알림 닫기" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-white/70 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}
