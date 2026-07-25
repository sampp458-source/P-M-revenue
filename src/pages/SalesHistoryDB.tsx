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
  logSupabaseError,
  partyMutationError,
} from "../lib/supabaseError";
import {
  calculateTodayActivity,
  calculateSalesSummary,
  businessUnitDisplayOrder,
  filterSales,
  findDuplicateWarnings,
  hasOutstanding,
  isRefundDateAllowed,
  koreanDate,
  normalizePhone,
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
  detailPaymentRows,
  formatQuantityWithUnit,
  refundDetailKinds,
} from "./salesDetailLogic";
import {
  buildSalePartyRpcPayload,
  findCustomerPhoneDuplicate,
  findDogNameDuplicate,
  hasCustomerIdentity,
  normalizeCustomerPhone,
} from "./customerIdentity";

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
  unitLabel: string | null;
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
  const [refundHistory, setRefundHistory] = useState<RefundRow[]>([]);
  const [refundHistoryLoading, setRefundHistoryLoading] = useState(false);
  const [refundHistoryError, setRefundHistoryError] = useState(false);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [partyCustomers, setPartyCustomers] = useState<PartyCustomer[]>([]);
  const [partyDogs, setPartyDogs] = useState<PartyDog[]>([]);
  const [partySearch, setPartySearch] = useState("");
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
  const [reopening, setReopening] = useState<SaleRow | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundDate, setRefundDate] = useState("");
  const [refundReason, setRefundReason] = useState("");
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
    const [
      result,
      profilesResult,
      customersResult,
      paymentsResult,
      productUnitsResult,
      dogsResult,
    ] = await Promise.all([
      loadSaleRows(),
      supabase.rpc("get_staff_history_directory"),
      supabase.from("customers").select("id, name, phone, is_active").order("name"),
      supabase.from("sale_payments").select("sale_id, payment_method, amount").order("created_at"),
      supabase.from("products").select("id, unit_label"),
      supabase.from("dogs").select("id, customer_id, name, breed").eq("is_active", true).order("name"),
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
      if (!paymentsResult.error)
        (paymentsResult.data ?? []).forEach((payment) => {
          const rows = paymentsBySale.get(payment.sale_id) ?? [];
          rows.push({ method: payment.payment_method as SalePaymentRow["method"], amount: payment.amount });
          paymentsBySale.set(payment.sale_id, rows);
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
          unitLabel: productUnits.get(sale.product_id) ?? null,
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
  const visiblePartyCustomers = useMemo(() => {
    const keyword = partySearch.trim().toLocaleLowerCase("ko");
    return partyCustomers.filter(
      (customer) =>
        customer.id === editing?.customerId ||
        !keyword ||
        [customer.name, customer.phone].some((value) =>
          value?.toLocaleLowerCase("ko").includes(keyword),
        ),
    );
  }, [editing?.customerId, partyCustomers, partySearch]);
  const editingPartyDogs = useMemo(
    () =>
      partyDogs.filter(
        (dog) =>
          Boolean(editing?.customerId) && dog.customerId === editing?.customerId,
      ),
    [editing?.customerId, partyDogs],
  );
  const openEditSale = (sale: SaleRow) => {
    setActionError("");
    setPartyError("");
    setPartySearch("");
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
      setPartySearch(`${duplicate.name || "이름 미등록"} ${duplicate.phone || ""}`.trim());
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
    setPartySearch(`${result.data.name || "이름 미등록"} ${result.data.phone || ""}`.trim());
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
      : message.includes("마감된 월")
        ? "마감된 월의 매출은 변경할 수 없습니다."
        : message.includes("환불")
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
        title="매출 내역"
        description="결제, 환불, 취소 및 미수금 현황을 확인합니다."
        action={
          <Button onClick={() => navigate("/sales/new")}>
            <Plus size={17} />
            매출 등록
          </Button>
        }
      />
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
      {period === "today" && (
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
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-[160px_160px_160px_minmax(280px,1fr)_auto]">
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
          <div>
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
          </div>
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
                profileNames={profileNames}
                duplicateWarnings={duplicateWarnings}
                onOpen={showDetail}
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
                  : "현재 조건에 맞는 매출이 없습니다"
              }
              description={
                sales.length === 0
                  ? "첫 매출을 등록하면 날짜와 사업부 기준으로 내역을 확인할 수 있습니다."
                  : query
                  ? `“${query}” 검색어와 현재 필터 조건에 맞는 매출이 없습니다.`
                  : "날짜·사업부 또는 적용된 필터를 조정해 주세요."
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
      <Modal open={!!selected} onClose={closeDetail} title="매출 상세" extraWide>
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
              setCancelling(selected);
            }}
            onReopen={() => {
              closeDetail();
              setActionError("");
              setReopening(selected);
            }}
          />
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
                <div className="space-y-2 sm:col-span-2">
                  <SearchBox aria-label="보호자 이름 또는 연락처 검색" placeholder="보호자 이름 또는 연락처 검색" value={partySearch} disabled={editing.status !== "normal"} onClear={() => setPartySearch("")} onChange={(event) => setPartySearch(event.target.value)} />
                </div>
                <Field label="보호자">
                  <Select value={editing.customerId ?? ""} disabled={partySaving || editing.status !== "normal"} onChange={(event) => { const customerId = event.target.value || null; const currentDog = partyDogs.find((dog) => dog.id === editing.dogId); setEditing({ ...editing, customerId, dogId: currentDog?.customerId === customerId ? editing.dogId : null }); setPartyError(""); }}>
                    <option value="">보호자 미등록</option>
                    {editing.customerId && !partyCustomers.some((customer) => customer.id === editing.customerId) && <option value={editing.customerId}>{editing.customerName || "기존 보호자"} · {editing.customerPhone || "연락처 없음"}</option>}
                    {visiblePartyCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || "이름 미등록"} · {customer.phone || "연락처 미등록"}</option>)}
                  </Select>
                </Field>
                <div className="flex items-end"><Button type="button" variant="secondary" className="w-full" disabled={partySaving || editing.status !== "normal"} onClick={() => { setNewCustomer({ name: partySearch, phone: "" }); setPartyError(""); setPartyModal("customer"); }}><Plus size={16} />새 보호자 등록</Button></div>
                <Field label="반려견">
                  <Select value={editing.dogId ?? ""} disabled={partySaving || editing.status !== "normal" || !editing.customerId} onChange={(event) => setEditing({ ...editing, dogId: event.target.value || null })}>
                    <option value="">(반려견 없음)</option>
                    {editing.dogId && !editingPartyDogs.some((dog) => dog.id === editing.dogId) && <option value={editing.dogId}>{editing.dogName}</option>}
                    {editingPartyDogs.map((dog) => <option key={dog.id} value={dog.id}>{dog.name}{dog.breed ? ` · ${dog.breed}` : ""}</option>)}
                  </Select>
                </Field>
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
  onReopen,
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
  onReopen: () => void;
}) {
  const finalSaleAmount = calculateFinalSaleAmount(
    sale.originalAmount,
    sale.additionalAmount,
    sale.discountAmount,
  );
  const payments = detailPaymentRows(
    sale.paymentRows,
    sale.paymentMethod,
    sale.paidAmount,
  );
  const paymentTotal = payments.reduce((total, row) => total + row.amount, 0);
  const refundKinds = refundDetailKinds(refunds, sale.status);
  const canRefund = admin && sale.status !== "cancelled" && sale.refundAmount < sale.paidAmount;
  const hasActions = editable || admin;
  const customerType = sale.customerType === "new" ? "신규" : sale.customerType === "renewal" ? "재등록" : sale.customerType || "미지정";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-[#172f4d] text-white" aria-labelledby="sale-summary-title">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,1fr)]">
          <div className="min-w-0 p-5 sm:p-6 lg:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={sale.status} />
              {hasOutstanding(sale) && <StatusBadge status="outstanding" />}
            </div>
            <h3 id="sale-summary-title" className="mt-4 break-words text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
              {sale.dogName || "(반려견 없음)"}
            </h3>
            <p className="mt-1 text-sm text-slate-300">
              {sale.customerName?.trim() || "보호자 이름 없음"}
              {sale.customerPhone?.trim() ? ` · ${sale.customerPhone}` : ""}
            </p>
            <dl className="mt-6 grid gap-x-6 gap-y-3 border-t border-white/15 pt-5 text-sm sm:grid-cols-3">
              <DetailHeroText label="사업부" value={sale.businessUnitName} />
              <DetailHeroText label="담당자" value={sale.staffName || "미지정"} />
              <DetailHeroText label="매출일" value={koDate(sale.saleDate)} />
            </dl>
          </div>
          <div className="grid grid-cols-2 border-t border-white/15 bg-white/[0.04] lg:border-l lg:border-t-0">
            <DetailHeroAmount label="최종 판매금액" value={finalSaleAmount} primary />
            <DetailHeroAmount label="결제 완료" value={sale.paidAmount} />
            <DetailHeroAmount label="미수금" value={sale.outstandingAmount} warning={sale.outstandingAmount > 0} />
            <DetailHeroAmount label="환불금액" value={sale.refundAmount} danger={sale.refundAmount > 0} />
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface px-5 sm:px-6">
      <DetailSection title="판매 항목">
        <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <strong className="block break-words text-base text-text-primary">{sale.productName}</strong>
            <span className="mt-1 block text-xs text-text-muted">{sale.categoryName}</span>
          </div>
          <p className="shrink-0 text-base font-semibold text-text-primary tabular-nums">
            {won(sale.unitPrice)} × {formatQuantityWithUnit(sale.quantity, sale.unitLabel)}
          </p>
        </div>
        <dl className="mt-3 space-y-2">
          <DetailAmountRow label="기준금액" value={sale.originalAmount} />
          {sale.additionalAmount > 0 && <DetailAmountRow label="추가금액" value={sale.additionalAmount} />}
          {sale.discountAmount > 0 && <DetailAmountRow label="할인금액" value={-sale.discountAmount} />}
          {sale.additionalAmount === 0 && sale.discountAmount === 0 && (
            <p className="text-xs text-text-muted">추가금액과 할인금액 없음</p>
          )}
          <DetailAmountRow label="최종 판매금액" value={finalSaleAmount} emphasized />
        </dl>
        {sale.adjustmentNote && (
          <p className="mt-3 rounded-xl bg-surface-secondary px-3 py-2.5 text-sm leading-6 text-text-secondary">
            <span className="font-semibold text-text-primary">조정 메모</span> · {sale.adjustmentNote}
          </p>
        )}
      </DetailSection>

      <DetailSection title="결제 내역" description={payments.length > 1 ? "분할결제" : "단일결제"}>
        {payments.length > 0 ? (
          <dl className="divide-y divide-border">
            {payments.map((payment) => (
              <DetailAmountRow
                key={payment.method}
                label={paymentMethodLabels[payment.method]}
                value={payment.amount}
                className="py-3 first:pt-0"
              />
            ))}
            <DetailAmountRow label="결제 합계" value={paymentTotal} emphasized className="pt-3" />
          </dl>
        ) : (
          <p className="text-sm text-text-muted">기록된 결제 내역이 없습니다.</p>
        )}
      </DetailSection>

      <DetailSection title="환불 내역">
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
          <DetailAmountRow label="미수금" value={sale.outstandingAmount} warning={sale.outstandingAmount > 0} />
          <DetailAmountRow label="최종 실매출" value={sale.netAmount} emphasized />
        </dl>
      </DetailSection>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-surface px-5 sm:px-6">
      <DetailSection title="고객·반려견 정보">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <DetailText label="보호자" value={sale.customerName?.trim() || "보호자 이름 없음"} />
          <DetailText label="연락처" value={sale.customerPhone?.trim() || "연락처 없음"} />
          <DetailText label="반려견" value={sale.dogName || "(반려견 없음)"} />
          <DetailText label="고객 구분" value={customerType} />
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
        <section className="rounded-2xl border border-border bg-surface-secondary p-4 sm:flex sm:items-center sm:justify-between sm:gap-6" aria-labelledby="sale-actions-title">
          <div>
            <h3 id="sale-actions-title" className="text-sm font-semibold text-text-primary">거래 관리</h3>
            <p className="mt-1 text-xs text-text-muted">수정·고객 연결·결제 수정은 일반 수정에서 처리합니다.</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 sm:mt-0 sm:justify-end">
            {editable && <Button type="button" variant="secondary" onClick={onEdit}><Pencil size={15} />수정</Button>}
            {canRefund && <Button type="button" className="border-warning/30 bg-warning-soft text-warning hover:bg-warning-soft" variant="secondary" onClick={onRefund}>환불</Button>}
            {admin && sale.status !== "cancelled" && <Button type="button" variant="danger" onClick={onCancel}><Undo2 size={15} />매출 취소</Button>}
            {admin && sale.status === "cancelled" && <Button type="button" variant="secondary" onClick={onReopen}><RotateCcw size={15} />취소 복구</Button>}
          </div>
        </section>
      )}
    </div>
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

function DetailHeroAmount({
  label,
  value,
  primary = false,
  warning = false,
  danger = false,
}: {
  label: string;
  value: number;
  primary?: boolean;
  warning?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-r border-white/10 p-4 last:border-b-0 sm:p-5 lg:[&:nth-child(3)]:border-b-0">
      <dt className="text-xs font-medium text-slate-300">{label}</dt>
      <dd
        className={cn(
          "mt-1 whitespace-nowrap font-bold tabular-nums tracking-[-0.025em]",
          primary ? "text-xl text-white sm:text-2xl" : "text-lg text-slate-100",
          warning && "text-amber-300",
          danger && "text-rose-300",
        )}
      >
        {won(value)}
      </dd>
    </div>
  );
}

function DetailSection({ title, description, compact = false, children }: { title: string; description?: string; compact?: boolean; children: ReactNode }) {
  return (
    <section className={cn("border-t border-border", compact ? "py-5" : "py-6")}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {description && <span className="text-xs font-medium text-text-muted">{description}</span>}
      </div>
      {children}
    </section>
  );
}

function DetailAmountRow({ label, value, emphasized = false, warning = false, className }: { label: string; value: number; emphasized?: boolean; warning?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", emphasized && "border-t border-border pt-3", className)}>
      <dt className={cn("text-sm text-text-secondary", emphasized && "font-semibold text-text-primary")}>{label}</dt>
      <dd className={cn("shrink-0 text-right text-sm font-semibold text-text-primary tabular-nums", emphasized && "text-lg text-primary", warning && "text-warning")}>{won(value)}</dd>
    </div>
  );
}

function DetailText({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-medium text-text-muted">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-text-primary">{value}</dd></div>;
}

function DetailMemo({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-semibold text-text-muted">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary">{value}</p></div>;
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
    <Table className="min-w-[920px]">
      <thead>
        <tr>
          <th>등록일시</th>
          <th>반려견·보호자</th>
          <th>사업부</th>
          <th>상품</th>
          <th data-numeric>최종금액</th>
          <th>결제상태</th>
          <th>담당자</th>
          <th className="text-right">더보기</th>
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
                  <span className="mt-0.5 block text-[11px] text-text-muted">
                    {maskPhone(sale.customerPhone)}
                  </span>
                </div>
                <DuplicateBadge warning={duplicateWarnings.get(sale.id)} />
              </div>
            </td>
            <td>
              <span className="font-medium text-text-primary">{sale.businessUnitName}</span>
            </td>
            <td>
              <span className="block max-w-48 truncate font-medium text-text-primary">
                {sale.productName}
              </span>
              <span className="mt-0.5 block max-w-48 truncate text-xs text-text-muted">
                수량 {sale.quantity}
              </span>
            </td>
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
                실매출 {won(sale.netAmount)}
              </span>
            </td>
            <td>
              <SaleStatusBadges sale={sale} />
              <span className="mt-1 block max-w-36 truncate text-xs text-text-muted">
                {paymentSummary(sale.paymentRows, sale.paymentMethod, sale.paidAmount)}
              </span>
            </td>
            <td>
              <span className="block max-w-28 truncate">{sale.staffName || "-"}</span>
              <span className="mt-0.5 block max-w-28 truncate text-xs text-text-muted">
                등록 {profileNames[sale.createdBy] || sale.registrarName || "-"}
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
          {paymentSummary(sale.paymentRows, sale.paymentMethod, sale.paidAmount)}
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
      <p className="mt-3 border-t border-border pt-3 text-right text-xs font-semibold text-primary">
        상세 보기
      </p>
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
