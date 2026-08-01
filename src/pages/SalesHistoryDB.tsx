import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dog,
  Eye,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { SearchSelect } from "../components/SearchSelect";
import {
  Badge,
  Button,
  Card,
  cn,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Field,
  FilterToolbar,
  Input,
  LoadingState,
  Modal,
  Pagination,
  PageHeader,
  SearchBox,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  Textarea,
  Toast,
} from "../components/ui";
import { koDate, won } from "../lib/format";
import { formatPhoneForDisplay } from "../lib/phone";
import { supabase } from "../lib/supabase";
import {
  logSupabaseError,
  partyMutationError,
} from "../lib/supabaseError";
import {
  calculateTodayActivity,
  calculateSalesSummary,
  businessUnitDisplayOrder,
  canReclassifyRefundedSaleAsEntryError,
  filterSales,
  findDuplicateWarnings,
  hasOutstanding,
  isRefundDateAllowed,
  koreanDate,
  periodRange,
  refundRemainingAmount,
  shiftDateKey,
  todayRegisteredSales,
  type DuplicateWarning,
  type PeriodFilter,
  type SalesHistoryFilters,
  type SalesHistoryRecord,
  type SaleStatus,
  type StatusFilter,
} from "./salesHistoryLogic";
import {
  calculateFinalSaleAmount,
  calculateOutstandingAmount,
  isValidPaymentPlan,
} from "./saleRegistrationLogic";
import { paymentMethodLabels, paymentSummary, type SalePaymentRow } from "./salePaymentLogic";
import { normalizePaymentRows, paymentRowsTotal } from "./salePaymentLogic";
import {
  calculateCurrentOutstanding,
  calculatePaymentAggregate,
  calculateRefundAggregate,
  calculateSalesAggregate,
  type PaymentLedgerEntry,
  type RefundLedgerEntry,
} from "./paymentLedgerMetrics";
import {
  accountingEventLabel,
  buildAccountingEvents,
  filterAccountingEvents,
  type AccountingEvent,
} from "./accountingLedgerEvents";
import {
  detailProductName,
  detailPaymentRows,
  formatQuantityWithUnit,
  isEstimatedInitialPaymentDate,
  refundDetailKinds,
} from "./salesDetailLogic";
import {
  buildSalePartyRpcPayload,
  findCustomerPhoneDuplicate,
  findDogNameDuplicate,
  hasCustomerIdentity,
  normalizeCustomerPhone,
} from "./customerIdentity";
import { fetchStaffFinanceDay } from "./staffFinanceDayRepository";

interface SaleRow extends SalesHistoryRecord {
  businessUnitName: string;
  pricingStored: boolean;
  quantity: number;
  unitPrice: number;
  originalAmount: number;
  adjustmentsStored: boolean;
  additionalAmount: number;
  discountAmount: number;
  adjustmentNote: string | null;
  customerType: string;
  memo: string | null;
  cancellationReason: string | null;
  updatedAt: string;
  paymentRows: SalePaymentRow[];
  paymentLedger: PaymentLedgerRow[];
  unitLabel: string | null;
  initialOutstandingEstimated: boolean;
  cancellationType: "entry_error" | "general" | "legacy" | null;
}

interface SaleQueryRow {
  id: string;
  sale_date: string;
  business_unit_id: string;
  business_unit_name: string;
  dog_id: string | null;
  dog_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone?: string | null;
  product_category_id: string | null;
  product_category_name: string | null;
  product_id: string;
  product_name: string;
  quantity?: number | null;
  unit_price?: number | null;
  original_amount: number;
  additional_amount?: number | null;
  discount_amount: number;
  adjustment_note?: string | null;
  paid_amount: number;
  refund_amount: number;
  outstanding_amount: number;
  net_amount: number;
  payment_method: string;
  customer_type: string;
  status: string;
  staff_id: string | null;
  staff_name: string | null;
  memo: string | null;
  created_by: string;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  initial_outstanding_estimated?: boolean | null;
  cancellation_type?: "entry_error" | "general" | "legacy" | null;
}

interface LinkedSalePartyRow {
  customer_id: string | null;
  dog_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  dog_name: string | null;
}

interface HistoryRow {
  id: string;
  action: string;
  previousData: unknown;
  changedData: unknown;
  changedBy: string;
  createdAt: string;
}

interface RefundRow {
  id: string;
  refundDate: string | null;
  amount: number;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
  isLegacy: boolean;
  voidedAt: string | null;
}

interface PaymentLedgerRow {
  id: string;
  saleId: string;
  method: SalePaymentRow["method"];
  amount: number;
  paymentDate: string;
  source: "initial" | "outstanding_collection" | "adjustment";
  note: string | null;
  createdBy: string;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

interface PaymentLedgerQueryRow {
  id: string;
  sale_id: string;
  payment_method: SalePaymentRow["method"];
  amount: number;
  payment_date: string;
  source: PaymentLedgerRow["source"];
  note: string | null;
  created_by: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

interface RefundLedgerQueryRow {
  id: string;
  sale_id: string;
  refund_date: string;
  amount: number;
  voided_at: string | null;
}

interface PartyCustomer {
  id: string;
  name: string | null;
  phone: string | null;
}

interface PartyDog {
  id: string;
  customerId: string | null;
  name: string;
  breed: string | null;
}

const paymentLabel: Record<string, string> = {
  card: "카드",
  transfer: "계좌이체",
  cash: "현금",
  outstanding: "미수",
  other: "기타",
};
const statusLabel: Record<StatusFilter, string> = {
  "": "전체",
  normal: "정상",
  partial_refund: "부분환불",
  full_refund: "전체환불",
  cancelled: "취소",
  outstanding: "미수금",
};
const periodLabel: Record<PeriodFilter, string> = {
  today: "오늘",
  week: "이번 주",
  month: "이번 달",
  last_month: "지난달",
  custom: "직접 선택",
};
const validPeriods = new Set<PeriodFilter>([
  "today",
  "week",
  "month",
  "last_month",
  "custom",
]);
const validStatuses = new Set<StatusFilter>([
  "",
  "normal",
  "partial_refund",
  "full_refund",
  "cancelled",
  "outstanding",
]);
const saleFields =
  "id, sale_date, business_unit_id, business_unit_name, dog_id, dog_name, customer_id, customer_name, product_category_id, product_category_name, product_id, product_name, original_amount, discount_amount, paid_amount, refund_amount, outstanding_amount, net_amount, payment_method, customer_type, status, staff_id, staff_name, memo, created_by, cancellation_reason, created_at, updated_at, cancelled_at";
const saleFieldsWithPhone = saleFields.replace(
  "customer_name,",
  "customer_name, customer_phone,",
);
const saleFieldsWithPricing = saleFieldsWithPhone.replace(
  "product_name,",
  "product_name, quantity, unit_price,",
);
const saleFieldsWithAdjustments = saleFieldsWithPricing.replace(
  "discount_amount,",
  "additional_amount, discount_amount, adjustment_note,",
);
const saleFieldsWithLedgerMetadata = `${saleFieldsWithAdjustments}, initial_outstanding_estimated`;
const saleFieldsWithCancellationMetadata = `${saleFieldsWithLedgerMetadata}, cancellation_type`;

async function loadSaleRows() {
  const withCancellationMetadata = await supabase
    .from("sales")
    .select(saleFieldsWithCancellationMetadata)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (!withCancellationMetadata.error) return withCancellationMetadata;
  const withLedgerMetadata = await supabase
    .from("sales")
    .select(saleFieldsWithLedgerMetadata)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (!withLedgerMetadata.error) return withLedgerMetadata;
  const withAdjustments = await supabase
    .from("sales")
    .select(saleFieldsWithAdjustments)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (!withAdjustments.error) return withAdjustments;
  const current = await supabase
    .from("sales")
    .select(saleFieldsWithPricing)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (!current.error) return current;
  const withPhone = await supabase
    .from("sales")
    .select(saleFieldsWithPhone)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (!withPhone.error) return withPhone;
  return supabase
    .from("sales")
    .select(saleFields)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });
}

