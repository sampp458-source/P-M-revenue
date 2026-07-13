import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  AlertTriangle,
  Clock3,
  Eye,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Undo2,
  X,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
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
  StatusBadge,
  Table,
  Textarea,
  Toast,
} from "../components/ui";
import { koDate, won } from "../lib/format";
import { supabase } from "../lib/supabase";
import {
  calculateTodayActivity,
  filterSales,
  findDuplicateWarnings,
  hasOutstanding,
  koreanDate,
  normalizePhone,
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
}

interface HistoryRow {
  id: string;
  action: string;
  previousData: unknown;
  changedData: unknown;
  changedBy: string;
  createdAt: string;
}

const paymentLabel: Record<string, string> = {
  card: "카드",
  transfer: "계좌이체",
  cash: "현금",
  outstanding: "미수",
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

async function loadSaleRows() {
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

const maskPhone = (phone: string | null) => {
  const digits = normalizePhone(phone);
  if (digits.length === 11)
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  return phone || "-";
};

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
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const query = searchParams.get("q") ?? "";
  const periodParam = searchParams.get("period") as PeriodFilter | null;
  const period =
    periodParam && validPeriods.has(periodParam) ? periodParam : "month";
  const startDate = searchParams.get("start") ?? "";
  const endDate = searchParams.get("end") ?? "";
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
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<SaleRow | null>(null);
  const [refunding, setRefunding] = useState<SaleRow | null>(null);
  const [cancelling, setCancelling] = useState<SaleRow | null>(null);
  const [reopening, setReopening] = useState<SaleRow | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [cancellationReason, setCancellationReason] = useState("");
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
    if (hasAdvancedFilters) setAdvancedOpen(true);
  }, [hasAdvancedFilters]);

  const loadSales = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [result, profilesResult, customersResult] = await Promise.all([
      loadSaleRows(),
      supabase.rpc("get_staff_history_directory"),
      supabase.from("customers").select("id, phone"),
    ]);
    if (result.error || customersResult.error) {
      setSales([]);
      setLoadError(true);
    } else {
      const saleRows = (result.data ?? []) as unknown as SaleQueryRow[];
      const customerPhones = new Map(
        (customersResult.data ?? []).map((customer) => [
          customer.id,
          customer.phone,
        ]),
      );
      const names = Object.fromEntries(
        (profilesResult.data ?? []).map((row: { id: string; name: string }) => [
          row.id,
          row.name,
        ]),
      );
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
  }, []);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  const units = useMemo(
    () => [
      ...new Map(
        sales.map((sale) => [sale.businessUnitId, sale.businessUnitName]),
      ).entries(),
    ],
    [sales],
  );
  const today = koreanDate(new Date());
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
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const todayActivity = useMemo(
    () => calculateTodayActivity(sales, today),
    [sales, today],
  );
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
  const mapError = (message: string, code?: string) =>
    code === "42501"
      ? "권한이 없습니다."
      : message.includes("마감된 월")
        ? "마감된 월의 매출은 변경할 수 없습니다."
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
    setSaving(false);
    if (result.error) {
      setActionError(mapError(result.error.message, result.error.code));
      return;
    }
    setEditing(null);
    setNotice("매출 정보를 수정했습니다.");
    await loadSales();
  };

  const applyRefund = async () => {
    if (!refunding) return;
    if (refundAmount <= 0 || refundAmount > refunding.paidAmount) {
      setActionError("환불 금액은 0원보다 크고 결제 금액 이하여야 합니다.");
      return;
    }
    setSaving(true);
    setActionError("");
    const result = await supabase
      .from("sales")
      .update({ refund_amount: Math.trunc(refundAmount) })
      .eq("id", refunding.id)
      .select("id")
      .single();
    setSaving(false);
    if (result.error) {
      setActionError(mapError(result.error.message, result.error.code));
      return;
    }
    setRefunding(null);
    setNotice(
      refundAmount === refunding.paidAmount
        ? "전액 환불을 처리했습니다."
        : "부분 환불을 처리했습니다.",
    );
    await loadSales();
  };

  const cancelSale = async () => {
    if (!cancelling) return;
    if (!cancellationReason.trim()) {
      setActionError("취소 사유를 입력해 주세요.");
      return;
    }
    setSaving(true);
    setActionError("");
    const result = await supabase
      .from("sales")
      .update({
        status: "cancelled",
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
    setNotice("매출을 취소했습니다.");
    await loadSales();
  };

  const openDetail = useCallback(async (sale: SaleRow) => {
    setSelected(sale);
    setHistory([]);
    setHistoryLoading(true);
    setHistoryError(false);
    const result = await supabase
      .from("sale_history")
      .select("id, action, previous_data, changed_data, changed_by, created_at")
      .eq("sale_id", sale.id)
      .order("created_at", { ascending: true });
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
    setHistoryLoading(false);
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
    setSaving(true);
    setActionError("");
    const result = await supabase
      .from("sales")
      .update({ status: "normal" })
      .eq("id", reopening.id)
      .select("id")
      .single();
    setSaving(false);
    if (result.error) {
      setActionError(mapError(result.error.message, result.error.code));
      return;
    }
    setReopening(null);
    setNotice("취소된 매출을 복구했습니다.");
    await loadSales();
  };

  const resetFilters = () => {
    const next = new URLSearchParams();
    const detailId = searchParams.get("detail");
    if (detailId) next.set("detail", detailId);
    setSearchParams(next, { replace: true });
  };

  const filterChips: Array<{
    key: string;
    label: string;
    clear: Record<string, string | null>;
  }> = [];
  if (query)
    filterChips.push({ key: "q", label: `검색: ${query}`, clear: { q: null } });
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
        title="매출 내역"
        description="결제, 환불, 취소 및 미수금 현황을 확인합니다."
        action={
          <Button onClick={() => navigate("/sales/new")}>
            <Plus size={17} />
            매출 등록
          </Button>
        }
      />
      <TodayActivityCards activity={todayActivity} />
      <TodayRegistered
        rows={recentToday}
        profileId={profile?.id ?? null}
        onOpen={showDetail}
        onViewAll={() => updateParams({ period: "today" })}
      />
      <FilterToolbar className="gap-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_170px_170px_170px_auto]">
          <div>
            <SearchBox
              aria-label="매출 내역 검색"
              placeholder="반려견명, 보호자명, 연락처, 상품명으로 검색"
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
          </div>
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
          <Button
            type="button"
            variant="secondary"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(true)}
          >
            <SlidersHorizontal size={16} />
            고급 필터
          </Button>
        </div>
        {period === "custom" && (
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
            {filtered.length}
          </strong>
          건의 매출
        </p>
        {query !== debouncedQuery && (
          <span className="text-xs text-text-muted">검색 결과 갱신 중…</span>
        )}
      </div>
      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : loadError ? (
          <ErrorState
            title="매출 내역을 불러오지 못했습니다."
            retry={() => void loadSales()}
          />
        ) : rows.length ? (
          <>
            <div className="hidden xl:block">
              <SalesTable
                rows={rows}
                profileRole={profile?.role}
                profileNames={profileNames}
                duplicateWarnings={duplicateWarnings}
                canEdit={canEdit}
                onOpen={showDetail}
                onEdit={(sale) => {
                  setActionError("");
                  setEditing({ ...sale });
                }}
                onRefund={(sale) => {
                  setActionError("");
                  setRefundAmount(sale.refundAmount || 0);
                  setRefunding(sale);
                }}
                onCancel={(sale) => {
                  setActionError("");
                  setCancellationReason("");
                  setCancelling(sale);
                }}
                onReopen={(sale) => {
                  setActionError("");
                  setReopening(sale);
                }}
              />
            </div>
            <div className="divide-y divide-border xl:hidden">
              {rows.map((sale) => (
                <SaleMobileCard
                  key={sale.id}
                  sale={sale}
                  registrarName={
                    profileNames[sale.createdBy] || sale.registrarName || "-"
                  }
                  warning={duplicateWarnings.get(sale.id)}
                  admin={profile?.role === "admin"}
                  editable={canEdit(sale)}
                  onOpen={() => showDetail(sale)}
                  onEdit={() => {
                    setActionError("");
                    setEditing({ ...sale });
                  }}
                  onRefund={() => {
                    setActionError("");
                    setRefundAmount(sale.refundAmount || 0);
                    setRefunding(sale);
                  }}
                  onCancel={() => {
                    setActionError("");
                    setCancellationReason("");
                    setCancelling(sale);
                  }}
                  onReopen={() => {
                    setActionError("");
                    setReopening(sale);
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            title="조회된 매출이 없습니다"
            description={
              query
                ? `“${query}” 검색어와 현재 필터 조건에 맞는 매출이 없습니다.`
                : "필터 조건을 확인해 주세요."
            }
          />
        )}
      </Card>
      {!loading && !loadError && filtered.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalLabel={`총 ${filtered.length}건`}
          onPageChange={(value) =>
            updateParams({ page: value > 1 ? String(value) : null }, false)
          }
        />
      )}
      <Modal open={!!selected} onClose={closeDetail} title="매출 상세" wide>
        {selected && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="사업부" value={selected.businessUnitName} />
              <Detail label="반려견" value={selected.dogName} />
              <Detail
                label="보호자"
                value={selected.customerName || "미등록"}
              />
              <Detail label="상품 분류" value={selected.categoryName} />
              <Detail label="상품" value={selected.productName} />
              <Detail label="수량" value={`${selected.quantity}`} />
              <Detail label="기준 단가" value={won(selected.unitPrice)} />
              <Detail
                label="기준 계산금액"
                value={won(selected.originalAmount)}
              />
              <Detail label="추가금액" value={won(selected.additionalAmount)} />
              <Detail label="할인액" value={won(selected.discountAmount)} />
              <Detail
                label="최종 판매금액"
                value={won(
                  calculateFinalSaleAmount(
                    selected.originalAmount,
                    selected.additionalAmount,
                    selected.discountAmount,
                  ),
                )}
              />
              <Detail label="결제액" value={won(selected.paidAmount)} />
              <Detail label="미수금" value={won(selected.outstandingAmount)} />
              <Detail label="환불액" value={won(selected.refundAmount)} />
              <Detail label="실매출" value={won(selected.netAmount)} />
              <Detail
                label="결제수단"
                value={
                  paymentLabel[selected.paymentMethod] || selected.paymentMethod
                }
              />
              <Detail
                label="등록자"
                value={profileNames[selected.createdBy] || "-"}
              />
              <Detail label="담당자" value={selected.staffName || "-"} />
              <Detail
                label="등록일"
                value={new Date(selected.createdAt).toLocaleString("ko-KR")}
              />
              <Detail
                label="수정일"
                value={new Date(selected.updatedAt).toLocaleString("ko-KR")}
              />
              <Detail
                label="취소 여부"
                value={
                  selected.status === "cancelled"
                    ? `취소 (${selected.cancelledAt ? new Date(selected.cancelledAt).toLocaleString("ko-KR") : "-"})`
                    : "아니오"
                }
              />
              <Detail
                label="취소 사유"
                value={selected.cancellationReason || "-"}
              />
              <Detail label="메모" value={selected.memo || "-"} />
              <Detail
                label="금액 조정 메모"
                value={selected.adjustmentNote || "-"}
              />
            </div>
            <div className="mt-6 border-t pt-5">
              <h3 className="mb-3 font-semibold">변경 이력</h3>
              {historyLoading ? (
                <LoadingState />
              ) : historyError ? (
                <p className="text-sm text-red-600">
                  매출 변경 이력을 불러오지 못했습니다.
                </p>
              ) : history.length ? (
                <div className="space-y-3">
                  {history.map((item) => (
                    <div key={item.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge>{item.action}</Badge>
                        <span className="text-xs text-slate-500">
                          {profileNames[item.changedBy] || item.changedBy} ·{" "}
                          {new Date(item.createdAt).toLocaleString("ko-KR")}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <JsonData
                          label="previous_data"
                          value={item.previousData}
                        />
                        <JsonData
                          label="changed_data"
                          value={item.changedData}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  기록된 변경 이력이 없습니다.
                </p>
              )}
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => !saving && setEditing(null)}
        title="매출 수정"
        wide
      >
        {editing && (
          <form onSubmit={saveEdit} className="grid gap-4 sm:grid-cols-2">
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
            <Field label="결제 금액">
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
            </Field>
            <Field label="미수금">
              <Input value={won(editing.outstandingAmount)} disabled />
            </Field>
            <Field label="결제 수단">
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
            </Field>
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
      <Modal
        open={!!refunding}
        onClose={() => !saving && setRefunding(null)}
        title="환불 처리"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving) void applyRefund();
          }}
        >
          <Field label="누적 환불 금액" required>
            <MoneyInput
              value={refundAmount}
              disabled={saving}
              max={refunding?.paidAmount}
              onChange={setRefundAmount}
            />
          </Field>
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
        onClose={() => !saving && setCancelling(null)}
        title="매출 취소"
      >
        <Field label="취소 사유" required>
          <Textarea
            value={cancellationReason}
            disabled={saving}
            onChange={(e) => setCancellationReason(e.target.value)}
          />
        </Field>
        {actionError && (
          <p className="mt-3 text-sm text-red-600">{actionError}</p>
        )}
        <Button
          className="mt-4 w-full"
          variant="danger"
          disabled={saving}
          onClick={() => void cancelSale()}
        >
          {saving ? "처리 중..." : "매출 취소"}
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
            취소된 매출을 복구합니다. 환불 금액에 따라 정상·부분환불·전체환불
            상태가 다시 계산됩니다.
            {actionError && (
              <span role="alert" className="mt-3 block text-red-600">
                {actionError}
              </span>
            )}
          </>
        }
      />
      {notice && <Toast message={notice} onClose={() => setNotice("")} />}
    </>
  );
}

function TodayActivityCards({
  activity,
}: {
  activity: ReturnType<typeof calculateTodayActivity>;
}) {
  const cards = [
    ["오늘 등록", `${activity.registeredCount}건`, "created"],
    ["오늘 실매출", won(activity.netAmount), "net"],
    ["오늘 환불액", won(activity.refundAmount), "refund"],
    ["오늘 미수금", won(activity.outstandingAmount), "outstanding"],
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

interface SalesActions {
  onOpen: (sale: SaleRow) => void;
  onEdit: (sale: SaleRow) => void;
  onRefund: (sale: SaleRow) => void;
  onCancel: (sale: SaleRow) => void;
  onReopen: (sale: SaleRow) => void;
}

function SalesTable({
  rows,
  profileRole,
  profileNames,
  duplicateWarnings,
  canEdit,
  onOpen,
  onEdit,
  onRefund,
  onCancel,
  onReopen,
}: {
  rows: SaleRow[];
  profileRole?: "admin" | "staff";
  profileNames: Record<string, string>;
  duplicateWarnings: Map<string, DuplicateWarning>;
  canEdit: (sale: SaleRow) => boolean;
} & SalesActions) {
  return (
    <Table className="min-w-[1120px]">
      <thead>
        <tr>
          <th>등록일시</th>
          <th>반려견·보호자</th>
          <th className="hidden xl:table-cell">연락처</th>
          <th>사업부·상품</th>
          <th className="hidden lg:table-cell">담당자</th>
          <th data-numeric>최종/결제</th>
          <th data-numeric className="hidden xl:table-cell">
            환불
          </th>
          <th data-numeric className="hidden xl:table-cell">
            미수금
          </th>
          <th data-numeric>실매출</th>
          <th>상태</th>
          <th className="hidden 2xl:table-cell">등록자</th>
          <th className="text-right">관리</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((sale) => (
          <tr
            key={sale.id}
            tabIndex={0}
            aria-label={`${sale.dogName} ${sale.productName} 매출 상세 보기`}
            className="cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            onClick={() => onOpen(sale)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(sale);
            }}
          >
            <td>
              <span className="block font-medium text-text-primary">
                {koDate(sale.saleDate)}
              </span>
              <span className="mt-0.5 block text-xs text-text-muted">
                {dateTime(sale.createdAt)}
              </span>
            </td>
            <td>
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <strong className="block max-w-44 truncate text-text-primary">
                    {sale.dogName}
                  </strong>
                  <span className="mt-0.5 block max-w-44 truncate text-xs text-text-muted">
                    {sale.customerName || "보호자 미등록"}
                  </span>
                </div>
                <DuplicateBadge warning={duplicateWarnings.get(sale.id)} />
              </div>
            </td>
            <td className="hidden xl:table-cell">
              {maskPhone(sale.customerPhone)}
            </td>
            <td>
              <span className="block max-w-48 truncate font-medium text-text-primary">
                {sale.productName}
              </span>
              <span className="mt-0.5 block max-w-48 truncate text-xs text-text-muted">
                {sale.businessUnitName} · 수량 {sale.quantity}
              </span>
            </td>
            <td className="hidden lg:table-cell">{sale.staffName || "-"}</td>
            <td data-numeric>
              <strong className="block font-semibold text-text-primary">
                {won(
                  calculateFinalSaleAmount(
                    sale.originalAmount,
                    sale.additionalAmount,
                    sale.discountAmount,
                  ),
                )}
              </strong>
              <span className="mt-0.5 block text-xs text-text-muted">
                결제 {won(sale.paidAmount)}
              </span>
            </td>
            <td data-numeric className="hidden xl:table-cell">
              {won(sale.refundAmount)}
            </td>
            <td
              data-numeric
              className={cn(
                "hidden xl:table-cell",
                sale.outstandingAmount > 0 && "font-semibold text-warning",
              )}
            >
              {won(sale.outstandingAmount)}
            </td>
            <td data-numeric className="font-semibold text-primary">
              {won(sale.netAmount)}
            </td>
            <td>
              <SaleStatusBadges sale={sale} />
            </td>
            <td className="hidden 2xl:table-cell">
              {profileNames[sale.createdBy] || sale.registrarName || "-"}
            </td>
            <td
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`${sale.dogName} 매출 상세`}
                  title="상세"
                  onClick={() => onOpen(sale)}
                >
                  <Eye size={16} />
                </button>
                {canEdit(sale) && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${sale.dogName} 매출 수정`}
                    title="수정"
                    onClick={() => onEdit(sale)}
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {profileRole === "admin" && sale.status !== "cancelled" && (
                  <>
                    <Button
                      className="min-h-9 px-2 py-1 text-xs"
                      variant="secondary"
                      disabled={sale.refundAmount >= sale.paidAmount}
                      onClick={() => onRefund(sale)}
                    >
                      환불
                    </Button>
                    <Button
                      className="min-h-9 px-2 py-1 text-xs"
                      variant="secondary"
                      onClick={() => onCancel(sale)}
                    >
                      <Undo2 size={14} />
                      취소
                    </Button>
                  </>
                )}
                {profileRole === "admin" && sale.status === "cancelled" && (
                  <Button
                    className="min-h-9 px-2 py-1 text-xs"
                    variant="secondary"
                    onClick={() => onReopen(sale)}
                  >
                    취소 복구
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function SaleMobileCard({
  sale,
  registrarName,
  warning,
  admin,
  editable,
  onOpen,
  onEdit,
  onRefund,
  onCancel,
  onReopen,
}: {
  sale: SaleRow;
  registrarName: string;
  warning: DuplicateWarning | undefined;
  admin: boolean;
  editable: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onRefund: () => void;
  onCancel: () => void;
  onReopen: () => void;
}) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`${sale.dogName} ${sale.productName} 매출 상세 보기`}
      className="cursor-pointer p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="max-w-44 truncate text-base text-text-primary">
              {sale.dogName}
            </strong>
            <DuplicateBadge warning={warning} />
          </div>
          <p className="mt-1 truncate text-sm text-text-secondary">
            {sale.customerName || "보호자 미등록"} ·{" "}
            {maskPhone(sale.customerPhone)}
          </p>
        </div>
        <SaleStatusBadges sale={sale} compact />
      </div>
      <div className="mt-4 rounded-xl bg-surface-secondary p-3">
        <strong className="block truncate text-sm text-text-primary">
          {sale.productName}
        </strong>
        <span className="mt-1 block truncate text-xs text-text-muted">
          {sale.businessUnitName} · 수량 {sale.quantity}
        </span>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <span className="block text-[11px] text-text-muted">최종금액</span>
            <b className="mt-0.5 block tabular-nums text-text-primary">
              {won(
                calculateFinalSaleAmount(
                  sale.originalAmount,
                  sale.additionalAmount,
                  sale.discountAmount,
                ),
              )}
            </b>
          </div>
          <div className="text-right">
            <span className="block text-[11px] text-text-muted">실매출</span>
            <b className="mt-0.5 block tabular-nums text-primary">
              {won(sale.netAmount)}
            </b>
          </div>
        </div>
        {(sale.refundAmount > 0 || sale.outstandingAmount > 0) && (
          <p className="mt-2 text-xs text-text-secondary">
            환불 {won(sale.refundAmount)} · 미수 {won(sale.outstandingAmount)}
          </p>
        )}
        <p className="mt-2 text-xs text-text-secondary">
          실제 결제 {won(sale.paidAmount)} · {paymentLabel[sale.paymentMethod] || sale.paymentMethod}
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-muted">
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
      {(editable || admin) && (
        <div
          className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3"
          onClick={stop}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {editable && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-10 flex-1 px-3"
              onClick={onEdit}
            >
              <Pencil size={15} />
              수정
            </Button>
          )}
          {admin && sale.status !== "cancelled" && (
            <>
              <Button
                type="button"
                variant="secondary"
                className="min-h-10 flex-1 px-3"
                disabled={sale.refundAmount >= sale.paidAmount}
                onClick={onRefund}
              >
                환불
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-h-10 flex-1 px-3"
                onClick={onCancel}
              >
                취소
              </Button>
            </>
          )}
          {admin && sale.status === "cancelled" && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-10 flex-1 px-3"
              onClick={onReopen}
            >
              취소 복구
            </Button>
          )}
        </div>
      )}
    </article>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function JsonData({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs text-slate-700">
        {value == null ? "-" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
