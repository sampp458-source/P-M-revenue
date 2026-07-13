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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-[color,background-color,border-color,transform,opacity] duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:translate-y-px disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-primary text-white hover:bg-primary-hover",
        variant === "secondary" &&
          "border border-border-strong bg-surface text-text-primary hover:border-primary/30 hover:bg-primary-subtle",
        variant === "danger" && "bg-error text-white hover:bg-[#aa4141]",
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
        "rounded-[18px]",
        variant === "surface" && "border border-border bg-surface shadow-[var(--pm-shadow-surface)]",
        variant === "emphasized" && "border border-primary/15 bg-primary-subtle shadow-[var(--pm-shadow-surface)]",
        variant === "interactive" && "border border-border bg-surface shadow-[var(--pm-shadow-surface)] transition-[background-color,border-color,transform,box-shadow] duration-200 ease-out hover:border-primary/20 hover:bg-primary-subtle",
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
export function Table({ className = "", children, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="overflow-x-auto overscroll-x-contain rounded-[inherit]"><table className={cn("data-table", className)} {...props}>{children}</table></div>;
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
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
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
          "pm-modal-panel max-h-[calc(100dvh-0.5rem)] w-full overflow-auto rounded-t-[24px] bg-surface sm:max-h-[90vh] sm:rounded-[24px]",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-4 sm:px-6">
          <h2 id={titleId} className="text-lg font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">{children}</div>
      </div>
    </div>
  );
}
export function ConfirmModal({ open, title, description, confirmLabel = "확인", cancelLabel = "취소", processing = false, tone = "danger", onConfirm, onClose }: { open: boolean; title: string; description: ReactNode; confirmLabel?: string; cancelLabel?: string; processing?: boolean; tone?: "primary" | "danger"; onConfirm: () => void; onClose: () => void }) {
  return <Modal open={open} title={title} onClose={() => !processing && onClose()}><div className="text-sm leading-6 text-text-secondary">{description}</div><div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:justify-end"><Button type="button" variant="secondary" disabled={processing} onClick={onClose}>{cancelLabel}</Button><Button type="button" data-modal-initial variant={tone} disabled={processing} onClick={onConfirm}>{processing ? "처리 중..." : confirmLabel}</Button></div></Modal>;
}
export function EmptyState({
  title = "표시할 데이터가 없습니다",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center sm:p-8">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-subtle"><Search className="text-text-muted" size={22} /></div>
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