const numberFilter = (value: string | null) => {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const displayPhone = (phone: string | null) =>
  formatPhoneForDisplay(phone) || "-";

const dateTime = (value: string) =>
  new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function useMobileLayout() {
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function SalesHistoryPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isFinanceAdmin = profile?.role === "admin";
  const today = koreanDate(new Date());
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [refundLedger, setRefundLedger] = useState<RefundLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const ledgerView = searchParams.get("view") !== "sales";
  const query = searchParams.get("q") ?? "";
  const periodParam = searchParams.get("period") as PeriodFilter | null;
  const requestedPeriod =
    periodParam && validPeriods.has(periodParam) ? periodParam : "month";
  const requestedStartDate = searchParams.get("start") ?? "";
  const staffSelectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedStartDate)
    ? requestedStartDate
    : today;
  const period = isFinanceAdmin ? requestedPeriod : "custom";
  const startDate = isFinanceAdmin ? requestedStartDate : staffSelectedDate;
  const endDate = isFinanceAdmin
    ? (searchParams.get("end") ?? "")
    : staffSelectedDate;
  const unitId = searchParams.get("unit") ?? "";
  const statusParam = searchParams.get("status") as StatusFilter | null;
  const status =
    statusParam && validStatuses.has(statusParam) ? statusParam : "";
  const staffId = searchParams.get("staff") ?? "";
  const createdBy = searchParams.get("createdBy") ?? "";
  const paymentMethod = searchParams.get("payment") ?? "";
  const categoryId = searchParams.get("category") ?? "";
  const productId = searchParams.get("product") ?? "";
  const minAmount = numberFilter(searchParams.get("min"));
  const maxAmount = numberFilter(searchParams.get("max"));
  const requestedPage = Math.max(1, Number(searchParams.get("page")) || 1);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const hasAdvancedFilters = [
    "staff",
    "createdBy",
    "payment",
    "category",
    "product",
    "min",
    "max",
  ].some((key) => searchParams.has(key));
  const [advancedOpen, setAdvancedOpen] = useState(hasAdvancedFilters);
  const mobileLayout = useMobileLayout();
  const [selected, setSelected] = useState<SaleRow | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [refundHistory, setRefundHistory] = useState<RefundRow[]>([]);
  const [refundHistoryLoading, setRefundHistoryLoading] = useState(false);
  const [refundHistoryError, setRefundHistoryError] = useState(false);
  const [voidingPayment, setVoidingPayment] = useState<PaymentLedgerRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [partyCustomers, setPartyCustomers] = useState<PartyCustomer[]>([]);
  const [partyDogs, setPartyDogs] = useState<PartyDog[]>([]);
  const [partySaving, setPartySaving] = useState(false);
  const [partyModal, setPartyModal] = useState<"customer" | "dog" | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [newDog, setNewDog] = useState({ name: "", breed: "" });
  const [partyError, setPartyError] = useState("");
  const [duplicatePartyDog, setDuplicatePartyDog] = useState<PartyDog | null>(null);
  const [allowDuplicatePartyDog, setAllowDuplicatePartyDog] = useState(false);
  const [editing, setEditing] = useState<SaleRow | null>(null);
  const [refunding, setRefunding] = useState<SaleRow | null>(null);
  const [cancelling, setCancelling] = useState<SaleRow | null>(null);
  const [correctingRefundedEntryError, setCorrectingRefundedEntryError] =
    useState<SaleRow | null>(null);
  const [reopening, setReopening] = useState<SaleRow | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundDate, setRefundDate] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellationType, setCancellationType] = useState<
    "" | "general" | "entry_error"
  >("");
  const [confirmedNoPayment, setConfirmedNoPayment] = useState(false);
  const [cancellationRequestId, setCancellationRequestId] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [confirmedNoActualPayment, setConfirmedNoActualPayment] =
    useState(false);
  const [confirmedNoActualRefund, setConfirmedNoActualRefund] = useState(false);
  const [correctionRequestId, setCorrectionRequestId] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const pageSize = 20;

  const updateParams = useCallback(
    (
      updates: Record<string, string | null>,
      resetPage = true,
      replace = false,
    ) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(updates).forEach(([key, value]) => {
        if (value) next.set(key, value);
        else next.delete(key);
      });
      if (resetPage) next.delete("page");
      setSearchParams(next, { replace });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (isFinanceAdmin) return;
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (next.get("period") !== "custom") {
      next.set("period", "custom");
      changed = true;
    }
    if (next.get("start") !== staffSelectedDate) {
      next.set("start", staffSelectedDate);
      changed = true;
    }
    if (next.get("end") !== staffSelectedDate) {
      next.set("end", staffSelectedDate);
      changed = true;
    }
    if (next.has("unit")) {
      next.delete("unit");
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [
    isFinanceAdmin,
    searchParams,
    setSearchParams,
    staffSelectedDate,
  ]);

  useEffect(() => {
    if (hasAdvancedFilters) setAdvancedOpen(true);
  }, [hasAdvancedFilters]);

  const loadSales = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    let staffDay:
      | Awaited<ReturnType<typeof fetchStaffFinanceDay>>
      | null = null;
    if (!isFinanceAdmin) {
      try {
        staffDay = await fetchStaffFinanceDay(staffSelectedDate);
      } catch {
        setSales([]);
        setRefundLedger([]);
        setLoadError(true);
        setLoading(false);
        return;
      }
    }
    const [
      result,
      profilesResult,
      customersResult,
      paymentsResult,
      productUnitsResult,
      dogsResult,
      refundsResult,
    ] = await Promise.all([
      isFinanceAdmin
        ? loadSaleRows()
        : Promise.resolve({
            data: (staffDay?.sales ?? []) as unknown as SaleQueryRow[],
            error: null,
          }),
      supabase.rpc("get_staff_history_directory"),
      supabase.from("customers").select("id, name, phone, is_active").order("name"),
      isFinanceAdmin
        ? supabase.from("sale_payments").select("id, sale_id, payment_method, amount, payment_date, source, note, created_by, created_at, voided_at, voided_by, void_reason").order("payment_date").order("created_at")
        : Promise.resolve({
            data: (staffDay?.payments ?? []) as unknown as PaymentLedgerQueryRow[],
            error: null,
          }),
      supabase.from("products").select("id, unit_label"),
      supabase.from("dogs").select("id, customer_id, name, breed").eq("is_active", true).order("name"),
      isFinanceAdmin
        ? supabase.from("sale_refunds").select("id, sale_id, refund_date, amount, voided_at")
        : Promise.resolve({
            data: (staffDay?.refunds ?? []) as unknown as RefundLedgerQueryRow[],
            error: null,
          }),
    ]);
    if (
      result.error ||
      customersResult.error ||
      paymentsResult.error ||
      refundsResult.error
    ) {
      setSales([]);
      setRefundLedger([]);
      setLoadError(true);
    } else {
      const saleRows = (result.data ?? []) as unknown as SaleQueryRow[];
      const customerPhones = new Map(
        (customersResult.data ?? []).map((customer) => [
          customer.id,
          customer.phone,
        ]),
      );
      setPartyCustomers(
        (customersResult.data ?? []).filter((customer) => customer.is_active),
      );
      if (!dogsResult.error)
        setPartyDogs(
          (dogsResult.data ?? []).map((dog) => ({
            id: dog.id,
            customerId: dog.customer_id,
            name: dog.name,
            breed: dog.breed,
          })),
        );
      const names = Object.fromEntries(
        (profilesResult.data ?? []).map((row: { id: string; name: string }) => [
          row.id,
          row.name,
        ]),
      );
      const paymentsBySale = new Map<string, SalePaymentRow[]>();
      const paymentLedgerBySale = new Map<string, PaymentLedgerRow[]>();
      if (!paymentsResult.error)
        (paymentsResult.data ?? []).forEach((payment) => {
          const ledgerRows = paymentLedgerBySale.get(payment.sale_id) ?? [];
          ledgerRows.push({
            id: payment.id,
            saleId: payment.sale_id,
            method: payment.payment_method as SalePaymentRow["method"],
            amount: payment.amount,
            paymentDate: payment.payment_date,
            source: payment.source as PaymentLedgerRow["source"],
            note: payment.note,
            createdBy: payment.created_by,
            createdAt: payment.created_at,
            voidedAt: payment.voided_at,
            voidedBy: payment.voided_by,
            voidReason: payment.void_reason,
          });
          paymentLedgerBySale.set(payment.sale_id, ledgerRows);
          if (payment.voided_at === null) {
            const rows = paymentsBySale.get(payment.sale_id) ?? [];
            rows.push({ method: payment.payment_method as SalePaymentRow["method"], amount: payment.amount });
            paymentsBySale.set(payment.sale_id, rows);
          }
        });
      const productUnits = new Map<string, string | null>();
      if (!productUnitsResult.error)
        (productUnitsResult.data ?? []).forEach((product) => {
          productUnits.set(product.id, product.unit_label ?? null);
        });
      setSales(
        saleRows.map((sale) => ({
          id: sale.id,
          saleDate: sale.sale_date,
          businessUnitId: sale.business_unit_id,
          businessUnitName: sale.business_unit_name,
          dogId: sale.dog_id,
          customerId: sale.customer_id,
          productCategoryId: sale.product_category_id,
          productId: sale.product_id,
          dogName: sale.dog_name || "(반려견 없음)",
          customerName: sale.customer_name,
          categoryName: sale.product_category_name || "미분류",
          productName: sale.product_name,
          customerPhone:
            sale.customer_phone ??
            (sale.customer_id
              ? (customerPhones.get(sale.customer_id) ?? null)
              : null),
          pricingStored:
            sale.quantity !== undefined &&
            sale.quantity !== null &&
            sale.unit_price !== undefined &&
            sale.unit_price !== null,
          quantity: sale.quantity ?? 1,
          unitPrice: sale.unit_price ?? sale.original_amount,
          originalAmount: sale.original_amount,
          adjustmentsStored:
            sale.additional_amount !== undefined &&
            sale.additional_amount !== null,
          additionalAmount: sale.additional_amount ?? 0,
          discountAmount: sale.discount_amount,
          adjustmentNote: sale.adjustment_note ?? null,
          paidAmount: sale.paid_amount,
          refundAmount: sale.refund_amount,
          outstandingAmount: sale.outstanding_amount,
          netAmount: sale.net_amount,
          paymentMethod: sale.payment_method,
          paymentRows: paymentsBySale.get(sale.id) ?? [],
          paymentLedger: paymentLedgerBySale.get(sale.id) ?? [],
          unitLabel: productUnits.get(sale.product_id) ?? null,
          initialOutstandingEstimated:
            sale.initial_outstanding_estimated ?? false,
          cancellationType: sale.cancellation_type ?? null,
          paymentMethods: (paymentsBySale.get(sale.id) ?? []).map((row) => row.method),
          customerType: sale.customer_type,
          status: sale.status as SaleStatus,
          staffId: sale.staff_id,
          staffName: sale.staff_name,
          memo: sale.memo,
          createdBy: sale.created_by,
          registrarName: names[sale.created_by] ?? null,
          cancellationReason: sale.cancellation_reason,
          createdAt: sale.created_at,
          updatedAt: sale.updated_at,
          cancelledAt: sale.cancelled_at,
        })),
      );
      setRefundLedger(
        (refundsResult.data ?? []).map((refund) => ({
          id: refund.id,
          saleId: refund.sale_id,
          refundDate: refund.refund_date,
          amount: refund.amount,
          voidedAt: refund.voided_at,
        })),
      );
    }
    if (!profilesResult.error)
      setProfileNames(
        Object.fromEntries(
          (profilesResult.data ?? []).map(
            (row: { id: string; name: string }) => [row.id, row.name],
          ),
        ),
      );
    setLoading(false);
  }, [isFinanceAdmin, staffSelectedDate]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  const units = useMemo(
    () =>
      [
        ...new Map(
          sales.map((sale) => [sale.businessUnitId, sale.businessUnitName]),
        ).entries(),
      ].sort(
        (left, right) =>
          businessUnitDisplayOrder(left[1]) -
            businessUnitDisplayOrder(right[1]) ||
          left[1].localeCompare(right[1], "ko"),
      ),
    [sales],
  );
  const filters: SalesHistoryFilters = useMemo(
    () => ({
      query: debouncedQuery,
      period,
      startDate,
      endDate,
      unitId,
      status,
      staffId,
      createdBy,
      paymentMethod,
      categoryId,
      productId,
      minAmount,
      maxAmount,
    }),
    [
      categoryId,
      createdBy,
      debouncedQuery,
      endDate,
      maxAmount,
      minAmount,
      paymentMethod,
      period,
      productId,
      staffId,
      startDate,
      status,
      unitId,
    ],
  );
  const filtered = useMemo(
    () => filterSales(sales, filters, today),
    [filters, sales, today],
  );
  const activeRange = useMemo(
    () => periodRange(period, today, startDate, endDate),
    [endDate, period, startDate, today],
  );
  const contextSummary = useMemo(
    () => calculateSalesSummary(filtered),
    [filtered],
  );
  const selectedUnitName =
    units.find(([id]) => id === unitId)?.[1] ?? "전체 사업부";
  const singleDay =
    Boolean(activeRange.start) && activeRange.start === activeRange.end;
  const paymentEntries = useMemo<PaymentLedgerEntry[]>(
    () =>
      sales.flatMap((sale) =>
        sale.paymentLedger.map((payment) => ({
          id: payment.id,
          saleId: payment.saleId,
          paymentDate: payment.paymentDate,
          amount: payment.amount,
          voidedAt: payment.voidedAt,
          paymentMethod: payment.method,
          source: payment.source,
          note: payment.note,
          createdBy: payment.createdBy,
          createdAt: payment.createdAt,
        })),
      ),
    [sales],
  );
  const accountingRange = useMemo(
    () => ({
      from: activeRange.start || "0001-01-01",
      to: activeRange.end || "9999-12-31",
    }),
    [activeRange.end, activeRange.start],
  );
  const ledgerDimensionSales = useMemo(
    () =>
      filterSales(
        sales,
        {
          ...filters,
          period: "custom",
          startDate: "",
          endDate: "",
        },
        today,
      ),
    [filters, sales, today],
  );
  const allowedLedgerSaleIds = useMemo(
    () => new Set(ledgerDimensionSales.map((sale) => sale.id)),
    [ledgerDimensionSales],
  );
  const ledgerEvents = useMemo(
    () =>
      filterAccountingEvents(
        buildAccountingEvents(sales, paymentEntries, refundLedger),
        accountingRange,
        allowedLedgerSaleIds,
      ),
    [
      accountingRange,
      allowedLedgerSaleIds,
      paymentEntries,
      refundLedger,
      sales,
    ],
  );
  const accountingSummary = useMemo(() => {
    const salesAmount = calculateSalesAggregate(sales, accountingRange, unitId);
    const paidAmount = calculatePaymentAggregate(
      sales,
      paymentEntries,
      accountingRange,
      unitId,
    );
    const refundAmount = calculateRefundAggregate(
      sales,
      refundLedger,
      accountingRange,
      unitId,
    );
    return {
      salesAmount,
      paidAmount,
      refundAmount,
      netAmount: paidAmount - refundAmount,
      outstandingAmount: isFinanceAdmin
        ? calculateCurrentOutstanding(sales, unitId)
        : sales
            .filter(
              (sale) =>
                sale.status !== "cancelled" &&
                sale.saleDate === staffSelectedDate,
            )
            .reduce(
              (total, sale) => total + Math.max(0, sale.outstandingAmount),
              0,
            ),
    };
  }, [
    accountingRange,
    isFinanceAdmin,
    paymentEntries,
    refundLedger,
    sales,
    staffSelectedDate,
    unitId,
  ]);
  const resultCount = ledgerView ? ledgerEvents.length : filtered.length;
  const totalPages = Math.max(1, Math.ceil(resultCount / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const saleRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const ledgerRows = ledgerEvents.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  const salesById = useMemo(
    () => new Map(sales.map((sale) => [sale.id, sale])),
    [sales],
  );
  const todayActivity = useMemo(() => {
    const activity = calculateTodayActivity(sales, today);
    const payments = sales.flatMap((sale) =>
      sale.paymentLedger.map((payment) => ({
        id: payment.id,
        saleId: payment.saleId,
        paymentDate: payment.paymentDate,
        amount: payment.amount,
        voidedAt: payment.voidedAt,
        paymentMethod: payment.method,
        source: payment.source,
        createdBy: payment.createdBy,
        createdAt: payment.createdAt,
      })),
    );
    const paidAmount = calculatePaymentAggregate(
      sales,
      payments,
      { from: today, to: today },
    );
    const refundAmount = calculateRefundAggregate(
      sales,
      refundLedger,
      { from: today, to: today },
    );
    return {
      ...activity,
      netAmount: paidAmount,
      refundAmount,
      outstandingAmount: sales
        .filter((sale) => sale.status !== "cancelled")
        .reduce((total, sale) => total + sale.outstandingAmount, 0),
    };
  }, [refundLedger, sales, today]);
  const recentToday = useMemo(
    () => todayRegisteredSales(sales, today, profile?.id ?? null).slice(0, 5),
    [profile?.id, sales, today],
  );
  const duplicateWarnings = useMemo(
    () => findDuplicateWarnings(sales),
    [sales],
  );
  const staffOptions = useMemo(
    () => [
      ...new Map(
        sales
          .filter((sale) => sale.staffId)
          .map((sale) => [
            sale.staffId as string,
            sale.staffName ||
              profileNames[sale.staffId as string] ||
              "이름 미등록",
          ]),
      ).entries(),
    ],
    [profileNames, sales],
  );
  const registrarOptions = useMemo(
    () => [
      ...new Map(
        sales.map((sale) => [
          sale.createdBy,
          profileNames[sale.createdBy] || sale.registrarName || "이름 미등록",
        ]),
      ).entries(),
    ],
    [profileNames, sales],
  );
  const categoryOptions = useMemo(
    () => [
      ...new Map(
        sales
          .filter((sale) => sale.productCategoryId)
          .map((sale) => [sale.productCategoryId as string, sale.categoryName]),
      ).entries(),
    ],
    [sales],
  );
  const productOptions = useMemo(
    () => [
      ...new Map(
        sales.map((sale) => [sale.productId, sale.productName]),
      ).entries(),
    ],
    [sales],
  );

  const canEdit = (sale: SaleRow) =>
    (profile?.role === "admin" && sale.status !== "cancelled") ||
    (sale.createdBy === profile?.id && sale.status === "normal");
  const partyCustomerOptions = useMemo(() => {
    if (
      !editing?.customerId ||
      partyCustomers.some((customer) => customer.id === editing.customerId)
    )
      return partyCustomers;
    return [
      {
        id: editing.customerId,
        name: editing.customerName,
        phone: editing.customerPhone,
      },
      ...partyCustomers,
    ];
  }, [editing, partyCustomers]);
  const partyDogOptions = useMemo(() => {
    if (!editing?.dogId || partyDogs.some((dog) => dog.id === editing.dogId))
      return partyDogs;
    return [
      {
        id: editing.dogId,
        customerId: editing.customerId,
        name: editing.dogName,
        breed: null,
      },
      ...partyDogs,
    ];
  }, [editing, partyDogs]);
  const openEditSale = (sale: SaleRow) => {
    setActionError("");
    setPartyError("");
    setPartyModal(null);
    setDuplicatePartyDog(null);
    setAllowDuplicatePartyDog(false);
    setEditing({ ...sale });
  };
  const savePartyLink = async () => {
    if (!editing || partySaving) return;
    if (editing.status !== "normal") {
      setPartyError(
        "취소 또는 환불 처리된 매출의 고객 정보는 변경할 수 없습니다.",
      );
      return;
    }
    if (editing.dogId) {
      const dog = partyDogs.find((item) => item.id === editing.dogId);
      if (!dog || dog.customerId !== editing.customerId) {
        setPartyError("선택한 보호자와 반려견의 연결 정보를 확인해 주세요.");
        return;
      }
    }
    setPartySaving(true);
    setPartyError("");
    const result = await supabase
      .rpc(
        "link_sale_party",
        buildSalePartyRpcPayload(
          editing.id,
          editing.customerId ?? "",
          editing.dogId ?? "",
        ),
      )
      .single();
    setPartySaving(false);
    if (result.error) {
      logSupabaseError("매출 고객·반려견 연결", result.error, result.status);
      setPartyError(
        partyMutationError(
          result.error,
          "고객·반려견 연결 정보를 저장하지 못했습니다.",
        ),
      );
      return;
    }
    const linkedParty = result.data as LinkedSalePartyRow;
    setEditing((current) =>
      current
        ? {
            ...current,
            customerId: linkedParty.customer_id,
            dogId: linkedParty.dog_id,
            customerName: linkedParty.customer_name,
            customerPhone: linkedParty.customer_phone,
            dogName: linkedParty.dog_name || "(반려견 없음)",
          }
        : current,
    );
    setNotice("고객·반려견 연결 정보를 저장했습니다.");
    await loadSales();
  };
  const savePartyCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (partySaving || !editing) return;
    const name = newCustomer.name.trim();
    const phone = normalizeCustomerPhone(newCustomer.phone);
    if (!hasCustomerIdentity(name, phone)) {
      setPartyError("보호자명 또는 연락처 중 하나는 입력해 주세요.");
      return;
    }
    const duplicate = findCustomerPhoneDuplicate(partyCustomers, phone);
    if (duplicate) {
      setEditing({ ...editing, customerId: duplicate.id, dogId: null });
      setPartyModal(null);
      setNotice("동일 연락처의 기존 보호자를 선택했습니다.");
      return;
    }
    setPartySaving(true);
    setPartyError("");
    const result = await supabase
      .from("customers")
      .insert({ name: name || null, phone: phone || null, is_active: true })
      .select("id, name, phone")
      .single();
    setPartySaving(false);
    if (result.error) {
      logSupabaseError("매출 수정 중 보호자 등록", result.error, result.status);
      setPartyError(
        partyMutationError(
          result.error,
          "보호자를 등록하지 못했습니다. 입력 내용을 확인해 주세요.",
        ),
      );
      return;
    }
    setPartyCustomers((current) => [...current, result.data]);
    setEditing({ ...editing, customerId: result.data.id, dogId: null });
    setPartyModal(null);
    setNotice("새 보호자를 등록하고 선택했습니다.");
  };
  const savePartyDog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (partySaving || !editing?.customerId) return;
    const name = newDog.name.trim();
    if (!name) {
      setPartyError("반려견 이름을 입력해 주세요.");
      return;
    }
    const duplicate = findDogNameDuplicate(
      partyDogs,
      editing.customerId,
      name,
    );
    if (duplicate && !allowDuplicatePartyDog) {
      setDuplicatePartyDog(duplicate);
      setPartyError("같은 보호자에게 동일한 이름의 반려견이 있습니다.");
      return;
    }
    setPartySaving(true);
    setPartyError("");
    const result = await supabase
      .from("dogs")
      .insert({
        customer_id: editing.customerId,
        name,
        breed: newDog.breed.trim() || null,
        is_active: true,
      })
      .select("id, customer_id, name, breed")
      .single();
    setPartySaving(false);
    if (result.error) {
      logSupabaseError("매출 수정 중 반려견 등록", result.error, result.status);
      setPartyError(
        partyMutationError(
          result.error,
          "반려견을 등록하지 못했습니다. 입력 내용을 확인해 주세요.",
        ),
      );
      return;
    }
    const created = {
      id: result.data.id,
      customerId: result.data.customer_id,
      name: result.data.name,
      breed: result.data.breed,
    };
    setPartyDogs((current) => [...current, created]);
    setEditing({ ...editing, dogId: created.id });
    setPartyModal(null);
    setDuplicatePartyDog(null);
    setAllowDuplicatePartyDog(false);
    setNotice("새 반려견을 등록하고 선택했습니다.");
  };
  const startRefund = (sale: SaleRow) => {
    setActionError("");
    setRefundAmount(0);
    setRefundDate(today);
    setRefundReason("");
    setRefunding(sale);
  };
  const mapError = (message: string, code?: string) =>
    code === "42501"
      ? "권한이 없습니다."
      : message.includes("reclassify_sale_as_entry_error_after_refund")
        ? profile?.role === "admin"
          ? "환불 후 오등록 정정을 사용하려면 DB 업데이트가 필요합니다."
          : "현재 기능을 사용할 수 없습니다. 관리자에게 문의하세요."
      : code === "PGRST202" ||
          message.includes("cancel_sale_as_entry_error")
        ? profile?.role === "admin"
          ? "오등록 취소를 사용하려면 DB 업데이트가 필요합니다."
          : "현재 기능을 사용할 수 없습니다. 관리자에게 문의하세요."
      : message.includes("마감된 월")
        ? "마감된 월의 매출은 변경할 수 없습니다."
        : ["환불", "오등록", "취소", "결제", "입금", "요청 ID"].some(
              (keyword) => message.includes(keyword),
            )
          ? message
        : "매출 정보를 변경하지 못했습니다.";

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!editing) return;
    const finalSaleAmount = calculateFinalSaleAmount(
      editing.originalAmount,
      editing.additionalAmount,
      editing.discountAmount,
    );
    if (
      !Number.isInteger(editing.quantity) ||
      editing.quantity < 1 ||
      editing.unitPrice < 0 ||
      [
        editing.originalAmount,
        editing.additionalAmount,
        editing.discountAmount,
        editing.paidAmount,
        editing.outstandingAmount,
      ].some((value) => value < 0) ||
      editing.discountAmount >
        editing.originalAmount + editing.additionalAmount ||
      !isValidPaymentPlan(editing)
    ) {
      setActionError("수량, 단가와 금액 관계를 확인해 주세요.");
      return;
    }
    if (!editing.pricingStored && editing.quantity !== 1) {
      setActionError("수량 저장을 위한 DB 마이그레이션 적용이 필요합니다.");
      return;
    }
    if (
      editing.paymentRows.length > 1 &&
      (normalizePaymentRows(editing.paymentRows).length < 2 ||
        paymentRowsTotal(editing.paymentRows) !== editing.paidAmount)
    ) {
      setActionError("분할결제 수단별 금액과 총 결제금액을 확인해 주세요.");
      return;
    }
    setSaving(true);
    setActionError("");
    const originalAmount = Math.trunc(editing.unitPrice) * editing.quantity;
    const result = await supabase
      .from("sales")
      .update({
        sale_date: editing.saleDate,
        ...(editing.pricingStored
          ? {
              quantity: editing.quantity,
              unit_price: Math.trunc(editing.unitPrice),
            }
          : {}),
        original_amount: originalAmount,
        ...(editing.adjustmentsStored
          ? {
              additional_amount: Math.trunc(editing.additionalAmount),
              adjustment_note: editing.adjustmentNote?.trim() || null,
            }
          : {}),
        discount_amount: Math.trunc(editing.discountAmount),
        paid_amount: Math.trunc(editing.paidAmount),
        outstanding_amount: Math.trunc(
          calculateOutstandingAmount(finalSaleAmount, editing.paidAmount),
        ),
        payment_method: editing.paymentMethod,
        customer_type: editing.customerType,
        memo: editing.memo?.trim() || null,
      })
      .eq("id", editing.id)
      .select("id")
      .single();
    if (result.error) {
      setSaving(false);
      setActionError(mapError(result.error.message, result.error.code));
      return;
    }
    if (editing.paymentRows.length > 1) {
      const paymentResult = await supabase.rpc("replace_sale_payments", {
        p_sale_id: editing.id,
        p_payments: normalizePaymentRows(editing.paymentRows).map((row) => ({ payment_method: row.method, amount: row.amount })),
      });
      if (paymentResult.error) {
        setSaving(false);
        setActionError(`분할결제 상세를 저장하지 못했습니다: ${paymentResult.error.message}`);
        return;
      }
    }
    setSaving(false);
    setEditing(null);
    setNotice("매출 정보를 수정했습니다.");
    await loadSales();
  };

  const correctRefundedEntryError = async () => {
    if (!correctingRefundedEntryError || saving) return;
    const reason = correctionReason.trim();
    if (!reason) {
      setActionError("오등록 정정 사유를 입력해 주세요.");
      return;
    }
    if (!confirmedNoActualPayment) {
      setActionError("실제 입금이 없었다는 확인이 필요합니다.");
      return;
    }
    if (!confirmedNoActualRefund) {
      setActionError("실제 환불이 없었다는 확인이 필요합니다.");
      return;
    }

    setSaving(true);
    setActionError("");
    const result = await supabase.rpc(
      "reclassify_sale_as_entry_error_after_refund",
      {
        p_sale_id: correctingRefundedEntryError.id,
        p_reason: reason,
        p_confirm_no_actual_payment: true,
        p_confirm_no_actual_refund: true,
        p_expected_payment_amount: Math.trunc(
          correctingRefundedEntryError.paidAmount,
        ),
        p_expected_refund_amount: Math.trunc(
          correctingRefundedEntryError.refundAmount,
        ),
        p_request_id: correctionRequestId,
      },
    );
    setSaving(false);
    if (result.error) {
      setActionError(mapError(result.error.message, result.error.code));
      return;
    }

    setCorrectingRefundedEntryError(null);
    setCorrectionReason("");
    setConfirmedNoActualPayment(false);
    setConfirmedNoActualRefund(false);
    setCorrectionRequestId("");
    setNotice(
      "환불 후 오등록 정정을 완료했습니다. 결제와 환불 기록은 감사용으로 보존됩니다.",
    );
    await loadSales();
  };

  const applyRefund = async () => {
    if (!refunding) return;
    const remainingAmount = refundRemainingAmount(
      refunding.paidAmount,
      refunding.refundAmount,
    );
    if (refundAmount <= 0 || refundAmount > remainingAmount) {
      setActionError("환불 금액은 남은 환불 가능액 이하여야 합니다.");
      return;
    }
    if (!refundDate) {
      setActionError("환불 처리일을 입력해 주세요.");
      return;
    }
    if (!isRefundDateAllowed(refundDate, refunding.saleDate, today)) {
      setActionError("환불 처리일은 매출일 이후부터 오늘까지 선택할 수 있습니다.");
      return;
    }
    setSaving(true);
    setActionError("");
    const result = await supabase.rpc("record_sale_refund", {
      p_sale_id: refunding.id,
      p_refund_date: refundDate,
      p_amount: Math.trunc(refundAmount),
      p_reason: refundReason.trim() || null,
    });
    let usedLegacyFallback = false;
    if (result.error) {
      const missingRpc =
        result.error.code === "PGRST202" ||
        result.error.message.includes("record_sale_refund");
      if (!missingRpc) {
        setSaving(false);
        setActionError(mapError(result.error.message, result.error.code));
        return;
      }
      const legacyResult = await supabase
        .from("sales")
        .update({
          refund_amount: refunding.refundAmount + Math.trunc(refundAmount),
        })
        .eq("id", refunding.id)
        .select("id")
        .single();
      if (legacyResult.error) {
        setSaving(false);
        setActionError(
          mapError(legacyResult.error.message, legacyResult.error.code),
        );
        return;
      }
      usedLegacyFallback = true;
    }
    setSaving(false);
    setRefunding(null);
    setNotice(
      usedLegacyFallback
        ? "환불을 처리했습니다. 환불 처리일 기록은 관리자 DB 적용 후 제공됩니다."
        : refundAmount === remainingAmount
          ? "전액 환불을 처리했습니다."
          : "부분 환불을 처리했습니다.",
    );
    await loadSales();
  };

  const cancelSale = async () => {
    if (!cancelling || saving) return;
    if (!cancellationType) {
      setActionError("취소 유형을 선택해 주세요.");
      return;
    }
    if (!cancellationReason.trim()) {
      setActionError("취소 사유를 입력해 주세요.");
      return;
    }
    if (cancellationType === "entry_error" && !confirmedNoPayment) {
      setActionError("실제 입금이 없었다는 확인이 필요합니다.");
      return;
    }
    if (
      cancellationType === "general" &&
      (cancelling.paidAmount > 0 || cancelling.refundAmount > 0)
    ) {
      setActionError(
        "결제 이력이 있는 거래는 환불 또는 오등록 취소를 사용해 주세요.",
      );
      return;
    }

    setSaving(true);
    setActionError("");
    const result =
      cancellationType === "entry_error"
        ? await supabase.rpc("cancel_sale_as_entry_error", {
            p_sale_id: cancelling.id,
            p_reason: cancellationReason.trim(),
            p_confirm_no_payment: true,
            p_request_id: cancellationRequestId,
          })
        : await supabase
            .from("sales")
            .update({
              status: "cancelled",
              cancellation_type: "general",
              cancellation_reason: cancellationReason.trim(),
            })
            .eq("id", cancelling.id)
            .select("id")
            .single();
    setSaving(false);
    if (result.error) {
      setActionError(mapError(result.error.message, result.error.code));
      return;
    }
    setCancelling(null);
    setCancellationReason("");
    setCancellationType("");
    setConfirmedNoPayment(false);
    setCancellationRequestId("");
    setNotice(
      cancellationType === "entry_error"
        ? "오등록 거래와 연결된 결제 기록을 무효화했습니다."
        : "매출을 취소했습니다.",
    );
    await loadSales();
  };

  const openDetail = useCallback(async (sale: SaleRow) => {
    setSelected(sale);
    setHistory([]);
    setRefundHistory([]);
    setHistoryLoading(true);
    setRefundHistoryLoading(true);
    setHistoryError(false);
    setRefundHistoryError(false);
    const [result, refundResult] = await Promise.all([
      supabase
        .from("sale_history")
        .select(
          "id, action, previous_data, changed_data, changed_by, created_at",
        )
        .eq("sale_id", sale.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("sale_refunds")
        .select(
          "id, refund_date, amount, reason, created_by, created_at, is_legacy, voided_at",
        )
        .eq("sale_id", sale.id)
        .order("refund_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
    ]);
    if (result.error) setHistoryError(true);
    else
      setHistory(
        (result.data ?? []).map((row) => ({
          id: row.id,
          action: row.action,
          previousData: row.previous_data,
          changedData: row.changed_data,
          changedBy: row.changed_by,
          createdAt: row.created_at,
        })),
      );
    if (refundResult.error) setRefundHistoryError(true);
    else
      setRefundHistory(
        (refundResult.data ?? []).map((row) => ({
          id: row.id,
          refundDate: row.refund_date,
          amount: row.amount,
          reason: row.reason,
          createdBy: row.created_by,
          createdAt: row.created_at,
          isLegacy: row.is_legacy,
          voidedAt: row.voided_at,
        })),
      );
    setHistoryLoading(false);
    setRefundHistoryLoading(false);
  }, []);

  useEffect(() => {
    if (loading) return;
    const detailId = searchParams.get("detail");
    if (!detailId) {
      if (selected?.id) setSelected(null);
      return;
    }
    const sale = sales.find((item) => item.id === detailId);
    if (sale && selected?.id !== detailId) void openDetail(sale);
  }, [loading, openDetail, sales, searchParams, selected?.id]);

  const showDetail = (sale: SaleRow) => {
    updateParams({ detail: sale.id }, false);
    if (selected?.id !== sale.id) void openDetail(sale);
  };

  const closeDetail = () => {
    setSelected(null);
    updateParams({ detail: null }, false, true);
  };

  useEffect(() => {
    if (requestedPage <= totalPages) return;
    updateParams(
      { page: totalPages > 1 ? String(totalPages) : null },
      false,
      true,
    );
  }, [requestedPage, totalPages, updateParams]);

  const handleSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      updateParams({ q: null });
    }
    if (event.key === "Enter") event.preventDefault();
  };

  const reopenSale = async () => {
    if (!reopening) return;
    const wasEntryError = reopening.cancellationType === "entry_error";
    setSaving(true);
    setActionError("");
    const result = await supabase
      .from("sales")
      .update({
        status: "normal",
        cancellation_type: null,
      })
      .eq("id", reopening.id)
      .select("id")
      .single();
    setSaving(false);
    if (result.error) {
      setActionError(mapError(result.error.message, result.error.code));
      return;
    }
    setReopening(null);
    setNotice(
      wasEntryError
        ? "매출을 복구했습니다. 무효화된 결제는 복원되지 않으므로 결제 상태를 확인해 주세요."
        : "취소된 매출을 복구했습니다.",
    );
    await loadSales();
  };

  const voidPayment = async () => {
    if (!voidingPayment || !selected || saving) return;
    const reason = voidReason.trim();
    if (!reason) {
      setActionError("결제 무효화 사유를 입력해 주세요.");
      return;
    }
    setSaving(true);
    setActionError("");
    const result = await supabase.rpc("void_sale_payment", {
      p_payment_id: voidingPayment.id,
      p_reason: reason,
    });
    setSaving(false);
    if (result.error) {
      setActionError(`결제를 무효화하지 못했습니다: ${result.error.message}`);
      return;
    }
    const voidedAt = new Date().toISOString();
    setSelected((current) =>
      current ? (() => {
          const paymentLedger = current.paymentLedger.map((payment) =>
            payment.id === voidingPayment.id
              ? {
                  ...payment,
                  voidedAt,
                  voidedBy: profile?.id ?? null,
                  voidReason: reason,
                }
              : payment,
          );
          return {
            ...current,
            paidAmount: Math.max(0, current.paidAmount - voidingPayment.amount),
            outstandingAmount:
              current.outstandingAmount + voidingPayment.amount,
            netAmount: current.netAmount - voidingPayment.amount,
            paymentRows: normalizePaymentRows(
              paymentLedger
                .filter((payment) => payment.voidedAt === null)
                .map((payment) => ({
                  method: payment.method,
                  amount: payment.amount,
                })),
            ),
            paymentLedger,
          };
        })()
        : current,
    );
    setVoidingPayment(null);
    setVoidReason("");
    setNotice("결제 내역을 무효화했습니다.");
    await loadSales();
  };

  const resetFilters = () => {
    const next = new URLSearchParams();
    const detailId = searchParams.get("detail");
    if (detailId) next.set("detail", detailId);
    setSearchParams(next, { replace: true });
  };

  const moveSingleDay = (days: number) => {
    if (!singleDay) return;
    const nextDate = shiftDateKey(activeRange.start, days);
    updateParams({ period: "custom", start: nextDate, end: nextDate });
  };

  const filterChips: Array<{
    key: string;
    label: string;
    clear: Record<string, string | null>;
  }> = [];
  if (period !== "month")
    filterChips.push({
      key: "period",
      label: `기간: ${periodLabel[period]}`,
      clear: { period: null, start: null, end: null },
    });
  if (period === "custom" && startDate)
    filterChips.push({
      key: "start",
      label: `시작: ${startDate}`,
      clear: { start: null },
    });
  if (period === "custom" && endDate)
    filterChips.push({
      key: "end",
      label: `종료: ${endDate}`,
      clear: { end: null },
    });
  if (unitId)
    filterChips.push({
      key: "unit",
      label: `사업부: ${units.find(([id]) => id === unitId)?.[1] || "선택"}`,
      clear: { unit: null },
    });
  if (status)
    filterChips.push({
      key: "status",
      label: `상태: ${statusLabel[status]}`,
      clear: { status: null },
    });
  if (staffId)
    filterChips.push({
      key: "staff",
      label: `담당자: ${staffOptions.find(([id]) => id === staffId)?.[1] || "선택"}`,
      clear: { staff: null },
    });
  if (createdBy)
    filterChips.push({
      key: "createdBy",
      label: `등록자: ${registrarOptions.find(([id]) => id === createdBy)?.[1] || "선택"}`,
      clear: { createdBy: null },
    });
  if (paymentMethod)
    filterChips.push({
      key: "payment",
      label: `결제: ${paymentLabel[paymentMethod] || paymentMethod}`,
      clear: { payment: null },
    });
  if (categoryId)
    filterChips.push({
      key: "category",
      label: `분류: ${categoryOptions.find(([id]) => id === categoryId)?.[1] || "선택"}`,
      clear: { category: null },
    });
  if (productId)
    filterChips.push({
      key: "product",
      label: `상품: ${productOptions.find(([id]) => id === productId)?.[1] || "선택"}`,
      clear: { product: null },
    });
  if (minAmount !== null)
    filterChips.push({
      key: "min",
      label: `최소: ${won(minAmount)}`,
      clear: { min: null },
    });
  if (maxAmount !== null)
    filterChips.push({
      key: "max",
      label: `최대: ${won(maxAmount)}`,
      clear: { max: null },
    });
  if (query)
    filterChips.push({ key: "q", label: `검색: ${query}`, clear: { q: null } });

  const advancedFields = (
    <AdvancedFilterFields
      staffId={staffId}
      createdBy={createdBy}
      paymentMethod={paymentMethod}
      categoryId={categoryId}
      productId={productId}
      minAmount={searchParams.get("min") ?? ""}
      maxAmount={searchParams.get("max") ?? ""}
      staffOptions={staffOptions}
      registrarOptions={registrarOptions}
      categoryOptions={categoryOptions}
      productOptions={productOptions}
      onChange={(key, value) => updateParams({ [key]: value || null })}
    />
  );

  return (
    <>
      <PageHeader
        title={ledgerView ? "거래 원장" : "판매건별 보기"}
        description={
          ledgerView
            ? "판매·수납·환불·정정 이벤트를 실제 발생일 기준으로 확인합니다."
            : "판매 단위로 수정, 환불, 고객 연결과 현재 정산 상태를 관리합니다."
        }
        action={
          <Button onClick={() => navigate("/sales/new")}>
            <Plus size={17} />
            매출 등록
          </Button>
        }
      />
      <div className="mb-5 inline-flex rounded-xl border border-border bg-surface-secondary p-1">
        <button
          type="button"
          className={cn(
            "min-h-10 rounded-lg px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            ledgerView
              ? "bg-surface text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary",
          )}
          onClick={() => updateParams({ view: null, page: null })}
        >
          거래 원장
        </button>
        <button
          type="button"
          className={cn(
            "min-h-10 rounded-lg px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            !ledgerView
              ? "bg-surface text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary",
          )}
          onClick={() => updateParams({ view: "sales", page: null })}
        >
          판매건별 보기
        </button>
      </div>
      {ledgerView ? (
        <AccountingLedgerSummary
          range={activeRange}
          unitName={selectedUnitName}
          summary={accountingSummary}
          staffView={!isFinanceAdmin}
        />
      ) : (
        <SalesHistoryContext
          range={activeRange}
          unitName={selectedUnitName}
          summary={contextSummary}
          singleDay={singleDay}
          onMoveDay={moveSingleDay}
          onClearDate={() =>
            updateParams({ period: null, start: null, end: null })
          }
          onClearUnit={() => updateParams({ unit: null })}
        />
      )}
      {!ledgerView && period === "today" && (
        <>
          <TodayActivityCards activity={todayActivity} />
          <TodayRegistered
            rows={recentToday}
            profileId={profile?.id ?? null}
            onOpen={showDetail}
            onViewAll={() => updateParams({ period: "today" })}
          />
        </>
      )}
      <FilterToolbar className="gap-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              {ledgerView ? "회계 이벤트 찾기" : "판매건 찾기"}
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              {ledgerView
                ? "이벤트 발생일과 사업부를 먼저 선택하고 필요한 경우 검색하세요."
                : "매출일과 사업부를 먼저 선택하고 필요한 경우 검색하세요."}
            </p>
          </div>
          <span className="text-xs font-medium text-text-secondary tabular-nums">
            현재 결과 {resultCount.toLocaleString("ko-KR")}건
          </span>
        </div>
        <div className={cn("grid gap-3 md:grid-cols-2", isFinanceAdmin ? "xl:grid-cols-[150px_150px_150px_minmax(260px,1fr)_auto]" : "xl:grid-cols-[180px_150px_minmax(260px,1fr)]")}>
          {isFinanceAdmin ? <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-text-secondary">
              기간
            </span>
            <Select
              aria-label="조회 기간"
              value={period}
              onChange={(event) =>
                updateParams({
                  period:
                    event.target.value === "month" ? null : event.target.value,
                  start: null,
                  end: null,
                })
              }
            >
              {Object.entries(periodLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label> : <Field label="조회 날짜">
            <Input
              type="date"
              value={staffSelectedDate}
              onChange={(event) => {
                const date = event.target.value || today;
                updateParams({
                  period: "custom",
                  start: date,
                  end: date,
                  unit: null,
                });
              }}
            />
          </Field>}
          {isFinanceAdmin && <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-text-secondary">
              사업부
            </span>
            <Select
              aria-label="사업부 필터"
              value={unitId}
              onChange={(event) =>
                updateParams({ unit: event.target.value || null })
              }
            >
              <option value="">전체 사업부</option>
              {units.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </label>}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-text-secondary">
              상태
            </span>
            <Select
              aria-label="상태 필터"
              value={status}
              onChange={(event) =>
                updateParams({ status: event.target.value || null })
              }
            >
              {Object.entries(statusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-text-secondary">
              검색
            </span>
            <SearchBox
              aria-label="매출 내역 검색"
              placeholder="반려견, 보호자, 연락처, 상품 검색"
              value={query}
              onKeyDown={handleSearchKey}
              onClear={() => updateParams({ q: null })}
              onChange={(event) =>
                updateParams({ q: event.target.value || null }, true, true)
              }
            />
            {query !== debouncedQuery && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
                <LoaderCircle className="animate-spin" size={13} />
                검색 중
              </p>
            )}
          </label>
          {isFinanceAdmin && <Button
            type="button"
            variant="secondary"
            className="md:self-end"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(true)}
          >
            <SlidersHorizontal size={16} />
            고급 필터
          </Button>}
        </div>
        {isFinanceAdmin && period === "custom" && (
          <div className="grid gap-3 rounded-xl border border-border bg-surface-secondary p-3 sm:grid-cols-2">
            <Field label="시작일">
              <Input
                type="date"
                value={startDate}
                onChange={(event) =>
                  updateParams({ start: event.target.value || null })
                }
              />
            </Field>
            <Field label="종료일">
              <Input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) =>
                  updateParams({ end: event.target.value || null })
                }
              />
            </Field>
          </div>
        )}
      </FilterToolbar>
      {advancedOpen && !mobileLayout && (
        <Card className="mb-4 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-text-primary">고급 필터</h2>
              <p className="mt-1 text-xs text-text-muted">
                담당자, 상품과 결제 조건을 추가로 선택합니다.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAdvancedOpen(false)}
            >
              <X size={16} />
              접기
            </Button>
          </div>
          {advancedFields}
        </Card>
      )}
      <Modal
        open={advancedOpen && mobileLayout}
        onClose={() => setAdvancedOpen(false)}
        title="고급 필터"
      >
        <div>
          {advancedFields}
          <Button
            type="button"
            className="mt-5 w-full"
            onClick={() => setAdvancedOpen(false)}
          >
            필터 결과 보기
          </Button>
        </div>
      </Modal>
      {filterChips.length > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2"
          aria-label="적용된 필터"
        >
          <span className="text-xs font-semibold text-text-secondary">
            적용 필터
          </span>
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="inline-flex min-h-9 items-center gap-1 rounded-full bg-primary-soft px-3 text-xs font-semibold text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => updateParams(chip.clear)}
            >
              {chip.label}
              <X size={13} aria-hidden="true" />
            </button>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 px-3 py-1.5 text-xs"
            onClick={resetFilters}
          >
            <RotateCcw size={14} />
            전체 초기화
          </Button>
        </div>
      )}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          <strong className="tabular-nums text-text-primary">
            {resultCount}
          </strong>
          건의 {ledgerView ? "회계 이벤트" : "판매"}
        </p>
        {query !== debouncedQuery && (
          <span className="text-xs text-text-muted">검색 결과 갱신 중…</span>
        )}
      </div>
      <Card className="overflow-hidden shadow-none">
        {loading ? (
          <SalesHistoryLoadingState />
        ) : loadError ? (
          <ErrorState
            title="매출 내역을 불러오지 못했습니다."
            retry={() => void loadSales()}
          />
        ) : ledgerView && ledgerRows.length ? (
          <>
            <div className="hidden xl:block">
              <AccountingLedgerTable
                events={ledgerRows}
                salesById={salesById}
                onOpen={showDetail}
              />
            </div>
            <div className="grid gap-3 bg-surface-secondary/60 p-3 md:grid-cols-2 xl:hidden">
              {ledgerRows.map((event) => {
                const sale = salesById.get(event.saleId);
                return sale ? (
                  <AccountingLedgerCard
                    key={event.id}
                    event={event}
                    sale={sale}
                    onOpen={() => showDetail(sale)}
                  />
                ) : null;
              })}
            </div>
          </>
        ) : !ledgerView && saleRows.length ? (
          <>
            <div className="hidden xl:block">
              <SalesTable
                rows={saleRows}
                profileNames={profileNames}
                duplicateWarnings={duplicateWarnings}
                onOpen={showDetail}
              />
            </div>
            <div className="grid gap-3 bg-surface-secondary/60 p-3 md:grid-cols-2 xl:hidden">
              {saleRows.map((sale) => (
                <SaleMobileCard
                  key={sale.id}
                  sale={sale}
                  registrarName={
                    profileNames[sale.createdBy] || sale.registrarName || "-"
                  }
                  warning={duplicateWarnings.get(sale.id)}
                  onOpen={() => showDetail(sale)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="pb-8">
            <EmptyState
              title={
                sales.length === 0
                  ? "아직 등록된 매출이 없습니다"
                  : ledgerView
                    ? "현재 조건에 맞는 회계 이벤트가 없습니다"
                    : "현재 조건에 맞는 판매가 없습니다"
              }
              description={
                sales.length === 0
                  ? "첫 매출을 등록하면 날짜와 사업부 기준으로 내역을 확인할 수 있습니다."
                  : query
                  ? `“${query}” 검색어와 현재 필터 조건에 맞는 매출이 없습니다.`
                  : ledgerView
                    ? "이벤트 발생일·사업부 또는 적용된 필터를 조정해 주세요."
                    : "매출일·사업부 또는 적용된 필터를 조정해 주세요."
              }
            />
            <div className="-mt-5 flex flex-wrap justify-center gap-2">
              {sales.length > 0 && (
                <Button type="button" variant="secondary" onClick={resetFilters}>
                  검색 조건 초기화
                </Button>
              )}
              <Button type="button" onClick={() => navigate("/sales/new")}>
                <Plus size={16} />
                매출 등록
              </Button>
            </div>
          </div>
        )}
      </Card>
      {!loading && !loadError && resultCount > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalLabel={`총 ${resultCount}건`}
          onPageChange={(value) =>
            updateParams({ page: value > 1 ? String(value) : null }, false)
          }
        />
      )}
      <Modal open={Boolean(selected && !voidingPayment)} onClose={closeDetail} title="매출 상세" extraWide>
        {selected && (
          <SaleDetailContent
            sale={selected}
            profileNames={profileNames}
            history={history}
            historyLoading={historyLoading}
            historyError={historyError}
            refunds={refundHistory}
            refundsLoading={refundHistoryLoading}
            refundsError={refundHistoryError}
            admin={profile?.role === "admin"}
            editable={canEdit(selected)}
            onEdit={() => {
              closeDetail();
              openEditSale(selected);
            }}
            onRefund={() => {
              closeDetail();
              startRefund(selected);
            }}
            onCancel={() => {
              closeDetail();
              setActionError("");
              setCancellationReason("");
              setCancellationType("");
              setConfirmedNoPayment(false);
              setCancellationRequestId(crypto.randomUUID());
              setCancelling(selected);
            }}
            onCorrectRefundedEntryError={() => {
              closeDetail();
              setActionError("");
              setCorrectionReason("");
              setConfirmedNoActualPayment(false);
              setConfirmedNoActualRefund(false);
              setCorrectionRequestId(crypto.randomUUID());
              setCorrectingRefundedEntryError(selected);
            }}
            onReopen={() => {
              closeDetail();
              setActionError("");
              setReopening(selected);
            }}
            onVoidPayment={(payment) => {
              setActionError("");
              setVoidReason("");
              setVoidingPayment(payment);
            }}
          />
        )}
      </Modal>
      <Modal
        open={Boolean(voidingPayment)}
        title="결제 내역 무효화"
        onClose={() => !saving && setVoidingPayment(null)}
      >
        {voidingPayment && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void voidPayment();
            }}
          >
            <div className="rounded-2xl bg-error-soft p-4 text-sm leading-6 text-text-secondary">
              <strong className="block text-text-primary">
                {koDate(voidingPayment.paymentDate)} · {won(voidingPayment.amount)}
              </strong>
              결제 기록은 삭제하지 않고 무효화 이력으로 보존합니다.
            </div>
            <div className="mt-5">
              <Field label="무효화 사유" required>
                <Textarea
                  data-modal-initial
                  value={voidReason}
                  onChange={(event) => setVoidReason(event.target.value)}
                  placeholder="무효화 사유를 입력해 주세요."
                  aria-invalid={Boolean(actionError)}
                />
              </Field>
            </div>
            {actionError && <p role="alert" className="mt-4 rounded-xl bg-error-soft px-4 py-3 text-sm text-error">{actionError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setVoidingPayment(null)}>취소</Button>
              <Button type="submit" variant="danger" disabled={saving}>{saving ? "처리 중..." : "무효화"}</Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={!!editing && !partyModal}
        onClose={() => !saving && setEditing(null)}
        title="매출 수정"
        wide
      >
        {editing && (
          <form onSubmit={saveEdit} className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-2xl border border-border bg-surface-secondary p-4 sm:col-span-2" aria-labelledby="sale-party-editor-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id="sale-party-editor-title" className="text-sm font-semibold text-text-primary">고객·반려견 정보</h3>
                  <p className="mt-1 text-xs text-text-muted">
                    {editing.status === "normal"
                      ? "고객 연결만 별도로 저장되며 매출 금액과 결제 정보는 변경되지 않습니다."
                      : "취소 또는 환불 처리된 매출의 고객 정보는 변경할 수 없습니다."}
                  </p>
                </div>
                <Button type="button" variant="ghost" disabled={partySaving || editing.status !== "normal"} onClick={() => setEditing({ ...editing, customerId: null, dogId: null })}>연결 해제</Button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SearchSelect
                  key={`sale-customer-${editing.customerId ?? "none"}`}
                  label="보호자"
                  items={partyCustomerOptions}
                  selectedIds={editing.customerId ? [editing.customerId] : []}
                  multiple={false}
                  showAllOnEmpty
                  disabled={partySaving || editing.status !== "normal"}
                  placeholder="보호자명·연락처·반려견명 검색"
                  noResultsMessage="일치하는 보호자를 찾지 못했습니다."
                  recentStorageKey="pm-sales-edit-recent-customers"
                  getItemId={(customer) => customer.id}
                  getSearchText={(customer) => {
                    const dogNames = partyDogs
                      .filter((dog) => dog.customerId === customer.id)
                      .map((dog) => dog.name)
                      .join(" ");
                    return `${customer.name ?? ""} ${customer.phone ?? ""} ${dogNames}`;
                  }}
                  renderSelected={(customer) => (
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound size={14} aria-hidden="true" />
                      {customer.name || "이름 미등록"}
                    </span>
                  )}
                  renderOption={(customer) => {
                    const dogNames = partyDogs
                      .filter((dog) => dog.customerId === customer.id)
                      .map((dog) => dog.name);
                    return (
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-text-primary">
                          {customer.name || "이름 미등록"}
                        </strong>
                        <span className="mt-0.5 block truncate text-xs text-text-secondary">
                          {displayPhone(customer.phone)}
                          {dogNames.length ? ` · ${dogNames.join(", ")}` : ""}
                        </span>
                      </span>
                    );
                  }}
                  onChange={(selectedIds) => {
                    const customerId = selectedIds[0] ?? null;
                    const currentDog = partyDogs.find(
                      (dog) => dog.id === editing.dogId,
                    );
                    setEditing({
                      ...editing,
                      customerId,
                      dogId:
                        currentDog?.customerId === customerId
                          ? editing.dogId
                          : null,
                    });
                    setPartyError("");
                  }}
                />
                <SearchSelect
                  key={`sale-dog-${editing.dogId ?? "none"}`}
                  label="반려견"
                  items={partyDogOptions}
                  selectedIds={editing.dogId ? [editing.dogId] : []}
                  multiple={false}
                  showAllOnEmpty
                  disabled={partySaving || editing.status !== "normal"}
                  placeholder="반려견명·보호자명·연락처 검색"
                  noResultsMessage="일치하는 반려견을 찾지 못했습니다."
                  recentStorageKey="pm-sales-edit-recent-dogs"
                  getItemId={(dog) => dog.id}
                  getSearchText={(dog) => {
                    const customer = partyCustomers.find(
                      (item) => item.id === dog.customerId,
                    );
                    return `${dog.name} ${dog.breed ?? ""} ${customer?.name ?? ""} ${customer?.phone ?? ""}`;
                  }}
                  renderSelected={(dog) => (
                    <span className="inline-flex items-center gap-1.5">
                      <Dog size={14} aria-hidden="true" />
                      {dog.name}
                    </span>
                  )}
                  renderOption={(dog) => {
                    const customer = partyCustomers.find(
                      (item) => item.id === dog.customerId,
                    );
                    return (
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-text-primary">
                          {dog.name}
                        </strong>
                        <span className="mt-0.5 block truncate text-xs text-text-secondary">
                          {[dog.breed, customer?.name, displayPhone(customer?.phone ?? null)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    );
                  }}
                  onChange={(selectedIds) => {
                    const dog = partyDogs.find(
                      (item) => item.id === selectedIds[0],
                    );
                    setEditing({
                      ...editing,
                      dogId: dog?.id ?? null,
                      customerId: dog?.customerId ?? editing.customerId,
                    });
                    setPartyError("");
                  }}
                />
                <div className="flex items-end"><Button type="button" variant="secondary" className="w-full" disabled={partySaving || editing.status !== "normal"} onClick={() => { setNewCustomer({ name: "", phone: "" }); setPartyError(""); setPartyModal("customer"); }}><Plus size={16} />새 보호자 등록</Button></div>
                <div className="flex items-end"><Button type="button" variant="secondary" className="w-full" disabled={partySaving || editing.status !== "normal" || !editing.customerId} onClick={() => { setNewDog({ name: "", breed: "" }); setPartyError(""); setDuplicatePartyDog(null); setAllowDuplicatePartyDog(false); setPartyModal("dog"); }}><Plus size={16} />새 반려견 등록</Button></div>
              </div>
              {partyError && <p role="alert" className="mt-3 text-sm text-error">{partyError}</p>}
              <div className="mt-4 flex justify-end"><Button type="button" disabled={partySaving || editing.status !== "normal"} onClick={() => void savePartyLink()}>{partySaving ? "연결 저장 중..." : "연결 정보 저장"}</Button></div>
            </section>
            <Field label="매출 일자" required>
              <Input
                type="date"
                value={editing.saleDate}
                disabled={saving}
                onChange={(e) =>
                  setEditing({ ...editing, saleDate: e.target.value })
                }
              />
            </Field>
            <Field label="수량">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={editing.quantity}
                disabled={saving}
                onChange={(event) => {
                  const quantity = Math.max(
                    1,
                    Math.trunc(Number(event.target.value) || 1),
                  );
                  setEditing({
                    ...editing,
                    quantity,
                    originalAmount: editing.unitPrice * quantity,
                    outstandingAmount: calculateOutstandingAmount(
                      calculateFinalSaleAmount(
                        editing.unitPrice * quantity,
                        editing.additionalAmount,
                        editing.discountAmount,
                      ),
                      editing.paidAmount,
                    ),
                  });
                }}
              />
            </Field>
            <Field label="기준 단가">
              <MoneyInput
                value={editing.unitPrice}
                disabled={saving}
                onChange={(value) =>
                  setEditing({
                    ...editing,
                    unitPrice: value,
                    originalAmount: value * editing.quantity,
                    outstandingAmount: calculateOutstandingAmount(
                      calculateFinalSaleAmount(
                        value * editing.quantity,
                        editing.additionalAmount,
                        editing.discountAmount,
                      ),
                      editing.paidAmount,
                    ),
                  })
                }
              />
            </Field>
            <Field label="기준 계산금액">
              <Input value={won(editing.originalAmount)} disabled />
            </Field>
            {editing.adjustmentsStored && (
              <Field label="추가 금액">
                <MoneyInput
                  value={editing.additionalAmount}
                  disabled={saving}
                  onChange={(value) =>
                    setEditing({
                      ...editing,
                      additionalAmount: value,
                      outstandingAmount: calculateOutstandingAmount(
                        calculateFinalSaleAmount(
                          editing.originalAmount,
                          value,
                          editing.discountAmount,
                        ),
                        editing.paidAmount,
                      ),
                    })
                  }
                />
              </Field>
            )}
            <Field label="할인 금액">
              <MoneyInput
                value={editing.discountAmount}
                disabled={saving}
                onChange={(value) =>
                  setEditing({
                    ...editing,
                    discountAmount: value,
                    outstandingAmount: calculateOutstandingAmount(
                      calculateFinalSaleAmount(
                        editing.originalAmount,
                        editing.additionalAmount,
                        value,
                      ),
                      editing.paidAmount,
                    ),
                  })
                }
              />
            </Field>
            {editing.paymentRows.length > 1 ? (
              <div className="space-y-2 rounded-xl border border-border p-3 sm:col-span-2">
                <p className="text-sm font-semibold">분할결제 상세</p>
                {editing.paymentRows.map((row, index) => (
                  <div key={row.method} className="grid grid-cols-[1fr_1.4fr] gap-2">
                    <Select value={row.method} disabled={saving} onChange={(event) => {
                      const paymentRows = editing.paymentRows.map((item, rowIndex) => rowIndex === index ? { ...item, method: event.target.value as SalePaymentRow["method"] } : item);
                      const paidAmount = paymentRowsTotal(paymentRows);
                      setEditing({ ...editing, paymentRows, paymentMethod: paymentRows[0]?.method ?? editing.paymentMethod, paidAmount, outstandingAmount: calculateOutstandingAmount(calculateFinalSaleAmount(editing.originalAmount, editing.additionalAmount, editing.discountAmount), paidAmount) });
                    }}>{Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
                    <MoneyInput value={row.amount} disabled={saving} onChange={(amount) => {
                      const paymentRows = editing.paymentRows.map((item, rowIndex) => rowIndex === index ? { ...item, amount } : item);
                      const paidAmount = paymentRowsTotal(paymentRows);
                      setEditing({ ...editing, paymentRows, paidAmount, outstandingAmount: calculateOutstandingAmount(calculateFinalSaleAmount(editing.originalAmount, editing.additionalAmount, editing.discountAmount), paidAmount) });
                    }} />
                  </div>
                ))}
                <p className="text-right text-sm">총 결제 <strong className="tabular-nums">{won(editing.paidAmount)}</strong></p>
              </div>
            ) : <Field label="결제 금액">
              <MoneyInput
                value={editing.paidAmount}
                disabled={saving}
                onChange={(value) =>
                  setEditing({
                    ...editing,
                    paidAmount: value,
                    outstandingAmount: calculateOutstandingAmount(
                      calculateFinalSaleAmount(
                        editing.originalAmount,
                        editing.additionalAmount,
                        editing.discountAmount,
                      ),
                      value,
                    ),
                  })
                }
              />
            </Field>}
            <Field label="미수금">
              <Input value={won(editing.outstandingAmount)} disabled />
            </Field>
            {editing.paymentRows.length <= 1 && <Field label="결제 수단">
              <Select
                value={editing.paymentMethod}
                disabled={saving}
                onChange={(e) =>
                  setEditing({ ...editing, paymentMethod: e.target.value })
                }
              >
                {Object.entries(paymentLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>}
            <Field label="구분">
              <Select
                value={editing.customerType}
                disabled={saving}
                onChange={(e) =>
                  setEditing({ ...editing, customerType: e.target.value })
                }
              >
                <option value="new">신규</option>
                <option value="renewal">재등록</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              {editing.adjustmentsStored && (
                <Field label="금액 조정 메모">
                  <Textarea
                    value={editing.adjustmentNote || ""}
                    disabled={saving}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        adjustmentNote: e.target.value,
                      })
                    }
                  />
                </Field>
              )}
            </div>
            <div className="sm:col-span-2">
              <Field label="메모">
                <Textarea
                  value={editing.memo || ""}
                  disabled={saving}
                  onChange={(e) =>
                    setEditing({ ...editing, memo: e.target.value })
                  }
                />
              </Field>
            </div>
            {actionError && (
              <p className="text-sm text-red-600 sm:col-span-2">
                {actionError}
              </p>
            )}
            <Button className="sm:col-span-2" disabled={saving}>
              {saving ? "저장 중..." : "수정 저장"}
            </Button>
          </form>
        )}
      </Modal>
      <Modal open={partyModal === "customer"} onClose={() => !partySaving && setPartyModal(null)} title="새 보호자 등록">
        <form onSubmit={savePartyCustomer} className="space-y-4">
          <Field label="보호자명" help="이름 또는 연락처 중 하나는 필수입니다."><Input data-modal-initial value={newCustomer.name} disabled={partySaving} onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })} /></Field>
          <Field label="연락처"><Input inputMode="tel" value={newCustomer.phone} disabled={partySaving} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} /></Field>
          {partyError && <p role="alert" className="text-sm text-error">{partyError}</p>}
          <div className="grid grid-cols-2 gap-2"><Button type="button" variant="secondary" disabled={partySaving} onClick={() => setPartyModal(null)}>취소</Button><Button disabled={partySaving}>{partySaving ? "등록 중..." : "등록 후 선택"}</Button></div>
        </form>
      </Modal>
      <Modal open={partyModal === "dog"} onClose={() => !partySaving && setPartyModal(null)} title="새 반려견 등록">
        <form onSubmit={savePartyDog} className="space-y-4">
          <p className="text-sm text-text-secondary">선택한 보호자에게 새 반려견을 등록합니다.</p>
          <Field label="반려견명" required><Input data-modal-initial value={newDog.name} disabled={partySaving} onChange={(event) => { setNewDog({ ...newDog, name: event.target.value }); setDuplicatePartyDog(null); setAllowDuplicatePartyDog(false); }} /></Field>
          <Field label="견종"><Input value={newDog.breed} disabled={partySaving} onChange={(event) => setNewDog({ ...newDog, breed: event.target.value })} /></Field>
          {duplicatePartyDog && !allowDuplicatePartyDog && <div className="rounded-xl bg-warning-soft p-3 text-sm text-text-secondary"><p>같은 보호자에게 <strong className="text-text-primary">{duplicatePartyDog.name}</strong>이(가) 이미 있습니다.</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => { if (editing) setEditing({ ...editing, dogId: duplicatePartyDog.id }); setPartyModal(null); setDuplicatePartyDog(null); }}>기존 반려견 선택</Button><Button type="button" variant="ghost" onClick={() => { setAllowDuplicatePartyDog(true); setPartyError(""); }}>그래도 새로 등록</Button></div></div>}
          {partyError && <p role="alert" className="text-sm text-error">{partyError}</p>}
          <div className="grid grid-cols-2 gap-2"><Button type="button" variant="secondary" disabled={partySaving} onClick={() => setPartyModal(null)}>취소</Button><Button disabled={partySaving}>{partySaving ? "등록 중..." : "등록 후 선택"}</Button></div>
        </form>
      </Modal>
      <Modal
        open={!!refunding}
        onClose={() => !saving && setRefunding(null)}
        title="환불 처리"
      >
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!saving) void applyRefund();
        }}>
          {refunding && (
            <>
              <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-surface-secondary p-3">
                <RefundSummary
                  label="환불 누계"
                  value={won(refunding.refundAmount)}
                />
                <RefundSummary
                  label="환불 가능"
                  value={won(
                    refundRemainingAmount(
                      refunding.paidAmount,
                      refunding.refundAmount,
                    ),
                  )}
                />
                <RefundSummary
                  label="처리 후 잔액"
                  value={won(
                    Math.max(
                      0,
                      refundRemainingAmount(
                        refunding.paidAmount,
                        refunding.refundAmount,
                      ) - refundAmount,
                    ),
                  )}
                />
              </div>
              <Field label="이번 환불 금액" required>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <MoneyInput
                      value={refundAmount}
                      disabled={saving}
                      max={refundRemainingAmount(
                        refunding.paidAmount,
                        refunding.refundAmount,
                      )}
                      onChange={setRefundAmount}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0 px-3"
                    disabled={saving}
                    onClick={() =>
                      setRefundAmount(
                        refundRemainingAmount(
                          refunding.paidAmount,
                          refunding.refundAmount,
                        ),
                      )
                    }
                  >
                    전액 입력
                  </Button>
                </div>
              </Field>
              <div className="mt-4">
                <Field label="환불 처리일" required>
                  <Input
                    type="date"
                    value={refundDate}
                    min={refunding.saleDate}
                    max={today}
                    disabled={saving}
                    onChange={(event) => setRefundDate(event.target.value)}
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="환불 사유">
                  <Textarea
                    value={refundReason}
                    disabled={saving}
                    placeholder="선택 입력"
                    onChange={(event) => setRefundReason(event.target.value)}
                  />
                </Field>
              </div>
            </>
          )}
          {actionError && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {actionError}
            </p>
          )}
          <Button className="mt-4 w-full" disabled={saving}>
            {saving ? "처리 중..." : "환불 적용"}
          </Button>
        </form>
      </Modal>
      <Modal
        open={!!cancelling}
        onClose={() => {
          if (saving) return;
          setCancelling(null);
          setCancellationType("");
          setConfirmedNoPayment(false);
          setCancellationRequestId("");
        }}
        title="취소 처리"
      >
        <Field label="취소 유형" required>
          <Select
            value={cancellationType}
            disabled={saving}
            onChange={(event) => {
              setCancellationType(
                event.target.value as "" | "general" | "entry_error",
              );
              setConfirmedNoPayment(false);
              setActionError("");
            }}
          >
            <option value="">취소 유형 선택</option>
            <option value="general">일반 취소 · 결제 전 거래 취소</option>
            <option value="entry_error">오등록 취소 · 잘못 입력한 거래</option>
          </Select>
        </Field>
        {cancellationType === "entry_error" && (
          <div className="mt-4 rounded-xl border border-error/20 bg-error-soft p-4">
            <strong className="text-sm text-error">결제 기록도 함께 무효화됩니다.</strong>
            <p className="mt-1 text-sm leading-6 text-text-secondary">
              실제 입금이 있었다면 오등록 취소가 아니라 환불을 사용해야 합니다.
              미수 수납 또는 조정 이력이 있는 거래는 처리할 수 없습니다.
            </p>
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-text-primary">
              <input
                type="checkbox"
                checked={confirmedNoPayment}
                disabled={saving}
                className="h-4 w-4 rounded border-border-strong accent-error"
                onChange={(event) =>
                  setConfirmedNoPayment(event.target.checked)
                }
              />
              실제 입금이 없었음을 확인했습니다.
            </label>
          </div>
        )}
        {cancellationType === "general" && (
          <p className="mt-4 rounded-xl bg-surface-secondary px-4 py-3 text-sm leading-6 text-text-secondary">
            결제 이력이 없는 거래만 일반 취소할 수 있습니다. 실제 결제가 있었다면
            환불을 사용해 주세요.
          </p>
        )}
        <div className="mt-4">
          <Field label="취소 사유" required>
            <Textarea
              value={cancellationReason}
              disabled={saving}
              onChange={(e) => setCancellationReason(e.target.value)}
            />
          </Field>
        </div>
        {actionError && (
          <p className="mt-3 text-sm text-red-600">{actionError}</p>
        )}
        <Button
          className="mt-4 w-full"
          variant="danger"
          disabled={saving}
          onClick={() => void cancelSale()}
        >
          {saving
            ? "처리 중..."
            : cancellationType === "entry_error"
              ? "오등록 취소"
              : "매출 취소"}
        </Button>
      </Modal>
      <ConfirmModal
        open={!!reopening}
        onClose={() => setReopening(null)}
        onConfirm={() => void reopenSale()}
        title="취소 복구"
        confirmLabel="취소 복구"
        tone="primary"
        processing={saving}
        description={
          <>
            {reopening?.cancellationType === "entry_error" ? (
              <>
                오등록 취소를 복구해도 무효화된 결제 내역은 자동으로 복원되지
                않습니다. 복구 후 미수금과 결제 상태를 반드시 확인해 주세요.
              </>
            ) : (
              <>
                취소된 매출을 복구합니다. 환불 금액에 따라
                정상·부분환불·전체환불 상태가 다시 계산됩니다.
              </>
            )}
            {actionError && (
              <span role="alert" className="mt-3 block text-red-600">
                {actionError}
              </span>
            )}
          </>
        }
      />
      <Modal
        open={Boolean(correctingRefundedEntryError)}
        onClose={() => {
          if (saving) return;
          setCorrectingRefundedEntryError(null);
          setCorrectionReason("");
          setConfirmedNoActualPayment(false);
          setConfirmedNoActualRefund(false);
          setCorrectionRequestId("");
        }}
        title="환불 후 오등록 정정"
      >
        {correctingRefundedEntryError && (
          <>
            <div className="rounded-xl border border-error/20 bg-error-soft p-4">
              <strong className="text-sm text-error">
                결제와 환불 기록이 모두 무효화됩니다.
              </strong>
              <p className="mt-1 text-sm leading-6 text-text-secondary">
                실제 돈이 오가지 않았지만 결제와 환불까지 잘못 기록된 거래에만
                사용하세요. 원장은 삭제하지 않고 감사용으로 보존합니다.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-text-muted">확인할 결제금액</dt>
                  <dd className="mt-1 font-bold text-text-primary tabular-nums">
                    {won(correctingRefundedEntryError.paidAmount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">확인할 환불금액</dt>
                  <dd className="mt-1 font-bold text-text-primary tabular-nums">
                    {won(correctingRefundedEntryError.refundAmount)}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="mt-4 space-y-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={confirmedNoActualPayment}
                  disabled={saving}
                  className="h-4 w-4 rounded border-border-strong accent-error"
                  onChange={(event) =>
                    setConfirmedNoActualPayment(event.target.checked)
                  }
                />
                실제 입금이 없었음을 확인했습니다.
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={confirmedNoActualRefund}
                  disabled={saving}
                  className="h-4 w-4 rounded border-border-strong accent-error"
                  onChange={(event) =>
                    setConfirmedNoActualRefund(event.target.checked)
                  }
                />
                실제 환불이 없었음을 확인했습니다.
              </label>
            </div>
            <div className="mt-4">
              <Field label="정정 사유" required>
                <Textarea
                  value={correctionReason}
                  disabled={saving}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                />
              </Field>
            </div>
            {actionError && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {actionError}
              </p>
            )}
            <Button
              type="button"
              className="mt-4 w-full"
              variant="danger"
              disabled={saving}
              onClick={() => void correctRefundedEntryError()}
            >
              {saving ? "정정 중..." : "환불 후 오등록 정정"}
            </Button>
          </>
        )}
      </Modal>
      {notice && <Toast message={notice} onClose={() => setNotice("")} />}
    </>
  );
}

