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
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-[#274c77] text-white hover:bg-[#1d3b5f]",
        variant === "secondary" &&
          "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100",
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
        "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-100",
        className,
      )}
      {...p}
    />
  );
});
export function SearchBox({ className = "", onClear, ...props }: InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValue = String(props.value ?? props.defaultValue ?? "").length > 0;
  const clear = () => { onClear?.(); requestAnimationFrame(() => inputRef.current?.focus()); };
  return <div className={cn("relative", className)}><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-slate-400" size={16} /><Input ref={inputRef} type="search" className={cn("pl-9", hasValue && onClear ? "pr-9" : "")} {...props} />{hasValue && onClear && <button type="button" aria-label="검색어 초기화" className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-700" onClick={clear}><X size={16} /></button>}</div>;
}
export function Select({
  className = "",
  children,
  ...p
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100",
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
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100",
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
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-600">*</span>}
      </span>
      {children}
      {help && (
        <span className="mt-1 block text-xs text-slate-500">{help}</span>
      )}
    </label>
  );
}
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-slate-200 bg-white shadow-sm",
        className,
      )}
    >
      {children}
    </section>
  );
}
export function FilterToolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Card className="mb-4 p-4"><div className={cn("grid gap-3", className)}>{children}</div></Card>;
}
export function Table({ className = "", children, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="overflow-x-auto"><table className={cn("data-table", className)} {...props}>{children}</table></div>;
}

export function Pagination({ page, totalPages, totalLabel, onPageChange }: { page: number; totalPages: number; totalLabel: string; onPageChange: (page: number) => void }) {
  return <nav className="mt-4 flex items-center justify-between gap-3" aria-label="페이지 이동"><p className="text-sm text-slate-500">{page} / {Math.max(1, totalPages)} 페이지 · {totalLabel}</p><div className="flex gap-2"><Button type="button" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>이전</Button><Button type="button" variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>다음</Button></div></nav>;
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
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
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
    green: "bg-blue-50 text-blue-700",
    blue: "bg-sky-50 text-sky-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    gray: "bg-slate-100 text-slate-600",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
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
          "max-h-[90vh] w-full overflow-auto rounded-xl bg-white shadow-xl",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-5 py-4">
          <h2 id={titleId} className="font-bold text-slate-900">{title}</h2>
          <button
            aria-label="닫기"
            onClick={onClose}
            className="rounded p-1 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
export function ConfirmModal({ open, title, description, confirmLabel = "확인", cancelLabel = "취소", processing = false, tone = "danger", onConfirm, onClose }: { open: boolean; title: string; description: ReactNode; confirmLabel?: string; cancelLabel?: string; processing?: boolean; tone?: "primary" | "danger"; onConfirm: () => void; onClose: () => void }) {
  return <Modal open={open} title={title} onClose={() => !processing && onClose()}><div className="text-sm leading-6 text-slate-600">{description}</div><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" disabled={processing} onClick={onClose}>{cancelLabel}</Button><Button type="button" data-modal-initial variant={tone} disabled={processing} onClick={onConfirm}>{processing ? "처리 중..." : confirmLabel}</Button></div></Modal>;
}
export function EmptyState({
  title = "표시할 데이터가 없습니다",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center">
      <Search className="mb-3 text-slate-300" size={32} />
      <p className="font-semibold text-slate-700">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      )}
    </div>
  );
}
export function LoadingSpinner({ label = "불러오는 중" }: { label?: string }) {
  return <span className="inline-flex items-center gap-2"><LoaderCircle aria-hidden="true" className="animate-spin" size={20} /><span className="sr-only">{label}</span></span>;
}
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-xl bg-slate-100", className)} />;
}
export function LoadingState() {
  return (
    <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
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
    <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center">
      <AlertCircle className="mb-2 text-red-500" />
      <p className="font-semibold">{title}</p>
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
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      role="status"
      className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      <CheckCircle2 size={18} className="text-blue-400" />
      {message}
      <button aria-label="알림 닫기" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}
