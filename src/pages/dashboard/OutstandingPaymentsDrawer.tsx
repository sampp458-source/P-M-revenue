import { ArrowUpRight, Banknote, Phone, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, Field, Input, Modal, Select, Textarea, Toast, cn } from "../../components/ui";
import { won } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import { businessUnitOrder, finalSaleAmount, koreanToday, type BusinessUnitOption, type DashboardSale } from "./dashboardMetrics";

const paymentMethodLabels = {
  card: "카드",
  transfer: "계좌이체",
  cash: "현금",
  other: "기타",
} as const;

type PaymentMethod = keyof typeof paymentMethodLabels;

const numeric = (value: string) => value.replace(/\D/g, "");

export const maskedCollectionPhone = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (!/^010[0-9]{8}$/.test(digits)) return null;
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
};

export const outstandingElapsedDays = (
  outstandingDate: string,
  today = koreanToday(),
) => {
  const from = Date.parse(`${outstandingDate}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
};

export const outstandingAgeLabel = (days: number) =>
  days >= 8 ? `D+${days} · 장기 대기` : days >= 4 ? `D+${days} · 주의` : `D+${days}`;

export function OutstandingPaymentsDrawer({
  open,
  unitId,
  unitName,
  units,
  sales,
  title = "현재 미수금",
  description,
  collectionMode = false,
  onClose,
  onChanged,
  onOpenSale,
  onOpenCustomer,
}: {
  open: boolean;
  unitId: string;
  unitName: string;
  units: BusinessUnitOption[];
  sales: DashboardSale[];
  title?: string;
  description?: string;
  collectionMode?: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOpenSale: (saleId: string) => void;
  onOpenCustomer?: (sale: DashboardSale) => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [collecting, setCollecting] = useState<DashboardSale | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [paymentDate, setPaymentDate] = useState(koreanToday());
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const unitOrder = useMemo(
    () => new Map(units.map((unit) => [unit.id, businessUnitOrder(unit)])),
    [units],
  );
  const rows = useMemo(
    () =>
      sales
        .filter(
          (sale) =>
            sale.outstandingAmount > 0 &&
            sale.status !== "cancelled" &&
            (!unitId || sale.businessUnitId === unitId),
        )
        .sort(
          (left, right) =>
            left.saleDate.localeCompare(right.saleDate) ||
            (unitOrder.get(left.businessUnitId) ?? 99) -
              (unitOrder.get(right.businessUnitId) ?? 99) ||
            left.createdAt.localeCompare(right.createdAt),
        ),
    [sales, unitId, unitOrder],
  );
  const outstandingTotal = rows.reduce(
    (total, sale) => total + sale.outstandingAmount,
    0,
  );

  useEffect(() => {
    if (!open) return;
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving || collecting) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      openerRef.current?.focus();
    };
  }, [collecting, onClose, open, saving]);

  const startCollection = (sale: DashboardSale) => {
    setCollecting(sale);
    setAmount(sale.outstandingAmount.toLocaleString("ko-KR"));
    setPaymentMethod("card");
    setPaymentDate(koreanToday());
    setNote("");
    setRequestId(crypto.randomUUID());
    setError("");
  };

  const submitCollection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!collecting || saving) return;
    const parsedAmount = Number(numeric(amount));
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      setError("수납 금액을 확인해 주세요.");
      return;
    }
    if (parsedAmount > collecting.outstandingAmount) {
      setError("수납 금액은 현재 미수금을 초과할 수 없습니다.");
      return;
    }
    if (!paymentDate) {
      setError("결제일을 선택해 주세요.");
      return;
    }

    setSaving(true);
    setError("");
    const result = await supabase.rpc("add_sale_payment", {
      p_sale_id: collecting.id,
      p_amount: parsedAmount,
      p_payment_method: paymentMethod,
      p_payment_date: paymentDate,
      p_note: note.trim() || null,
      p_request_id: requestId,
    });
    if (result.error) {
      setError(`수납 처리에 실패했습니다: ${result.error.message}`);
      setSaving(false);
      return;
    }
    await onChanged();
    setSaving(false);
    setCollecting(null);
    setNotice(
      parsedAmount === collecting.outstandingAmount
        ? "미수금을 완납 처리했습니다."
        : "미수금을 부분 수납 처리했습니다.",
    );
  };

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label={`${title} 닫기`}
        className="pm-drawer-overlay fixed inset-0 z-30 bg-slate-950/35 backdrop-blur-[1px]"
        onClick={() => !saving && !collecting && onClose()}
      />
      <aside
        aria-labelledby={titleId}
        className={cn(
          "pm-modal-panel fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l shadow-[var(--pm-shadow-modal)] sm:w-[min(680px,58vw)]",
          collectionMode
            ? "pm-collection-drawer border-border !bg-[#f5f7fb] text-text-primary"
            : "border-white/10 bg-[#111e31] text-white",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-start justify-between gap-4 border-b px-5 py-3.5 sm:px-6 sm:py-4",
            collectionMode ? "border-border bg-surface" : "border-white/10",
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                collectionMode
                  ? "bg-amber-50 text-amber-700"
                  : "bg-amber-200/15 text-amber-200",
              )}
            >
              <Banknote size={19} />
            </span>
            <div className="min-w-0">
              <h2
                id={titleId}
                className={cn(
                  "text-xl font-bold tracking-[-0.025em]",
                  collectionMode ? "text-text-primary" : "text-white",
                )}
              >
                {title}
              </h2>
              <p
                className={cn(
                  "mt-1 break-keep text-sm leading-5",
                  collectionMode ? "text-text-secondary" : "text-slate-300",
                )}
              >
                {description ?? `${unitName} · 발생일과 관계없이 남은 미수 전체`}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={`${title} 닫기`}
            onClick={onClose}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors focus:outline-none focus-visible:ring-2",
              collectionMode
                ? "text-text-secondary hover:bg-surface-secondary hover:text-text-primary focus-visible:ring-primary"
                : "text-slate-300 hover:bg-white/10 hover:text-white focus-visible:ring-blue-300",
            )}
          >
            <X size={20} />
          </button>
        </div>
        <div
          className={cn(
            "sticky top-0 z-10 grid grid-cols-2 gap-2 border-b p-3.5 backdrop-blur sm:gap-3 sm:px-6 sm:py-4",
            collectionMode
              ? "border-border bg-[#f5f7fb]/95"
              : "border-white/10 bg-[#111e31]/95",
          )}
        >
          <div
            className={cn(
              "min-w-0 rounded-2xl border p-3 sm:p-4",
              collectionMode
                ? "border-border bg-surface text-text-primary shadow-[var(--pm-shadow-surface)]"
                : "border-white/10 bg-white/[0.055] text-white",
            )}
          >
            <span className={cn("text-xs", collectionMode ? "text-text-secondary" : "text-blue-200")}>
              {collectionMode ? "받아야 할 결제" : "남은 미수금"}
            </span>
            <strong className={cn("mt-1 block whitespace-nowrap text-[clamp(1rem,5vw,1.25rem)] tracking-[-0.035em] tabular-nums", collectionMode ? "text-text-primary" : "text-white")}>{won(outstandingTotal)}</strong>
          </div>
          <div
            className={cn(
              "min-w-0 rounded-2xl border p-3 sm:p-4",
              collectionMode
                ? "border-amber-200/80 bg-amber-50/70 shadow-[var(--pm-shadow-surface)]"
                : "border-amber-200/15 bg-amber-200/[0.07]",
            )}
          >
            <span className={cn("text-xs", collectionMode ? "text-amber-800" : "text-amber-200")}>
              {collectionMode ? "수금 대기 고객" : "미수 거래"}
            </span>
            <strong className={cn("mt-1 block whitespace-nowrap text-[clamp(1rem,5vw,1.25rem)] tabular-nums", collectionMode ? "text-text-primary" : "text-white")}>{rows.length}건</strong>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6">
          {rows.length ? (
            <div className={cn(collectionMode ? "space-y-2.5 sm:space-y-3" : "space-y-3")}>
              {rows.map((sale) => (
                <article
                  key={sale.id}
                  className={cn(
                    "rounded-2xl border transition-[border-color,box-shadow,background-color] duration-150",
                    collectionMode
                      ? "border-border bg-surface p-3.5 shadow-[var(--pm-shadow-surface)] md:hover:-translate-y-0.5 md:hover:border-primary/25 md:hover:shadow-[0_10px_28px_rgba(23,54,93,0.09)] sm:p-5"
                      : "border-white/10 bg-white/[0.045] p-4 md:hover:border-white/20 md:hover:shadow-[0_10px_26px_rgba(0,0,0,0.16)] sm:p-5",
                  )}
                >
                  {collectionMode ? (
                    <>
                      <div>
                        <span className="text-[11px] font-semibold text-amber-700">
                          미수금
                        </span>
                        <strong className="mt-0.5 block whitespace-nowrap text-[clamp(1.3rem,6vw,1.65rem)] font-bold tracking-[-0.035em] text-text-primary tabular-nums">
                          {won(sale.outstandingAmount)}
                        </strong>
                      </div>
                      {onOpenCustomer ? (
                        <button
                          type="button"
                          className="group mt-2.5 inline-flex items-center gap-1 rounded-md text-left text-base font-bold leading-6 text-text-primary underline decoration-primary/25 underline-offset-4 transition-colors hover:text-primary hover:decoration-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-lg"
                          onClick={() => onOpenCustomer(sale)}
                        >
                          {sale.customerName || "보호자 미등록"}
                          <ArrowUpRight
                            size={14}
                            aria-hidden="true"
                            className="text-primary/60 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                          />
                          <span className="sr-only">보호자 프로필 보기</span>
                        </button>
                      ) : (
                        <h3 className="mt-2.5 break-keep text-base font-bold leading-6 text-text-primary sm:text-lg">
                          {sale.customerName || "보호자 미등록"}
                        </h3>
                      )}
                      <p className="mt-0.5 break-keep text-sm font-medium leading-5 text-text-secondary">
                        반려견 {sale.dogName || "미등록"}
                      </p>
                      {sale.customerPhone && maskedCollectionPhone(sale.customerPhone) ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-xs leading-5 text-text-secondary tabular-nums">
                            {maskedCollectionPhone(sale.customerPhone)}
                          </span>
                          <a
                            href={`tel:${sale.customerPhone.replace(/[^\d+]/g, "")}`}
                            aria-label={`${sale.customerName || "보호자"}에게 전화`}
                            className={cn(
                              "inline-flex min-h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2",
                              "border-border bg-surface-secondary text-text-primary hover:border-primary/25 hover:bg-primary-soft focus-visible:ring-primary",
                            )}
                          >
                            <Phone size={13} aria-hidden="true" />
                            전화
                          </a>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs leading-5 text-text-muted">
                          연락처 미등록
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/80 pt-3">
                        <Badge tone="blue">{sale.businessUnitName}</Badge>
                        <OutstandingAgeBadge saleDate={sale.saleDate} light />
                        <span className="text-[11px] text-text-muted tabular-nums">
                          발생일 {sale.saleDate}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-2.5 sm:gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="blue">{sale.businessUnitName}</Badge>
                          <span className="text-xs text-slate-300 tabular-nums">
                            발생일 {sale.saleDate}
                          </span>
                        </div>
                        <h3 className="mt-2 break-keep text-lg font-bold leading-6 text-white">
                          {sale.dogName || "(반려견 없음)"}
                        </h3>
                        <p className="mt-1 break-keep text-sm leading-5 text-slate-200">
                          {sale.customerName || "보호자 미등록"}
                        </p>
                        <p className="mt-1 break-keep text-xs leading-5 text-slate-300">
                          {sale.productName}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="text-xs font-semibold text-amber-200">
                          현재 미수
                        </span>
                        <strong className="mt-1 block whitespace-nowrap text-[clamp(1.05rem,5vw,1.25rem)] text-white tabular-nums">
                          {won(sale.outstandingAmount)}
                        </strong>
                      </div>
                    </div>
                  )}
                  {!collectionMode && (
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-sm sm:grid-cols-3">
                      <LedgerValue label="최종 판매금액" value={won(finalSaleAmount(sale))} />
                      <LedgerValue label="기존 수납액" value={won(sale.paidAmount)} />
                      <LedgerValue label="메모" value={sale.memo || "없음"} />
                    </dl>
                  )}
                  <div className={cn("grid grid-cols-2 gap-2", collectionMode ? "mt-3 sm:mt-4 sm:flex sm:flex-row" : "mt-4 sm:flex sm:flex-row")}>
                    <Button
                      type="button"
                      className={cn("w-full sm:w-auto", collectionMode && "min-h-10 px-3 py-2 text-[13px] sm:min-h-11 sm:px-4 sm:py-2.5 sm:text-sm")}
                      onClick={() => startCollection(sale)}
                    >
                      {collectionMode ? "결제받기" : "수납하기"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className={cn("w-full sm:w-auto", collectionMode && "min-h-10 px-3 py-2 text-[13px] sm:min-h-11 sm:px-4 sm:py-2.5 sm:text-sm")}
                      onClick={() => onOpenSale(sale.id)}
                    >
                      거래 확인
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={cn(!collectionMode && "[&_*]:text-slate-300")}>
              <EmptyState
                title={collectionMode ? "현재 수금 대기 고객이 없습니다." : "남아 있는 미수금이 없습니다"}
                description={
                  collectionMode
                    ? "현재 처리해야 할 미수 거래가 없습니다."
                    : `${unitName}의 모든 거래가 완납되었습니다.`
                }
              />
            </div>
          )}
        </div>
      </aside>

      <Modal
        open={Boolean(collecting)}
        title="미수금 수납"
        onClose={() => !saving && setCollecting(null)}
      >
        {collecting && (
          <form onSubmit={submitCollection}>
            <div className="rounded-2xl bg-surface-secondary p-4">
              <p className="font-semibold text-text-primary">
                {collecting.dogName || "(반려견 없음)"} · {collecting.customerName || "보호자 미등록"}
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                현재 미수 {won(collecting.outstandingAmount)}
              </p>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="수납 금액" required>
                <Input
                  data-modal-initial
                  inputMode="numeric"
                  value={amount}
                  onChange={(event) =>
                    setAmount(
                      numeric(event.target.value)
                        ? Number(numeric(event.target.value)).toLocaleString("ko-KR")
                        : "",
                    )
                  }
                  aria-invalid={Boolean(error)}
                />
              </Field>
              <Field label="결제수단" required>
                <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                  {Object.entries(paymentMethodLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="결제일" required>
                <Input type="date" max={koreanToday()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              </Field>
              <Field label="메모">
                <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="선택 입력" />
              </Field>
            </div>
            {error && <p role="alert" className="mt-4 rounded-xl bg-error-soft px-4 py-3 text-sm text-error">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setCollecting(null)}>취소</Button>
              <Button type="submit" disabled={saving}>{saving ? "수납 처리 중..." : "수납 완료"}</Button>
            </div>
          </form>
        )}
      </Modal>
      {notice && (
        <Toast
          message={notice}
          title="결제 처리가 완료되었습니다."
          onClose={() => setNotice("")}
        />
      )}
    </>
  );
}

function LedgerValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-300">{label}</dt>
      <dd className={cn("mt-1 break-words font-semibold leading-5 text-white", label !== "메모" && "whitespace-nowrap tabular-nums")}>{value}</dd>
    </div>
  );
}

function OutstandingAgeBadge({
  saleDate,
  light = false,
}: {
  saleDate: string;
  light?: boolean;
}) {
  const days = outstandingElapsedDays(saleDate);
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        days <= 3 &&
          (light
            ? "border-border bg-surface-secondary text-text-secondary"
            : "border-white/10 bg-white/[0.06] text-slate-200"),
        days >= 4 &&
          days <= 7 &&
          (light
            ? "border-amber-300 bg-amber-50 text-amber-800"
            : "border-amber-200/25 bg-amber-200/10 text-amber-100"),
        days >= 8 &&
          (light
            ? "border-rose-300 bg-rose-50 px-2.5 font-bold text-rose-700 shadow-[0_0_0_1px_rgba(225,29,72,0.04)]"
            : "border-rose-200/25 bg-rose-200/10 text-rose-100"),
      )}
    >
      {outstandingAgeLabel(days)}
    </span>
  );
}