function SaleDetailContent({
  sale,
  profileNames,
  history,
  historyLoading,
  historyError,
  refunds,
  refundsLoading,
  refundsError,
  admin,
  editable,
  onEdit,
  onRefund,
  onCancel,
  onCorrectRefundedEntryError,
  onReopen,
  onVoidPayment,
}: {
  sale: SaleRow;
  profileNames: Record<string, string>;
  history: HistoryRow[];
  historyLoading: boolean;
  historyError: boolean;
  refunds: RefundRow[];
  refundsLoading: boolean;
  refundsError: boolean;
  admin: boolean;
  editable: boolean;
  onEdit: () => void;
  onRefund: () => void;
  onCancel: () => void;
  onCorrectRefundedEntryError: () => void;
  onReopen: () => void;
  onVoidPayment: (payment: PaymentLedgerRow) => void;
}) {
  const finalSaleAmount = calculateFinalSaleAmount(
    sale.originalAmount,
    sale.additionalAmount,
    sale.discountAmount,
  );
  const fallbackPayments = detailPaymentRows(
    sale.paymentRows,
    sale.paymentMethod,
    sale.paidAmount,
  );
  const activePayments = sale.paymentLedger.filter((payment) => payment.voidedAt === null);
  const paymentTotal = activePayments.length
    ? activePayments.reduce((total, row) => total + row.amount, 0)
    : fallbackPayments.reduce((total, row) => total + row.amount, 0);
  const refundKinds = refundDetailKinds(refunds, sale.status);
  const canRefund = admin && sale.status !== "cancelled" && sale.refundAmount < sale.paidAmount;
  const canCorrectRefundedEntryError =
    admin && canReclassifyRefundedSaleAsEntryError(sale);
  const hasActions = editable || admin;
  const cancelled = sale.status === "cancelled";
  const customerType = sale.customerType === "new" ? "신규" : sale.customerType === "renewal" ? "재등록" : sale.customerType || "미지정";
  const productDisplayName = detailProductName(
    sale.productName,
    sale.unitLabel,
  );
  const quantityDisplay = formatQuantityWithUnit(
    sale.quantity,
    sale.unitLabel,
  );

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-[22px] border border-slate-700/50 bg-[#172f4d] text-white" aria-labelledby="sale-summary-title">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
          <div className="min-w-0 p-5 sm:p-7 lg:p-8">
            <HeroStatusBadges sale={sale} />
            <h3 id="sale-summary-title" className="mt-5 break-words text-2xl font-bold tracking-[-0.035em] text-white sm:text-3xl">
              {sale.dogName || "(반려견 없음)"}
            </h3>
            <p className="mt-2 break-words text-sm leading-6 text-slate-300">
              {sale.customerName?.trim() || "보호자 이름 없음"}
              {sale.customerPhone?.trim() ? ` · ${displayPhone(sale.customerPhone)}` : ""}
            </p>
            <dl className="mt-7 grid gap-x-6 gap-y-4 border-t border-white/15 pt-5 text-sm sm:grid-cols-3">
              <DetailHeroText label="사업부" value={sale.businessUnitName} />
              <DetailHeroText label="담당자" value={sale.staffName || "미지정"} />
              <DetailHeroText label="매출일" value={koDate(sale.saleDate)} />
            </dl>
          </div>
          <div className="border-t border-white/15 bg-white/[0.045] p-5 sm:p-7 lg:border-l lg:border-t-0 lg:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-200">
              최종 판매금액
            </p>
            <strong className="mt-2 block break-keep text-right text-[clamp(2.35rem,6vw,4rem)] font-bold leading-none tracking-[-0.055em] text-white tabular-nums">
              {won(finalSaleAmount)}
            </strong>
            <div className="mt-7 grid grid-cols-3 overflow-hidden rounded-2xl border border-white/10 bg-black/10">
              <DetailHeroAmount label="결제 완료" value={sale.paidAmount} />
              {cancelled ? (
                <div className="min-w-0 border-r border-white/10 p-3.5 sm:p-4">
                  <dt className="text-xs font-medium text-slate-300">거래 상태</dt>
                  <dd className="mt-1 text-right text-sm font-bold text-rose-300 sm:text-base">
                    취소된 거래
                  </dd>
                </div>
              ) : (
                <DetailHeroAmount label="미수" value={sale.outstandingAmount} warning={sale.outstandingAmount > 0} />
              )}
              <DetailHeroAmount label="환불" value={sale.refundAmount} danger={sale.refundAmount > 0} />
            </div>
          </div>
        </div>
      </section>

      <SaleAccountingTimeline sale={sale} refunds={refunds} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface px-5 [&>section:first-child]:border-t-0 sm:px-7">
      <DetailSection title="판매 항목">
        <div className="grid gap-5 border-b border-border pb-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <span className="block text-xs font-semibold text-text-muted">상품</span>
            <strong className="mt-2 block break-words text-xl font-bold tracking-[-0.02em] text-text-primary">
              {productDisplayName}
            </strong>
            <p className="mt-2 break-words text-sm font-medium text-text-secondary tabular-nums">
              {quantityDisplay} × {won(sale.unitPrice)}
            </p>
            {sale.categoryName && (
              <Badge tone="gray">{sale.categoryName}</Badge>
            )}
          </div>
          <div className="text-right">
            <span className="block text-xs font-medium text-text-muted">기준금액</span>
            <strong className="mt-1 block whitespace-nowrap text-2xl font-bold tracking-[-0.03em] text-text-primary tabular-nums">
              {won(sale.originalAmount)}
            </strong>
          </div>
        </div>
        <dl className="mt-5 space-y-3">
          {sale.additionalAmount > 0 && <DetailAmountRow label="추가금액" value={sale.additionalAmount} />}
          {sale.discountAmount > 0 && <DetailAmountRow label="할인금액" value={-sale.discountAmount} />}
          {sale.additionalAmount === 0 && sale.discountAmount === 0 && (
            <p className="text-xs text-text-muted">추가금액과 할인금액 없음</p>
          )}
          <DetailAmountRow label="최종 판매금액" value={finalSaleAmount} emphasized prominent />
        </dl>
        {sale.adjustmentNote && (
          <p className="mt-3 rounded-xl bg-surface-secondary px-3 py-2.5 text-sm leading-6 text-text-secondary">
            <span className="font-semibold text-text-primary">조정 메모</span> · {sale.adjustmentNote}
          </p>
        )}
      </DetailSection>

      <DetailSection title="결제 내역" description={activePayments.length > 1 ? "분할·추가 수납 원장" : "결제 원장"}>
        {sale.paymentLedger.length > 0 ? (
          <div className="space-y-3">
            {sale.paymentLedger.map((payment) => (
              <article
                key={payment.id}
                className={cn(
                  "rounded-xl border border-border bg-surface-secondary p-4",
                  Boolean(payment.voidedAt) && "opacity-65",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-text-primary">{paymentMethodLabels[payment.method]}</strong>
                      <Badge tone={payment.source === "outstanding_collection" ? "blue" : payment.source === "adjustment" ? "amber" : "gray"}>
                        {{ initial: "최초 결제", outstanding_collection: "미수 수납", adjustment: "조정" }[payment.source]}
                      </Badge>
                      {isEstimatedInitialPaymentDate(
                        payment.source,
                        sale.initialOutstandingEstimated,
                      ) && (
                        <Badge tone="amber">
                          결제일 추정값
                        </Badge>
                      )}
                      {payment.voidedAt && <Badge tone="red">무효화</Badge>}
                    </div>
                    <p className="mt-2 text-xs text-text-muted">
                      결제일 {koDate(payment.paymentDate)} · 처리자 {profileNames[payment.createdBy] || "이름 미등록"}
                    </p>
                    {isEstimatedInitialPaymentDate(
                      payment.source,
                      sale.initialOutstandingEstimated,
                    ) && (
                      <p className="mt-1 text-xs leading-5 text-amber-700">
                        기존 데이터 보정값 · 실제 결제일 기록이 없어 매출일을 표시합니다.
                      </p>
                    )}
                  </div>
                  <strong className={cn("text-base text-text-primary tabular-nums", Boolean(payment.voidedAt) && "line-through")}>
                    {won(payment.amount)}
                  </strong>
                </div>
                {payment.note && <p className="mt-3 break-words text-sm text-text-secondary">{payment.note}</p>}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="text-xs text-text-muted">
                    처리 {new Date(payment.createdAt).toLocaleString("ko-KR")}
                    {payment.voidedAt && ` · 무효화 ${new Date(payment.voidedAt).toLocaleString("ko-KR")}`}
                  </span>
                  {admin && !payment.voidedAt && (
                    <Button type="button" variant="ghost" className="min-h-9 px-3 py-1.5 text-error hover:bg-error-soft hover:text-error" onClick={() => onVoidPayment(payment)}>
                      무효화
                    </Button>
                  )}
                </div>
                {payment.voidReason && <p className="mt-2 text-xs text-error">사유: {payment.voidReason}</p>}
              </article>
            ))}
            <DetailAmountRow label="유효 결제 합계" value={paymentTotal} emphasized className="pt-3" />
          </div>
        ) : fallbackPayments.length > 0 ? (
          <dl className="divide-y divide-border">
            {fallbackPayments.map((payment, index) => (
              <DetailAmountRow key={`${payment.method}-${index}`} label={paymentMethodLabels[payment.method]} value={payment.amount} className="py-3 first:pt-0" />
            ))}
            <DetailAmountRow label="결제 합계" value={paymentTotal} emphasized className="pt-3" />
          </dl>
        ) : (
          <p className="text-sm text-text-muted">기록된 결제 내역이 없습니다.</p>
        )}
      </DetailSection>

      <DetailSection title="환불 내역" tone={sale.refundAmount > 0 ? "warning" : "default"}>
        {refundsLoading ? (
          <LoadingState />
        ) : refundsError ? (
          <p role="alert" className="text-sm text-error">환불 처리 내역을 불러오지 못했습니다.</p>
        ) : refunds.length ? (
          <ol className="space-y-3">
            {refunds.map((refund) => {
              const kind = refundKinds.get(refund.id) ?? "partial";
              return (
                <li key={refund.id} className={cn("rounded-xl border border-border bg-surface-secondary p-4", kind === "voided" && "opacity-60")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm text-text-primary tabular-nums">
                          {refund.refundDate ? koDate(refund.refundDate) : "처리일 미확인"}
                        </strong>
                        <Badge tone={kind === "full" ? "red" : kind === "partial" ? "amber" : "gray"}>
                          {kind === "full" ? "전체환불" : kind === "partial" ? "부분환불" : "취소된 환불"}
                        </Badge>
                        {refund.isLegacy && <Badge>기존 기록</Badge>}
                      </div>
                      <p className="mt-2 break-words text-sm text-text-secondary">{refund.reason || "환불 사유 미입력"}</p>
                    </div>
                    <strong className={cn("shrink-0 text-base text-error tabular-nums", kind === "voided" && "line-through")}>
                      -{won(refund.amount)}
                    </strong>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-text-muted">
                    처리자 {refund.createdBy ? profileNames[refund.createdBy] || "이름 미등록" : "확인 불가"} · 기록 {new Date(refund.createdAt).toLocaleString("ko-KR")}
                  </p>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-text-muted">환불 내역 없음</p>
        )}
      </DetailSection>

      <DetailSection title="최종 정산">
        <dl className="space-y-2">
          <DetailAmountRow label="최종 판매금액" value={finalSaleAmount} />
          <DetailAmountRow label="실제 결제금액" value={sale.paidAmount} />
          <DetailAmountRow label="환불 누계" value={sale.refundAmount} />
          {cancelled ? (
            <>
              <DetailAmountRow
                label="감사용 잔액 Snapshot"
                value={sale.outstandingAmount}
              />
              <p className="rounded-xl bg-surface-secondary px-3 py-2.5 text-xs leading-5 text-text-muted">
                취소된 거래의 정합성 유지용 금액입니다. 실제 미수금이나 수납
                대상으로 사용하지 않습니다.
              </p>
            </>
          ) : (
            <DetailAmountRow label="미수금" value={sale.outstandingAmount} warning={sale.outstandingAmount > 0} />
          )}
          <DetailAmountRow label="최종 실매출" value={sale.netAmount} emphasized />
        </dl>
      </DetailSection>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-surface px-5 [&>section:first-child]:border-t-0 sm:px-6">
      <DetailSection title="고객·반려견 정보">
        <dl>
          <div className="border-b border-border pb-5">
            <dt className="text-xs font-semibold text-text-muted">반려견</dt>
            <dd className="mt-2 break-words text-2xl font-bold tracking-[-0.025em] text-text-primary">
              {sale.dogName || "(반려견 없음)"}
            </dd>
          </div>
          <div className="grid gap-x-6 gap-y-5 pt-5 sm:grid-cols-2">
            <DetailText label="보호자" value={sale.customerName?.trim() || "보호자 이름 없음"} important />
            <DetailText label="연락처" value={displayPhone(sale.customerPhone) || "연락처 없음"} />
            <DetailText label="사업부" value={sale.businessUnitName} />
            <DetailText label="담당자" value={sale.staffName || "담당자 미지정"} />
            <DetailText label="고객 구분" value={customerType} />
          </div>
        </dl>
      </DetailSection>

      <DetailSection title="등록 정보와 메모">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <DetailText label="담당자" value={sale.staffName || "담당자 미지정"} />
          <DetailText label="등록자" value={profileNames[sale.createdBy] || sale.registrarName || "이름 미등록"} />
          <DetailText label="등록 시각" value={new Date(sale.createdAt).toLocaleString("ko-KR")} />
          <DetailText label="수정 시각" value={new Date(sale.updatedAt).toLocaleString("ko-KR")} />
          {sale.status === "cancelled" && (
            <>
              <DetailText
                label="취소 구분"
                value={
                  sale.cancellationType === "entry_error"
                    ? "잘못 등록된 거래"
                    : sale.cancellationType === "general"
                      ? "일반 취소"
                      : "기존 취소"
                }
              />
              <DetailText label="취소 시각" value={sale.cancelledAt ? new Date(sale.cancelledAt).toLocaleString("ko-KR") : "확인 불가"} />
              <DetailText label="취소 사유" value={sale.cancellationReason || "사유 미입력"} />
            </>
          )}
        </dl>
        {(sale.memo || sale.adjustmentNote) ? (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            {sale.memo && <DetailMemo label="일반 메모" value={sale.memo} />}
            {sale.adjustmentNote && <DetailMemo label="금액 조정 메모" value={sale.adjustmentNote} />}
          </div>
        ) : (
          <p className="mt-4 border-t border-border pt-4 text-sm text-text-muted">등록된 메모가 없습니다.</p>
        )}
      </DetailSection>

      <DetailSection title="변경 이력" compact>
        {historyLoading ? (
          <LoadingState />
        ) : historyError ? (
          <p role="alert" className="text-sm text-error">매출 변경 이력을 불러오지 못했습니다.</p>
        ) : history.length ? (
          <details className="group rounded-xl border border-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              전체 변경 이력 {history.length}건
              <span className="text-xs font-medium text-text-muted group-open:hidden">펼치기</span>
              <span className="hidden text-xs font-medium text-text-muted group-open:inline">접기</span>
            </summary>
            <div className="space-y-3 border-t border-border p-3 sm:p-4">
              {history.map((item) => (
                <div key={item.id} className="rounded-xl bg-surface-secondary p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge>{item.action}</Badge>
                    <span className="text-xs text-text-muted">
                      {profileNames[item.changedBy] || item.changedBy} · {new Date(item.createdAt).toLocaleString("ko-KR")}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <JsonData label="previous_data" value={item.previousData} />
                    <JsonData label="changed_data" value={item.changedData} />
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : (
          <p className="text-sm text-text-muted">기록된 변경 이력이 없습니다.</p>
        )}
      </DetailSection>
        </div>
      </div>

      {hasActions && (
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5 lg:flex lg:items-center lg:justify-between lg:gap-6" aria-labelledby="sale-actions-title">
          <div>
            <h3 id="sale-actions-title" className="text-sm font-semibold text-text-primary">거래 관리</h3>
            <p className="mt-1 text-xs leading-5 text-text-muted">권한과 거래 상태에 따라 가능한 작업만 표시합니다.</p>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:mt-0 lg:justify-end">
            {editable && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={onEdit}><Pencil size={15} />수정</Button>
                <Button type="button" variant="ghost" onClick={onEdit}>결제 수정</Button>
                <Button type="button" variant="ghost" onClick={onEdit}>고객 연결</Button>
              </div>
            )}
            {(canRefund ||
              canCorrectRefundedEntryError ||
              (admin && sale.status === "normal")) && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
                {canRefund && <Button type="button" className="border-warning/30 bg-warning-soft text-warning hover:border-warning/50 hover:bg-warning-soft" variant="secondary" onClick={onRefund}>환불</Button>}
                {admin && sale.status === "normal" && <Button type="button" variant="danger" onClick={onCancel}><Undo2 size={15} />취소 처리</Button>}
                {canCorrectRefundedEntryError && <Button type="button" variant="danger" onClick={onCorrectRefundedEntryError}>환불 후 오등록 정정</Button>}
              </div>
            )}
            {admin && sale.status === "cancelled" && <Button type="button" variant="secondary" onClick={onReopen}><RotateCcw size={15} />취소 복구</Button>}
          </div>
        </section>
      )}
    </div>
  );
}

function SaleAccountingTimeline({
  sale,
  refunds,
}: {
  sale: SaleRow;
  refunds: RefundRow[];
}) {
  const finalAmount = calculateFinalSaleAmount(
    sale.originalAmount,
    sale.additionalAmount,
    sale.discountAmount,
  );
  const saleVoided = sale.status === "cancelled";
  const events = [
    {
      id: `sale:${sale.id}`,
      date: sale.saleDate,
      label: "판매",
      detail: sale.productName,
      amount: finalAmount,
      direction: "sale" as const,
      voided: saleVoided,
    },
    ...sale.paymentLedger.map((payment) => ({
      id: `payment:${payment.id}`,
      date: payment.paymentDate,
      label: accountingEventLabel(
        payment.source === "outstanding_collection"
          ? "outstanding_collection"
          : payment.source === "adjustment"
            ? "adjustment"
            : "initial_payment",
      ),
      detail: paymentMethodLabels[payment.method],
      amount: payment.amount,
      direction: "paid" as const,
      voided: Boolean(payment.voidedAt),
    })),
    ...refunds.map((refund) => ({
      id: `refund:${refund.id}`,
      date: refund.refundDate || sale.saleDate,
      label: "환불",
      detail: refund.reason || "환불 사유 미입력",
      amount: refund.amount,
      direction: "refund" as const,
      voided: Boolean(refund.voidedAt),
    })),
    ...(sale.status === "cancelled"
      ? [
          {
            id: `cancel:${sale.id}`,
            date: sale.cancelledAt || sale.saleDate,
            label:
              sale.cancellationType === "entry_error"
                ? "오등록 정정"
                : "취소",
            detail: sale.cancellationReason || "취소 사유 미입력",
            amount: 0,
            direction: "audit" as const,
            voided: false,
          },
        ]
      : []),
  ].sort(
    (left, right) =>
      left.date.localeCompare(right.date) || left.id.localeCompare(right.id),
  );

  return (
    <section
      className="rounded-2xl border border-border bg-surface p-5 sm:p-6"
      aria-labelledby="sale-accounting-timeline-title"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3
            id="sale-accounting-timeline-title"
            className="font-bold text-text-primary"
          >
            거래 이벤트 타임라인
          </h3>
          <p className="mt-1 text-xs text-text-muted">
            같은 거래의 판매·수납·환불·정정 기록
          </p>
        </div>
        <Badge tone="gray">{events.length}건</Badge>
      </div>
      <ol className="mt-5 grid gap-3 lg:grid-cols-2">
        {events.map((event) => (
          <li
            key={event.id}
            className={cn(
              "rounded-xl border border-border bg-surface-secondary px-4 py-3",
              event.voided && "opacity-60",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      event.direction === "refund"
                        ? "red"
                        : event.direction === "audit"
                          ? "gray"
                          : event.direction === "paid"
                            ? "blue"
                            : "green"
                    }
                  >
                    {event.label}
                  </Badge>
                  {event.voided && <Badge tone="gray">집계 제외</Badge>}
                </div>
                <p className="mt-2 truncate text-xs text-text-muted">
                  {koDate(event.date.slice(0, 10))} · {event.detail}
                </p>
              </div>
              {event.amount > 0 && (
                <strong
                  className={cn(
                    "shrink-0 text-sm tabular-nums",
                    event.direction === "refund"
                      ? "text-error"
                      : "text-text-primary",
                    event.voided && "line-through",
                  )}
                >
                  {event.direction === "refund" ? "-" : ""}
                  {won(event.amount)}
                </strong>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DetailHeroText({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</dt>
      <dd className="mt-1 truncate font-semibold text-white">{value}</dd>
    </div>
  );
}

function HeroStatusBadges({ sale }: { sale: SaleRow }) {
  const label = {
    normal: "정상",
    partial_refund: "부분환불",
    full_refund: "환불완료",
    cancelled: "취소",
  }[sale.status];
  const tone = {
    normal: "green",
    partial_refund: "amber",
    full_refund: "red",
    cancelled: "red",
  }[sale.status] as "green" | "amber" | "red";

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="거래 상태">
      <Badge tone={tone}>{label}</Badge>
      {sale.cancellationType === "entry_error" && (
        <Badge tone="red">잘못 등록된 거래</Badge>
      )}
      {hasOutstanding(sale) && sale.status !== "cancelled" && (
        <Badge tone="amber">미수</Badge>
      )}
    </div>
  );
}

function DetailHeroAmount({
  label,
  value,
  warning = false,
  danger = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0 border-r border-white/10 p-3.5 last:border-r-0 sm:p-4">
      <dt className="text-xs font-medium text-slate-300">{label}</dt>
      <dd
        className={cn(
          "mt-1 whitespace-nowrap text-right text-base font-bold tabular-nums tracking-[-0.025em] text-slate-100 sm:text-lg",
          warning && "text-amber-300",
          danger && "text-rose-300",
        )}
      >
        {won(value)}
      </dd>
    </div>
  );
}

function DetailSection({
  title,
  description,
  compact = false,
  tone = "default",
  children,
}: {
  title: string;
  description?: string;
  compact?: boolean;
  tone?: "default" | "warning";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "border-t border-border",
        compact ? "py-5" : "py-7",
        tone === "warning" &&
          "-mx-3 my-3 rounded-xl border border-warning/15 bg-warning-soft/50 px-3",
      )}
    >
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {description && <span className="text-xs font-medium text-text-muted">{description}</span>}
      </div>
      {children}
    </section>
  );
}

function DetailAmountRow({
  label,
  value,
  emphasized = false,
  prominent = false,
  warning = false,
  className,
}: {
  label: string;
  value: number;
  emphasized?: boolean;
  prominent?: boolean;
  warning?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", emphasized && "border-t border-border pt-4", className)}>
      <dt className={cn("text-sm text-text-secondary", emphasized && "font-semibold text-text-primary")}>{label}</dt>
      <dd className={cn("shrink-0 text-right text-sm font-semibold text-text-primary tabular-nums", emphasized && "text-lg text-primary", prominent && "text-xl font-bold", warning && "text-warning")}>{won(value)}</dd>
    </div>
  );
}

function DetailText({
  label,
  value,
  important = false,
}: {
  label: string;
  value: string;
  important?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className={cn("mt-1 break-words text-sm font-medium text-text-primary", important && "text-base font-semibold")}>{value}</dd>
    </div>
  );
}

function DetailMemo({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-semibold text-text-muted">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary">{value}</p></div>;
}

function AccountingLedgerSummary({
  range,
  unitName,
  summary,
  staffView = false,
}: {
  range: { start: string; end: string };
  unitName: string;
  summary: {
    salesAmount: number;
    paidAmount: number;
    refundAmount: number;
    netAmount: number;
    outstandingAmount: number;
  };
  staffView?: boolean;
}) {
  const rangeLabel =
    range.start && range.end
      ? range.start === range.end
        ? koDate(range.start)
        : `${koDate(range.start)} ~ ${koDate(range.end)}`
      : "전체 기간";
  const staffMetricPrefix =
    range.start === koreanDate(new Date()) ? "오늘" : "선택일";
  const metrics = [
    [staffView ? `${staffMetricPrefix} 판매` : "판매금액", summary.salesAmount, "매출일 기준"],
    [staffView ? `${staffMetricPrefix} 수납` : "실수납액", summary.paidAmount, "결제일 기준"],
    [staffView ? `${staffMetricPrefix} 환불` : "환불액", summary.refundAmount, "환불일 기준"],
    [staffView ? `${staffMetricPrefix} 순수납` : "순수납액", summary.netAmount, "실수납 - 환불"],
  ] as const;

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-primary/15 bg-surface">
      <div className="flex flex-col gap-2 border-b border-border bg-primary-subtle px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <div>
          <p className="text-xs font-semibold text-text-secondary">
            {staffView ? "선택한 날짜 기준" : "Dashboard와 동일한 회계 기준"}
          </p>
          <h2 className="mt-1 text-lg font-bold text-text-primary tabular-nums">
            {rangeLabel}
          </h2>
        </div>
        <Badge tone="blue">
          {staffView ? `${rangeLabel} 기준` : unitName}
        </Badge>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(([label, value, description]) => (
          <div
            key={label}
            className="border-b border-border px-4 py-4 sm:px-5 xl:border-b-0 xl:border-r"
          >
            <span className="text-[11px] font-semibold text-text-muted">
              {label}
            </span>
            <strong className="mt-1 block text-xl font-bold text-text-primary tabular-nums">
              {won(value)}
            </strong>
            <span className="mt-1 block text-xs text-text-muted">
              {description}
            </span>
          </div>
        ))}
        <div className="bg-warning-soft/45 px-4 py-4 sm:px-5">
          <span className="text-[11px] font-semibold text-warning">
            {staffView ? `${staffMetricPrefix} 미수 발생` : "현재 전체 미수금"}
          </span>
          <strong className="mt-1 block text-xl font-bold text-text-primary tabular-nums">
            {won(summary.outstandingAmount)}
          </strong>
          <span className="mt-1 block text-xs leading-5 text-text-muted">
            {staffView
              ? "선택한 날짜의 판매에서 발생한 미수"
              : "기간 합계가 아닌 현재 잔액 Snapshot"}
          </span>
        </div>
      </div>
    </section>
  );
}

const eventBadgeTone = (event: AccountingEvent) => {
  if (event.kind === "refund") return "red" as const;
  if (event.kind === "outstanding_collection") return "blue" as const;
  if (event.kind === "cancellation" || event.kind === "entry_error")
    return "gray" as const;
  if (event.kind === "adjustment") return "amber" as const;
  return "green" as const;
};

function EventAmount({
  value,
  tone = "default",
}: {
  value: number;
  tone?: "default" | "danger";
}) {
  if (!value) return <span className="text-text-muted">-</span>;
  return (
    <strong
      className={cn(
        "font-semibold tabular-nums",
        tone === "danger" ? "text-error" : "text-text-primary",
      )}
    >
      {tone === "danger" ? "-" : ""}
      {won(value)}
    </strong>
  );
}

function AccountingLedgerTable({
  events,
  salesById,
  onOpen,
}: {
  events: AccountingEvent[];
  salesById: Map<string, SaleRow>;
  onOpen: (sale: SaleRow) => void;
}) {
  return (
    <Table className="min-w-[1080px]">
      <thead className="sticky top-0 z-10 bg-surface">
        <tr>
          <th>발생일</th>
          <th>이벤트</th>
          <th>반려견 / 보호자</th>
          <th>사업부 / 상품</th>
          <th className="text-right">판매</th>
          <th className="text-right">실수납</th>
          <th className="text-right">환불</th>
          <th>담당자</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => {
          const sale = salesById.get(event.saleId);
          if (!sale) return null;
          return (
            <tr
              key={event.id}
              tabIndex={0}
              role="link"
              className="cursor-pointer hover:bg-primary-subtle/60 focus:bg-primary-subtle focus:outline-none"
              onClick={() => onOpen(sale)}
              onKeyDown={(keyboardEvent) => {
                if (
                  keyboardEvent.key === "Enter" ||
                  keyboardEvent.key === " "
                ) {
                  keyboardEvent.preventDefault();
                  onOpen(sale);
                }
              }}
            >
              <td className="whitespace-nowrap tabular-nums">
                {koDate(event.eventDate)}
              </td>
              <td>
                <Badge tone={eventBadgeTone(event)}>
                  {accountingEventLabel(event.kind)}
                </Badge>
                {event.paymentMethod && (
                  <span className="mt-1 block text-xs text-text-muted">
                    {paymentMethodLabels[
                      event.paymentMethod as keyof typeof paymentMethodLabels
                    ] || event.paymentMethod}
                  </span>
                )}
              </td>
              <td>
                <strong className="block max-w-44 truncate text-text-primary">
                  {sale.dogName}
                </strong>
                <span className="mt-1 block max-w-44 truncate text-xs text-text-muted">
                  {sale.customerName || "보호자 미등록"}
                </span>
              </td>
              <td>
                <strong className="block max-w-52 truncate text-text-primary">
                  {sale.productName}
                </strong>
                <span className="mt-1 block text-xs text-text-muted">
                  {sale.businessUnitName}
                </span>
              </td>
              <td data-numeric className="text-right">
                <EventAmount value={event.saleAmount} />
              </td>
              <td data-numeric className="text-right">
                <EventAmount value={event.paidAmount} />
              </td>
              <td data-numeric className="text-right">
                <EventAmount value={event.refundAmount} tone="danger" />
              </td>
              <td>{sale.staffName || "미지정"}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function AccountingLedgerCard({
  event,
  sale,
  onOpen,
}: {
  event: AccountingEvent;
  sale: SaleRow;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="min-h-32 rounded-2xl border border-border bg-surface p-4 text-left transition-colors hover:border-primary/25 hover:bg-primary-subtle/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <Badge tone={eventBadgeTone(event)}>
            {accountingEventLabel(event.kind)}
          </Badge>
          <span className="ml-2 text-xs text-text-muted tabular-nums">
            {koDate(event.eventDate)}
          </span>
        </div>
        <Eye size={16} className="text-text-muted" />
      </div>
      <strong className="mt-3 block truncate text-base text-text-primary">
        {sale.dogName} · {sale.customerName || "보호자 미등록"}
      </strong>
      <span className="mt-1 block truncate text-xs text-text-muted">
        {sale.businessUnitName} · {sale.productName}
      </span>
      <div className="mt-3 grid grid-cols-3 gap-2 text-right text-sm">
        <EventAmount value={event.saleAmount} />
        <EventAmount value={event.paidAmount} />
        <EventAmount value={event.refundAmount} tone="danger" />
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-right text-[10px] text-text-muted">
        <span>판매</span>
        <span>실수납</span>
        <span>환불</span>
      </div>
    </button>
  );
}

function SalesHistoryContext({
  range,
  unitName,
  summary,
  singleDay,
  onMoveDay,
  onClearDate,
  onClearUnit,
}: {
  range: { start: string; end: string };
  unitName: string;
  summary: ReturnType<typeof calculateSalesSummary>;
  singleDay: boolean;
  onMoveDay: (days: number) => void;
  onClearDate: () => void;
  onClearUnit: () => void;
}) {
  const rangeLabel =
    range.start && range.end
      ? range.start === range.end
        ? koDate(range.start)
        : `${koDate(range.start)} ~ ${koDate(range.end)}`
      : "전체 기간";
  const metrics = [
    ["실매출", won(summary.netAmount)],
    ["매출 건수", `${summary.count.toLocaleString("ko-KR")}건`],
    ["미수금", won(summary.outstandingAmount)],
    ["환불", won(summary.refundAmount)],
  ] as const;

  return (
    <Card className="mb-5 overflow-hidden border-primary/15">
      <div className="flex flex-col gap-4 border-b border-border bg-primary-subtle px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-primary shadow-sm">
            <CalendarDays size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-secondary">
              현재 조회 기준
            </p>
            <h2 className="mt-0.5 truncate text-base font-bold text-text-primary tabular-nums sm:text-lg">
              {rangeLabel}
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Building2 size={13} aria-hidden="true" />
              {unitName}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {singleDay && (
            <>
              <Button
                type="button"
                variant="secondary"
                className="px-3"
                aria-label="이전 날짜 매출 보기"
                onClick={() => onMoveDay(-1)}
              >
                <ChevronLeft size={16} />
                이전 날
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="px-3"
                aria-label="다음 날짜 매출 보기"
                onClick={() => onMoveDay(1)}
              >
                다음 날
                <ChevronRight size={16} />
              </Button>
            </>
          )}
          {unitName !== "전체 사업부" && (
            <Button type="button" variant="ghost" onClick={onClearUnit}>
              전체 사업부
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClearDate}>
            이번 달
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
        {metrics.map(([label, value], index) => (
          <div
            key={label}
            className={cn(
              "min-w-0 px-4 py-4 sm:px-5",
              index === 0 && "bg-white",
            )}
          >
            <span className="block text-[11px] font-semibold text-text-muted">
              {label}
            </span>
            <strong
              className={cn(
                "mt-1 block truncate font-bold text-text-primary tabular-nums",
                index === 0 ? "text-xl sm:text-2xl" : "text-base sm:text-lg",
                label === "미수금" && summary.outstandingAmount > 0 &&
                  "text-warning",
              )}
            >
              {value}
            </strong>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TodayActivityCards({
  activity,
}: {
  activity: ReturnType<typeof calculateTodayActivity>;
}) {
  const cards = [
    ["오늘 등록", `${activity.registeredCount}건`, "created"],
    ["오늘 실수납", won(activity.netAmount), "net"],
    ["오늘 환불액", won(activity.refundAmount), "refund"],
    ["현재 미수금", won(activity.outstandingAmount), "outstanding"],
    ["오늘 취소", `${activity.cancelledCount}건`, "cancelled"],
  ] as const;
  return (
    <section aria-labelledby="today-activity-title" className="mb-5">
      <div className="mb-3 flex items-center gap-2">
        <Clock3 size={17} className="text-primary" />
        <h2
          id="today-activity-title"
          className="text-sm font-semibold text-text-primary"
        >
          오늘 활동
        </h2>
        <span className="text-xs text-text-muted">한국 시간 기준</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map(([label, value, key]) => (
          <Card key={key} className="min-w-0 p-4">
            <p className="text-xs font-medium text-text-secondary">{label}</p>
            <strong
              className={cn(
                "mt-2 block truncate text-lg font-bold tabular-nums",
                key === "outstanding" && activity.outstandingAmount > 0
                  ? "text-warning"
                  : "text-text-primary",
              )}
            >
              {value}
            </strong>
          </Card>
        ))}
      </div>
    </section>
  );
}

function TodayRegistered({
  rows,
  profileId,
  onOpen,
  onViewAll,
}: {
  rows: SaleRow[];
  profileId: string | null;
  onOpen: (sale: SaleRow) => void;
  onViewAll: () => void;
}) {
  return (
    <Card className="mb-5 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">
            오늘 등록한 매출
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            내가 등록한 매출을 먼저 표시합니다.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="px-3"
          onClick={onViewAll}
        >
          전체 보기
        </Button>
      </div>
      {rows.length ? (
        <div className="flex snap-x gap-3 overflow-x-auto p-4 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-5">
          {rows.map((sale) => (
            <button
              key={sale.id}
              type="button"
              onClick={() => onOpen(sale)}
              className="min-h-36 w-[260px] shrink-0 snap-start rounded-2xl border border-border bg-surface p-4 text-left transition duration-200 hover:border-primary/25 hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-auto"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">
                  {dateTime(sale.createdAt)}
                </span>
                {sale.createdBy === profileId && (
                  <Badge tone="blue">내 등록</Badge>
                )}
              </div>
              <strong className="mt-3 block truncate text-sm text-text-primary">
                {sale.dogName}
              </strong>
              <span className="mt-1 block truncate text-xs text-text-secondary">
                {sale.customerName || "보호자 미등록"} · {sale.businessUnitName}
              </span>
              <span className="mt-1 block truncate text-xs text-text-secondary">
                {sale.productName}
              </span>
              <div className="mt-3 flex items-center justify-between gap-2">
                <b className="tabular-nums text-primary">
                  {won(sale.paidAmount)}
                </b>
                <SaleStatusBadges sale={sale} compact />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-5 py-6 text-sm text-text-muted">
          오늘 등록된 매출이 없습니다.
        </div>
      )}
    </Card>
  );
}

interface FilterOptionProps {
  staffId: string;
  createdBy: string;
  paymentMethod: string;
  categoryId: string;
  productId: string;
  minAmount: string;
  maxAmount: string;
  staffOptions: [string, string][];
  registrarOptions: [string, string][];
  categoryOptions: [string, string][];
  productOptions: [string, string][];
  onChange: (key: string, value: string) => void;
}

function AdvancedFilterFields(props: FilterOptionProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="담당자">
        <Select
          value={props.staffId}
          onChange={(event) => props.onChange("staff", event.target.value)}
        >
          <option value="">전체 담당자</option>
          {props.staffOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="등록자">
        <Select
          value={props.createdBy}
          onChange={(event) => props.onChange("createdBy", event.target.value)}
        >
          <option value="">전체 등록자</option>
          {props.registrarOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="결제수단">
        <Select
          value={props.paymentMethod}
          onChange={(event) => props.onChange("payment", event.target.value)}
        >
          <option value="">전체 결제수단</option>
          {Object.entries(paymentLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="상품 분류">
        <Select
          value={props.categoryId}
          onChange={(event) => props.onChange("category", event.target.value)}
        >
          <option value="">전체 상품 분류</option>
          {props.categoryOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="상품">
        <Select
          value={props.productId}
          onChange={(event) => props.onChange("product", event.target.value)}
        >
          <option value="">전체 상품</option>
          {props.productOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="최소 결제금액">
        <Input
          inputMode="numeric"
          type="number"
          min="0"
          step="1"
          placeholder="0"
          value={props.minAmount}
          onChange={(event) => props.onChange("min", event.target.value)}
        />
      </Field>
      <Field label="최대 결제금액">
        <Input
          inputMode="numeric"
          type="number"
          min="0"
          step="1"
          placeholder="제한 없음"
          value={props.maxAmount}
          onChange={(event) => props.onChange("max", event.target.value)}
        />
      </Field>
    </div>
  );
}

function SaleStatusBadges({
  sale,
  compact = false,
}: {
  sale: SaleRow;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex flex-wrap items-center gap-1",
        compact && "justify-end",
      )}
    >
      <StatusBadge status={sale.status} />
      {hasOutstanding(sale) && <StatusBadge status="outstanding" />}
    </span>
  );
}

function DuplicateBadge({
  warning,
}: {
  warning: DuplicateWarning | undefined;
}) {
  if (!warning) return null;
  return (
    <span title={warning.description}>
      <Badge tone={warning.level === "strong" ? "red" : "amber"}>
        <AlertTriangle size={12} className="mr-1" />
        중복 확인
      </Badge>
    </span>
  );
}

function SalesTable({
  rows,
  profileNames,
  duplicateWarnings,
  onOpen,
}: {
  rows: SaleRow[];
  profileNames: Record<string, string>;
  duplicateWarnings: Map<string, DuplicateWarning>;
  onOpen: (sale: SaleRow) => void;
}) {
  return (
    <Table className="min-w-[1040px]">
      <thead>
        <tr>
          <th>반려견·보호자</th>
          <th data-numeric>최종금액</th>
          <th>상태</th>
          <th>상품</th>
          <th>사업부</th>
          <th>담당자</th>
          <th>날짜</th>
          <th className="text-right">더보기</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((sale) => (
          <tr
            key={sale.id}
            tabIndex={0}
            aria-label={`${sale.dogName} ${sale.productName} 매출 상세 보기`}
            className="group cursor-pointer outline-none transition-[filter] duration-200 hover:drop-shadow-[0_3px_6px_rgba(23,36,58,0.06)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&>td]:transition-[background-color,border-color] [&>td]:duration-200 hover:[&>td]:border-primary/15 hover:[&>td]:bg-primary-subtle/70"
            onClick={() => onOpen(sale)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(sale);
              }
            }}
          >
            <td>
              <div className="flex min-w-0 items-start gap-2">
                <div className="min-w-0">
                  <strong className="block max-w-48 truncate text-[0.9375rem] font-bold tracking-[-0.01em] text-text-primary">
                    {sale.dogName}
                  </strong>
                  <span className="mt-1 block max-w-48 truncate text-xs font-medium text-text-secondary">
                    {sale.customerName || "보호자 미등록"}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-text-muted tabular-nums">
                    {displayPhone(sale.customerPhone)}
                  </span>
                </div>
                <DuplicateBadge warning={duplicateWarnings.get(sale.id)} />
              </div>
            </td>
            <td data-numeric className="min-w-36">
              <strong className="block text-base font-bold tracking-[-0.025em] text-text-primary tabular-nums">
                {won(
                  calculateFinalSaleAmount(
                    sale.originalAmount,
                    sale.additionalAmount,
                    sale.discountAmount,
                  ),
                )}
              </strong>
              <span className="mt-1 block text-[11px] text-text-muted tabular-nums">
                실매출 {won(sale.netAmount)}
              </span>
            </td>
            <td>
              <SaleStatusBadges sale={sale} />
              <span className="mt-1.5 block max-w-36 truncate text-[11px] text-text-muted">
                {paymentSummary(sale.paymentRows, sale.paymentMethod, sale.paidAmount)}
              </span>
            </td>
            <td>
              <span className="block max-w-48 truncate font-semibold text-text-primary">
                {sale.productName}
              </span>
              <span className="mt-1 block max-w-48 truncate text-xs text-text-muted">
                {formatQuantityWithUnit(sale.quantity, sale.unitLabel)}
                {" · "}
                {won(sale.unitPrice)}
              </span>
            </td>
            <td>
              <Badge tone="blue">{sale.businessUnitName}</Badge>
            </td>
            <td>
              <span className="block max-w-28 truncate font-medium text-text-primary">
                {sale.staffName || "-"}
              </span>
              <span className="mt-1 block max-w-28 truncate text-[11px] text-text-muted">
                등록 {profileNames[sale.createdBy] || sale.registrarName || "-"}
              </span>
            </td>
            <td>
              <span className="block font-medium text-text-primary tabular-nums">
                {koDate(sale.saleDate)}
              </span>
              <span className="mt-1 block text-[11px] text-text-muted tabular-nums">
                {dateTime(sale.createdAt)}
              </span>
            </td>
            <td
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <div className="flex justify-end">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`${sale.dogName} 매출 상세`}
                  title="상세"
                  onClick={() => onOpen(sale)}
                >
                  <Eye size={16} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function SalesHistoryLoadingState() {
  return (
    <div aria-busy="true" aria-label="매출 내역을 불러오는 중">
      <div className="hidden xl:block">
        <Table className="min-w-[1040px]">
          <thead>
            <tr>
              <th>반려견·보호자</th>
              <th data-numeric>최종금액</th>
              <th>상태</th>
              <th>상품</th>
              <th>사업부</th>
              <th>담당자</th>
              <th>날짜</th>
              <th className="text-right">더보기</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 7 }, (_, index) => (
              <tr key={index}>
                <td><Skeleton className="h-12 w-44" /></td>
                <td><Skeleton className="ml-auto h-10 w-28" /></td>
                <td><Skeleton className="h-8 w-24" /></td>
                <td><Skeleton className="h-10 w-40" /></td>
                <td><Skeleton className="h-7 w-20" /></td>
                <td><Skeleton className="h-10 w-24" /></td>
                <td><Skeleton className="h-10 w-28" /></td>
                <td><Skeleton className="ml-auto h-9 w-9" /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div className="grid gap-3 bg-surface-secondary/60 p-3 md:grid-cols-2 xl:hidden">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-7 w-24" />
            </div>
            <Skeleton className="mt-5 h-4 w-full" />
            <Skeleton className="mt-3 h-8 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SaleMobileCard({
  sale,
  registrarName,
  warning,
  onOpen,
}: {
  sale: SaleRow;
  registrarName: string;
  warning: DuplicateWarning | undefined;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${sale.dogName} ${sale.productName} 매출 상세 보기`}
      className="group w-full rounded-2xl border border-border bg-surface p-4 text-left shadow-[0_1px_2px_rgba(23,36,58,0.03)] outline-none transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-primary-subtle/40 hover:shadow-[0_8px_18px_rgba(23,36,58,0.07)] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="max-w-52 truncate text-lg font-bold tracking-[-0.02em] text-text-primary">
              {sale.dogName}
            </strong>
            <DuplicateBadge warning={warning} />
          </div>
          <p className="mt-1 truncate text-sm font-medium text-text-secondary">
            {sale.customerName || "보호자 미등록"} ·{" "}
            {displayPhone(sale.customerPhone)}
          </p>
        </div>
        <SaleStatusBadges sale={sale} compact />
      </div>
      <div className="mt-4 flex items-end justify-between gap-4 border-y border-border py-3.5">
        <div className="min-w-0">
          <span className="block text-[11px] font-semibold text-text-muted">
            상품
          </span>
          <strong className="mt-1 block truncate text-sm text-text-primary">
          {sale.productName}
          </strong>
          <span className="mt-1 block truncate text-xs text-text-muted">
            {sale.businessUnitName} ·{" "}
            {formatQuantityWithUnit(sale.quantity, sale.unitLabel)}
          </span>
        </div>
        <div className="shrink-0 text-right">
          <span className="block text-[11px] font-semibold text-text-muted">
            최종금액
          </span>
          <b className="mt-1 block text-lg font-bold tracking-[-0.025em] text-text-primary tabular-nums">
            {won(
              calculateFinalSaleAmount(
                sale.originalAmount,
                sale.additionalAmount,
                sale.discountAmount,
              ),
            )}
          </b>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        <p className="text-text-secondary">
          실매출{" "}
          <strong className="font-semibold text-primary tabular-nums">
            {won(sale.netAmount)}
          </strong>
        </p>
        <p className="text-text-muted">
          {paymentSummary(sale.paymentRows, sale.paymentMethod, sale.paidAmount)}
        </p>
        {(sale.refundAmount > 0 ||
          (sale.status !== "cancelled" && sale.outstandingAmount > 0)) && (
          <p className="basis-full text-text-secondary tabular-nums">
            환불 {won(sale.refundAmount)}
            {sale.status !== "cancelled" &&
              ` · 미수 ${won(sale.outstandingAmount)}`}
          </p>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-text-muted">
        <div>
          <dt className="inline">매출일 </dt>
          <dd className="inline text-text-secondary">
            {koDate(sale.saleDate)}
          </dd>
        </div>
        <div className="text-right">
          <dt className="inline">등록 </dt>
          <dd className="inline text-text-secondary">
            {dateTime(sale.createdAt)}
          </dd>
        </div>
        <div>
          <dt className="inline">담당 </dt>
          <dd className="inline text-text-secondary">
            {sale.staffName || "-"}
          </dd>
        </div>
        <div className="text-right">
          <dt className="inline">등록자 </dt>
          <dd className="inline text-text-secondary">{registrarName}</dd>
        </div>
      </dl>
      <p className="mt-3 border-t border-border pt-3 text-right text-xs font-semibold text-primary transition-colors group-hover:text-primary-hover">
        상세 보기
      </p>
    </button>
  );
}

function MoneyInput({
  value,
  onChange,
  disabled,
  max,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  max?: number;
}) {
  return (
    <Input
      type="number"
      min="0"
      max={max}
      step="1"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value) || 0)}
    />
  );
}

function RefundSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-semibold text-text-muted">
        {label}
      </span>
      <strong className="mt-1 block truncate text-xs text-text-primary tabular-nums sm:text-sm">
        {value}
      </strong>
    </div>
  );
}

function JsonData({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-text-muted">{label}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-2 text-xs text-text-secondary ring-1 ring-inset ring-border">
        {value == null ? "-" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
