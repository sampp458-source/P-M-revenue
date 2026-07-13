import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Dog,
  ExternalLink,
  LoaderCircle,
  PackageCheck,
  Plus,
  ReceiptText,
  Settings2,
  UserRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  Button,
  Card,
  ConfirmModal,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  SearchBox,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
  Toast,
  cn,
} from "../components/ui";
import { won } from "../lib/format";
import { formatPhone, isValidPhone, phoneDigits } from "../lib/phone";
import { supabase } from "../lib/supabase";
import {
  buildQuickPartyRpcPayload,
  defaultRepeatSettings,
  duplicateWarningLevel,
  hasProductNameDuplicate,
  missingSaleRequirement,
  nextSaleForm,
  partySearchScore,
  type RepeatSettings,
} from "./saleRegistrationLogic";

interface CustomerOption {
  id: string;
  name: string | null;
  phone: string | null;
}

interface DogOption {
  id: string;
  name: string;
  breed: string | null;
  birthDate: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
}

interface CategoryOption {
  id: string;
  businessUnitId: string;
  name: string;
}

interface ProductOption {
  id: string;
  businessUnitId: string;
  categoryId: string;
  name: string;
  defaultPrice: number;
}

interface QuickProductForm {
  businessUnitId: string;
  categoryId: string;
  name: string;
  defaultPrice: number;
}

interface StaffOption {
  id: string;
  name: string;
}

interface RecentSale {
  id: string;
  saleDate: string;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  dogId: string | null;
  dogName: string | null;
  businessUnitId: string;
  businessUnitName: string;
  productId: string;
  productName: string;
  paidAmount: number;
  netAmount: number;
  status: "normal" | "partial_refund" | "full_refund" | "cancelled";
  staffName: string | null;
  createdBy: string;
}

interface QuickPartyResult {
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  dog_id: string | null;
  dog_name: string | null;
  customer_created: boolean;
}

interface PartySearchResult {
  key: string;
  customerId: string | null;
  dogId: string | null;
  dogName: string | null;
  breed: string | null;
  customerName: string | null;
  customerPhone: string | null;
  dogNames: string[];
  score: number;
  lastSale: RecentSale | null;
}

interface ProductRecommendation {
  product: ProductOption;
  lastUsed: string | null;
  useCount: number;
}

interface SuccessSummary {
  saleId: string;
  customerId: string;
  dogId: string;
  partyName: string;
  productName: string;
  paidAmount: number;
  savedAt: string;
  staffName: string;
}

const lastBusinessUnitKey = "pm-last-sale-business-unit";
const lastStaffKey = "pm-last-sale-staff";
const lastPaymentMethodKey = "pm-last-sale-payment-method";
const lastProductKey = "pm-last-sale-product";
const repeatSettingsKey = "pm-sale-repeat-settings";
const recentSaleFields = "id, sale_date, created_at, customer_id, customer_name, dog_id, dog_name, business_unit_id, business_unit_name, product_id, product_name, paid_amount, net_amount, status, staff_name, created_by";

const stored = (key: string) => typeof window === "undefined" ? "" : localStorage.getItem(key) ?? "";
const loadRepeatSettings = (): RepeatSettings => {
  try {
    return { ...defaultRepeatSettings, ...JSON.parse(stored(repeatSettingsKey)) as Partial<RepeatSettings> };
  } catch {
    return defaultRepeatSettings;
  }
};
const emptyQuickForm = () => ({ customerName: "", phone: "", dogName: "", breed: "" });
const emptyQuickProductForm = (): QuickProductForm => ({ businessUnitId: "", categoryId: "", name: "", defaultPrice: 0 });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");
const moneyText = (value: number) => Math.max(0, Math.trunc(value || 0)).toLocaleString("ko-KR");
const maskedPhone = (phone: string | null) => {
  const digits = phoneDigits(phone ?? "");
  return digits.length === 11 ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : phone || "연락처 미등록";
};
const dogAge = (birthDate: string | null) => {
  if (!birthDate) return "나이 미등록";
  const birth = new Date(`${birthDate}T00:00:00`);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? `${age}세` : "나이 미등록";
};
const recentTime = (date: string) => {
  const value = new Date(date);
  const now = new Date();
  return value.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) === now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
    ? `오늘 ${value.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" })}`
    : value.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
};
const paymentLabel: Record<string, string> = { card: "카드", transfer: "계좌이체", cash: "현금", outstanding: "미수" };

function HighlightedText({ text, query }: { text: string; query: string }) {
  const keyword = query.trim();
  if (!keyword) return <>{text}</>;
  const index = text.toLocaleLowerCase("ko").indexOf(keyword.toLocaleLowerCase("ko"));
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark className="rounded bg-warning-soft px-0.5 text-inherit">{text.slice(index, index + keyword.length)}</mark>{text.slice(index + keyword.length)}</>;
}
const mapRecentSale = (row: Record<string, unknown>): RecentSale => ({
  id: String(row.id), saleDate: String(row.sale_date), createdAt: String(row.created_at),
  customerId: row.customer_id ? String(row.customer_id) : null, customerName: row.customer_name ? String(row.customer_name) : null,
  dogId: row.dog_id ? String(row.dog_id) : null, dogName: row.dog_name ? String(row.dog_name) : null,
  businessUnitId: String(row.business_unit_id), businessUnitName: String(row.business_unit_name),
  productId: String(row.product_id), productName: String(row.product_name), paidAmount: Number(row.paid_amount ?? 0),
  netAmount: Number(row.net_amount ?? 0), status: row.status as RecentSale["status"], staffName: row.staff_name ? String(row.staff_name) : null,
  createdBy: String(row.created_by ?? ""),
});

function CurrencyInput({ name, value, disabled, max, onValue }: { name?: string; value: number; disabled?: boolean; max?: number; onValue: (value: number) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.currentTarget.value;
    const cursor = event.currentTarget.selectionStart ?? raw.length;
    const digitsOnRight = digitsOnly(raw.slice(cursor)).length;
    const next = Math.min(Number(digitsOnly(raw) || 0), max ?? Number.MAX_SAFE_INTEGER);
    onValue(next);
    requestAnimationFrame(() => {
      const input = ref.current;
      if (!input) return;
      let position = input.value.length;
      let remaining = digitsOnRight;
      while (position > 0 && remaining > 0) {
        position -= 1;
        if (/\d/.test(input.value[position])) remaining -= 1;
      }
      input.setSelectionRange(position, position);
    });
  };
  return <Input ref={ref} name={name} type="text" inputMode="numeric" autoComplete="off" value={moneyText(value)} disabled={disabled} onChange={change} className="text-right font-semibold tabular-nums" />;
}

export function SaleFormPage() {
  const { businessUnits, profile } = useAuth();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const quickPhoneRef = useRef<HTMLInputElement>(null);
  const productSectionRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const quickSavingRef = useRef(false);
  const quickProductSavingRef = useRef(false);
  const [repeatSettings, setRepeatSettings] = useState(loadRepeatSettings);
  const repeatSettingsRef = useRef(repeatSettings);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [dogs, setDogs] = useState<DogOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [highlightedResult, setHighlightedResult] = useState(0);
  const [recentSelections, setRecentSelections] = useState<PartySearchResult[]>([]);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [mobileInputActive, setMobileInputActive] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [quickAddingToExisting, setQuickAddingToExisting] = useState(false);
  const [quickForm, setQuickForm] = useState(emptyQuickForm);
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProductSaving, setQuickProductSaving] = useState(false);
  const [quickProductError, setQuickProductError] = useState("");
  const [quickProductForm, setQuickProductForm] = useState<QuickProductForm>(emptyQuickProductForm);
  const [duplicateWarning, setDuplicateWarning] = useState<{ sale: RecentSale; level: "strong" | "weak" } | null>(null);
  const [successSummary, setSuccessSummary] = useState<SuccessSummary | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [form, setForm] = useState({
    saleDate: today(), businessUnitId: loadRepeatSettings().keepBusinessUnit ? stored(lastBusinessUnitKey) : "", customerId: "", dogId: "", categoryId: "", productId: "",
    originalAmount: 0, discountAmount: 0, paidAmount: 0, refundAmount: 0, outstandingAmount: 0,
    paymentMethod: loadRepeatSettings().keepPaymentMethod ? stored(lastPaymentMethodKey) || "card" : "card", customerType: "new", staffId: loadRepeatSettings().keepStaff ? stored(lastStaffKey) || profile?.id || "" : profile?.id || "", memo: "",
  });

  const loadOptions = useCallback(async () => {
    setLoading(true); setLoadError("");
    const [customersResult, dogsResult, categoriesResult, productsResult, staffResult, salesResult] = await Promise.all([
      supabase.from("customers").select("id, name, phone").eq("is_active", true).order("name"),
      supabase.from("dogs").select("id, name, breed, birth_date, customer_id, customers(name, phone)").eq("is_active", true).order("name"),
      supabase.from("product_categories").select("id, business_unit_id, name").eq("is_active", true).order("sort_order").order("name"),
      supabase.from("products").select("id, business_unit_id, category_id, name, default_price").eq("is_active", true).order("sort_order").order("name"),
      supabase.rpc("get_active_staff_directory"),
      supabase.from("sales").select(recentSaleFields).order("created_at", { ascending: false }).limit(100),
    ]);
    if (customersResult.error || dogsResult.error || categoriesResult.error || productsResult.error || staffResult.error || salesResult.error) {
      setLoadError("매출 등록에 필요한 정보를 불러오지 못했습니다."); setLoading(false); return;
    }
    setCustomers(customersResult.data ?? []);
    setDogs((dogsResult.data ?? []).map((dog) => {
      const customer = Array.isArray(dog.customers) ? dog.customers[0] : dog.customers;
      return { id: dog.id, name: dog.name, breed: dog.breed, birthDate: dog.birth_date, customerId: dog.customer_id, customerName: customer?.name ?? null, customerPhone: customer?.phone ?? null };
    }));
    setCategories((categoriesResult.data ?? []).map((item) => ({ id: item.id, businessUnitId: item.business_unit_id, name: item.name })));
    const productRows = (productsResult.data ?? []).map((item) => ({ id: item.id, businessUnitId: item.business_unit_id, categoryId: item.category_id, name: item.name, defaultPrice: item.default_price }));
    setProducts(productRows);
    const staffRows: StaffOption[] = ((staffResult.data ?? []) as { id: string; name: string }[]).map((item) => ({ id: item.id, name: item.name }));
    setStaff(staffRows);
    setRecentSales((salesResult.data ?? []).map((row) => mapRecentSale(row as Record<string, unknown>)));
    setForm((current) => {
      const savedProduct = repeatSettingsRef.current.keepProduct ? productRows.find((item) => item.id === stored(lastProductKey)) : undefined;
      return {
        ...current,
        businessUnitId: savedProduct?.businessUnitId ?? (repeatSettingsRef.current.keepBusinessUnit && businessUnits.some((unit) => unit.id === current.businessUnitId) ? current.businessUnitId : ""),
        categoryId: savedProduct?.categoryId ?? current.categoryId,
        productId: savedProduct?.id ?? current.productId,
        originalAmount: savedProduct?.defaultPrice ?? current.originalAmount,
        paidAmount: savedProduct?.defaultPrice ?? current.paidAmount,
        staffId: repeatSettingsRef.current.keepStaff && staffRows.some((item) => item.id === current.staffId) ? current.staffId : profile?.id ?? staffRows[0]?.id ?? "",
      };
    });
    setLoading(false);
  }, [businessUnits, profile?.id]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => { repeatSettingsRef.current = repeatSettings; localStorage.setItem(repeatSettingsKey, JSON.stringify(repeatSettings)); }, [repeatSettings]);
  useEffect(() => {
    if (!search.trim()) { setDebouncedSearch(""); setSearchLoading(false); setHighlightedResult(0); return; }
    setSearchLoading(true);
    const timer = window.setTimeout(() => { setDebouncedSearch(search); setSearchLoading(false); setHighlightedResult(0); }, 140);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { if (repeatSettings.keepBusinessUnit && form.businessUnitId) localStorage.setItem(lastBusinessUnitKey, form.businessUnitId); else if (!repeatSettings.keepBusinessUnit) localStorage.removeItem(lastBusinessUnitKey); }, [form.businessUnitId, repeatSettings.keepBusinessUnit]);
  useEffect(() => { if (repeatSettings.keepStaff && form.staffId) localStorage.setItem(lastStaffKey, form.staffId); else if (!repeatSettings.keepStaff) localStorage.removeItem(lastStaffKey); }, [form.staffId, repeatSettings.keepStaff]);
  useEffect(() => { if (repeatSettings.keepPaymentMethod) localStorage.setItem(lastPaymentMethodKey, form.paymentMethod); else localStorage.removeItem(lastPaymentMethodKey); }, [form.paymentMethod, repeatSettings.keepPaymentMethod]);
  useEffect(() => { if (repeatSettings.keepProduct && form.productId) localStorage.setItem(lastProductKey, form.productId); else localStorage.removeItem(lastProductKey); }, [form.productId, repeatSettings.keepProduct]);

  const selectedDog = dogs.find((dog) => dog.id === form.dogId);
  const selectedCustomer = customers.find((customer) => customer.id === form.customerId);
  const selectableDogs = form.customerId ? dogs.filter((dog) => dog.customerId === form.customerId) : [];
  const filteredCategories = categories.filter((item) => item.businessUnitId === form.businessUnitId);
  const filteredProducts = products.filter((item) => item.businessUnitId === form.businessUnitId && item.categoryId === form.categoryId);
  const expectedAmount = Math.max(form.originalAmount - form.discountAmount, 0);
  const netAmount = form.paidAmount - form.refundAmount;

  const recentPartyKeys = useMemo(() => {
    const result = new Map<string, number>();
    recentSales.forEach((sale, index) => {
      const key = sale.customerId ? `customer:${sale.customerId}` : sale.dogId ? `dog:${sale.dogId}` : "";
      if (key && !result.has(key)) result.set(key, index);
    });
    return result;
  }, [recentSales]);

  const searchResults = useMemo<PartySearchResult[]>(() => {
    const query = debouncedSearch.trim().toLocaleLowerCase("ko");
    const phoneQuery = phoneDigits(debouncedSearch);
    if (!query) return [];
    const results: PartySearchResult[] = [];
    const dogsByCustomer = new Map<string, DogOption[]>();
    dogs.forEach((dog) => { if (dog.customerId) dogsByCustomer.set(dog.customerId, [...(dogsByCustomer.get(dog.customerId) ?? []), dog]); });
    dogs.forEach((dog) => {
      const dogName = dog.name.toLocaleLowerCase("ko");
      const customerName = (dog.customerName ?? "").toLocaleLowerCase("ko");
      const phone = phoneDigits(dog.customerPhone ?? "");
      const score = partySearchScore({ query, phoneQuery, dogName, customerName, phone });
      if (score < 99) results.push({ key: `dog:${dog.id}`, customerId: dog.customerId, dogId: dog.id, dogName: dog.name, breed: dog.breed, customerName: dog.customerName, customerPhone: dog.customerPhone, dogNames: dog.customerId ? (dogsByCustomer.get(dog.customerId) ?? []).map((item) => item.name) : [dog.name], score, lastSale: recentSales.find((sale) => sale.dogId === dog.id || Boolean(dog.customerId && sale.customerId === dog.customerId)) ?? null });
    });
    customers.forEach((customer) => {
      const customerDogs = dogsByCustomer.get(customer.id) ?? [];
      if (customerDogs.length && results.some((result) => result.customerId === customer.id)) return;
      const name = (customer.name ?? "").toLocaleLowerCase("ko");
      const phone = phoneDigits(customer.phone ?? "");
      const score = partySearchScore({ query, phoneQuery, dogName: "", customerName: name, phone });
      if (score < 99) results.push({ key: `customer:${customer.id}`, customerId: customer.id, dogId: null, dogName: null, breed: null, customerName: customer.name, customerPhone: customer.phone, dogNames: customerDogs.map((item) => item.name), score, lastSale: recentSales.find((sale) => sale.customerId === customer.id) ?? null });
    });
    return results.sort((a, b) => a.score - b.score || (recentPartyKeys.get(a.customerId ? `customer:${a.customerId}` : a.key) ?? 999) - (recentPartyKeys.get(b.customerId ? `customer:${b.customerId}` : b.key) ?? 999) || (a.dogName ?? a.customerName ?? "").localeCompare(b.dogName ?? b.customerName ?? "", "ko")).slice(0, 8);
  }, [customers, debouncedSearch, dogs, recentPartyKeys, recentSales]);

  const recentParties = useMemo<PartySearchResult[]>(() => {
    const seen = new Set<string>();
    const orderedSales = [...recentSales.filter((sale) => sale.createdBy === profile?.id), ...recentSales.filter((sale) => sale.createdBy !== profile?.id)];
    const fromSales = orderedSales.flatMap((sale) => {
      const key = sale.customerId ? `customer:${sale.customerId}` : sale.dogId ? `dog:${sale.dogId}` : "";
      if (!key || seen.has(key)) return [];
      seen.add(key);
      const dog = dogs.find((item) => item.id === sale.dogId);
      const customer = customers.find((item) => item.id === sale.customerId);
      return [{ key, customerId: sale.customerId, dogId: sale.dogId, dogName: dog?.name ?? sale.dogName, breed: dog?.breed ?? null, customerName: customer?.name ?? sale.customerName, customerPhone: customer?.phone ?? dog?.customerPhone ?? null, dogNames: sale.customerId ? dogs.filter((item) => item.customerId === sale.customerId).map((item) => item.name) : sale.dogName ? [sale.dogName] : [], score: 7, lastSale: sale }];
    });
    const fromSelections = recentSelections.filter((party) => !seen.has(party.key));
    return [...fromSales, ...fromSelections].slice(0, 6);
  }, [customers, dogs, profile?.id, recentSales, recentSelections]);

  const selectedPartySales = useMemo(() => recentSales.filter((sale) => form.customerId ? sale.customerId === form.customerId : form.dogId ? sale.dogId === form.dogId : false), [form.customerId, form.dogId, recentSales]);
  const selectedRecentSales = selectedPartySales.slice(0, 5);
  const recommendationGroups = useMemo(() => {
    const toRecommendations = (sales: RecentSale[], excluded = new Set<string>(), limit = 4): ProductRecommendation[] => {
      const stats = new Map<string, { count: number; lastUsed: string }>();
      sales.forEach((sale) => {
        if (excluded.has(sale.productId)) return;
        const current = stats.get(sale.productId);
        stats.set(sale.productId, { count: (current?.count ?? 0) + 1, lastUsed: current?.lastUsed ?? sale.saleDate });
      });
      return [...stats.entries()].map(([productId, stat]) => ({ product: products.find((product) => product.id === productId), ...stat }))
        .filter((item): item is { product: ProductOption; count: number; lastUsed: string } => Boolean(item.product))
        .sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed))
        .slice(0, limit).map((item) => ({ product: item.product, useCount: item.count, lastUsed: item.lastUsed }));
    };
    const recent: ProductRecommendation[] = [];
    const recentIds = new Set<string>();
    selectedPartySales.forEach((sale) => {
      if (recent.length >= 4 || recentIds.has(sale.productId)) return;
      const product = products.find((item) => item.id === sale.productId);
      if (product) { recentIds.add(product.id); recent.push({ product, lastUsed: sale.saleDate, useCount: selectedPartySales.filter((item) => item.productId === product.id).length }); }
    });
    const frequent = toRecommendations(selectedPartySales, recentIds);
    const usedIds = new Set([...recentIds, ...frequent.map((item) => item.product.id)]);
    const popularSource = recentSales.filter((sale) => !form.businessUnitId || sale.businessUnitId === form.businessUnitId);
    const popular = toRecommendations(popularSource, usedIds);
    return { recent, frequent, popular };
  }, [form.businessUnitId, products, recentSales, selectedPartySales]);
  const productSearchResults = useMemo(() => {
    const keyword = productQuery.trim().toLocaleLowerCase("ko");
    if (!keyword) return [];
    return products.filter((product) => product.name.toLocaleLowerCase("ko").includes(keyword)).slice(0, 8);
  }, [productQuery, products]);
  const latestSelectedSale = selectedRecentSales[0] ?? null;
  const missingRequirement = missingSaleRequirement({ hasParty: Boolean(form.customerId || form.dogId), businessUnitId: form.businessUnitId, productId: form.productId, paidAmount: form.paidAmount, staffId: form.staffId });
  const canSave = !missingRequirement && !saving;
  const duplicateCustomer = useMemo(() => {
    const normalized = phoneDigits(quickForm.phone);
    return normalized.length === 11 ? customers.find((customer) => phoneDigits(customer.phone ?? "") === normalized) ?? null : null;
  }, [customers, quickForm.phone]);

  const selectProduct = (product: ProductOption) => {
    if (form.productId === product.id) {
      setForm((current) => ({ ...current, productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0, refundAmount: 0, outstandingAmount: 0 }));
      return;
    }
    setForm((current) => ({ ...current, businessUnitId: product.businessUnitId, categoryId: product.categoryId, productId: product.id, originalAmount: product.defaultPrice, discountAmount: 0, paidAmount: product.defaultPrice, refundAmount: 0, outstandingAmount: 0 }));
    setProductQuery("");
    setError("");
    requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('select[name="paymentMethod"]')?.focus());
  };

  const updateRepeatSetting = (key: keyof RepeatSettings, checked: boolean) => {
    setRepeatSettings((current) => ({ ...current, [key]: checked, ...(key === "keepProduct" && checked ? { keepBusinessUnit: true } : {}) }));
  };

  const selectParty = (customerId: string | null, dogId: string | null = null) => {
    const customerDogs = customerId ? dogs.filter((dog) => dog.customerId === customerId) : [];
    const nextDogId = dogId ?? (customerDogs.length === 1 ? customerDogs[0].id : "");
    const dog = dogs.find((item) => item.id === nextDogId);
    const customer = customers.find((item) => item.id === customerId);
    const key = customerId ? `customer:${customerId}` : nextDogId ? `dog:${nextDogId}` : "";
    if (key) {
      const party: PartySearchResult = { key, customerId, dogId: nextDogId || null, dogName: dog?.name ?? null, breed: dog?.breed ?? null, customerName: customer?.name ?? dog?.customerName ?? null, customerPhone: customer?.phone ?? dog?.customerPhone ?? null, dogNames: customerDogs.map((item) => item.name), score: 7, lastSale: recentSales.find((sale) => customerId ? sale.customerId === customerId : sale.dogId === nextDogId) ?? null };
      setRecentSelections((current) => [party, ...current.filter((item) => item.key !== key)].slice(0, 6));
    }
    setForm((current) => ({ ...current, customerId: customerId ?? "", dogId: nextDogId ?? "" }));
    setSearch(""); setSearchFocused(false); setTimelineExpanded(false); setError("");
    searchRef.current?.blur();
    requestAnimationFrame(() => productSectionRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
  };

  const clearParty = () => {
    setForm((current) => ({ ...current, customerId: "", dogId: "", ...(!repeatSettings.keepProduct ? { categoryId: "", productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0, refundAmount: 0, outstandingAmount: 0 } : {}) }));
    setSearch(""); setTimelineExpanded(false); requestAnimationFrame(() => searchRef.current?.focus());
  };

  const resetAfterSave = () => {
    const defaultPrice = products.find((product) => product.id === form.productId)?.defaultPrice ?? null;
    setForm((current) => nextSaleForm(current, repeatSettings, { today: today(), defaultStaffId: profile?.id ?? "", productDefaultPrice: defaultPrice }));
    setAdvancedOpen(false); setError(""); setSearch("");
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const resetForSameParty = () => {
    setForm((current) => ({ ...current, categoryId: "", productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0, refundAmount: 0, outstandingAmount: 0, memo: "" }));
    setAdvancedOpen(false); setError(""); setSuccessSummary(null);
    requestAnimationFrame(() => productSectionRef.current?.scrollIntoView({ behavior: "auto", block: "start" }));
  };

  const resetForNewParty = () => {
    setForm((current) => nextSaleForm(current, { ...repeatSettings, keepProduct: false }, { today: today(), defaultStaffId: profile?.id ?? "", productDefaultPrice: null }));
    setAdvancedOpen(false); setError(""); setSearch(""); setSuccessSummary(null);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const resetAll = () => {
    setForm((current) => ({ saleDate: today(), businessUnitId: current.businessUnitId, customerId: "", dogId: "", categoryId: "", productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0, refundAmount: 0, outstandingAmount: 0, paymentMethod: "card", customerType: "new", staffId: current.staffId, memo: "" }));
    setAdvancedOpen(false); setError(""); setSearch(""); requestAnimationFrame(() => searchRef.current?.focus());
  };

  const hasDraft = Boolean(form.customerId || form.dogId || form.productId || form.memo.trim() || form.discountAmount || form.outstandingAmount);
  const requestNavigation = (path: string) => {
    if (hasDraft) setPendingNavigation(path);
    else navigate(path);
  };

  const validate = (formElement: HTMLFormElement) => {
    const focus = (name: string) => requestAnimationFrame(() => { const field = formElement.elements.namedItem(name); if (field instanceof HTMLElement) field.focus(); });
    if (!form.saleDate || !form.businessUnitId || (!form.customerId && !form.dogId) || !form.categoryId || !form.productId || !form.staffId) {
      setError("필수 항목을 모두 입력해 주세요.");
      if (!form.customerId && !form.dogId) requestAnimationFrame(() => searchRef.current?.focus());
      else focus(!form.businessUnitId ? "businessUnitId" : !form.categoryId ? "categoryId" : !form.productId ? "productId" : !form.saleDate ? "saleDate" : "staffId");
      return false;
    }
    const selectedCategory = categories.find((item) => item.id === form.categoryId);
    const selectedProduct = products.find((item) => item.id === form.productId);
    if (selectedCategory?.businessUnitId !== form.businessUnitId || selectedProduct?.businessUnitId !== form.businessUnitId || selectedProduct?.categoryId !== form.categoryId) { setError("사업부, 상품 분류와 상품의 연결 정보를 확인해 주세요."); return false; }
    if ([form.originalAmount, form.discountAmount, form.paidAmount, form.refundAmount, form.outstandingAmount].some((amount) => !Number.isFinite(amount) || amount < 0)) { setError("금액은 0원 이상으로 입력해 주세요."); focus("originalAmount"); return false; }
    if (form.discountAmount > form.originalAmount) { setError("할인 금액은 정상 판매가를 초과할 수 없습니다."); setAdvancedOpen(true); focus("discountAmount"); return false; }
    if (form.refundAmount > form.paidAmount) { setError("환불 금액은 실제 결제 금액을 초과할 수 없습니다."); setAdvancedOpen(true); focus("refundAmount"); return false; }
    if (form.paidAmount + form.outstandingAmount > expectedAmount) { setError("결제 금액과 미수금의 합계는 할인 후 결제 예정액을 초과할 수 없습니다."); setAdvancedOpen(true); focus("outstandingAmount"); return false; }
    return true;
  };

  const persistSale = async () => {
    const customerId = (selectedDog?.customerId ?? form.customerId) || null;
    const result = await supabase.from("sales").insert({
      sale_date: form.saleDate, business_unit_id: form.businessUnitId, dog_id: form.dogId || null, customer_id: customerId,
      product_category_id: form.categoryId, product_id: form.productId, original_amount: Math.trunc(form.originalAmount),
      discount_amount: Math.trunc(form.discountAmount), paid_amount: Math.trunc(form.paidAmount), refund_amount: Math.trunc(form.refundAmount),
      outstanding_amount: Math.trunc(form.outstandingAmount), net_amount: Math.trunc(netAmount), payment_method: form.paymentMethod,
      customer_type: form.customerType, staff_id: form.staffId, memo: form.memo.trim() || null, status: "normal",
      business_unit_name: "", dog_name: selectedDog?.name ?? null, customer_name: selectedDog?.customerName ?? selectedCustomer?.name ?? null,
      product_category_name: "", product_name: "",
    }).select(recentSaleFields).single();
    savingRef.current = false; setSaving(false);
    if (result.error) {
      setError(result.error.code === "42501" ? "권한이 없습니다." : result.error.message.includes("마감된 월") ? "마감된 월에는 매출을 등록할 수 없습니다." : result.error.code === "23503" || result.error.code === "23514" ? "입력한 금액 또는 선택 항목을 다시 확인해 주세요." : `매출 저장 실패: ${result.error.message}`);
      return;
    }
    const savedSale = mapRecentSale(result.data as Record<string, unknown>);
    setRecentSales((current) => [savedSale, ...current].slice(0, 100));
    const savedParty = selectedDog?.name || selectedCustomer?.name || "보호자 지정 매출";
    const savedProduct = products.find((product) => product.id === form.productId)?.name || "상품";
    setSuccessSummary({ saleId: savedSale.id, customerId: form.customerId, dogId: form.dogId, partyName: savedParty, productName: savedProduct, paidAmount: form.paidAmount, savedAt: savedSale.createdAt, staffName: staff.find((item) => item.id === form.staffId)?.name ?? profile?.name ?? "담당자 미등록" });
  };

  const findDuplicate = async () => {
    const partyFilter = form.customerId ? `customer_id.eq.${form.customerId}` : `dog_id.eq.${form.dogId}`;
    const duplicateResult = await supabase.from("sales").select(recentSaleFields)
      .eq("product_id", form.productId).eq("sale_date", today()).neq("status", "cancelled")
      .or(partyFilter).order("created_at", { ascending: false }).limit(10);
    if (duplicateResult.error) return { error: duplicateResult.error.message, warning: null };
    const candidates = (duplicateResult.data ?? []).map((row) => mapRecentSale(row as Record<string, unknown>));
    const currentDuplicate = { now: Date.now(), today: today(), businessUnitId: form.businessUnitId, paidAmount: Math.trunc(form.paidAmount) };
    const strong = candidates.find((sale) => duplicateWarningLevel(sale, currentDuplicate) === "strong");
    const weak = candidates.find((sale) => duplicateWarningLevel(sale, currentDuplicate) === "weak");
    return { error: null, warning: strong || weak ? { sale: strong ?? weak!, level: strong ? "strong" as const : "weak" as const } : null };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (savingRef.current) return;
    setError("");
    if (!validate(event.currentTarget)) return;
    savingRef.current = true; setSaving(true);
    const duplicate = await findDuplicate();
    if (duplicate.error) { savingRef.current = false; setSaving(false); setError(`중복 매출 확인 실패: ${duplicate.error}`); return; }
    if (duplicate.warning) { savingRef.current = false; setSaving(false); setDuplicateWarning(duplicate.warning); return; }
    await persistSale();
  };

  const confirmDuplicate = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    const recheck = await findDuplicate();
    if (recheck.error) { savingRef.current = false; setSaving(false); setDuplicateWarning(null); setError(`중복 매출 재확인 실패: ${recheck.error}`); return; }
    setDuplicateWarning(null);
    await persistSale();
  };

  const openQuickRegistration = (customer?: CustomerOption) => {
    setQuickForm({ ...emptyQuickForm(), customerName: customer?.name ?? "", phone: formatPhone(customer?.phone ?? "") });
    setQuickError(""); setQuickAddingToExisting(Boolean(customer)); setQuickOpen(true);
  };

  const submitQuickRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (quickSavingRef.current) return;
    const customerName = quickForm.customerName.trim(); const dogName = quickForm.dogName.trim();
    if (!customerName || !quickForm.phone || !dogName) { setQuickError("반려견 이름, 보호자 이름과 연락처를 입력해 주세요."); return; }
    if (!isValidPhone(quickForm.phone)) { setQuickError("연락처는 010으로 시작하는 11자리 번호로 입력해 주세요."); requestAnimationFrame(() => quickPhoneRef.current?.focus()); return; }
    if (duplicateCustomer && !quickAddingToExisting) { setQuickError("동일 연락처의 기존 보호자를 선택하거나 새 반려견 추가를 선택해 주세요."); return; }
    quickSavingRef.current = true; setQuickSaving(true); setQuickError("");
    const result = await supabase.rpc("quick_register_sale_party", buildQuickPartyRpcPayload({
      customerName,
      phone: quickForm.phone,
      dogName,
      breed: quickForm.breed,
    }));
    quickSavingRef.current = false; setQuickSaving(false);
    if (result.error) { setQuickError(result.error.code === "42501" ? "권한이 없습니다." : result.error.message); return; }
    const first = ((result.data ?? []) as QuickPartyResult[])[0];
    if (!first) { setQuickError("간편 등록 결과를 확인할 수 없습니다."); return; }
    setCustomers((current) => current.some((item) => item.id === first.customer_id) ? current : [...current, { id: first.customer_id, name: first.customer_name, phone: first.customer_phone }].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko")));
    if (first.dog_id && first.dog_name) setDogs((current) => current.some((dog) => dog.id === first.dog_id) ? current : [...current, { id: first.dog_id!, name: first.dog_name!, breed: quickForm.breed.trim() || null, birthDate: null, customerId: first.customer_id, customerName: first.customer_name, customerPhone: first.customer_phone }].sort((a, b) => a.name.localeCompare(b.name, "ko")));
    setForm((current) => ({ ...current, customerId: first.customer_id, dogId: first.dog_id ?? "" }));
    setQuickOpen(false); setSearch("");
    setNotice(first.customer_created ? "신규 보호자와 반려견을 등록하고 선택했습니다." : "기존 보호자에게 반려견을 연결하고 선택했습니다.");
  };

  const openQuickProductRegistration = () => {
    setQuickProductError("");
    setQuickProductForm({
      businessUnitId: form.businessUnitId,
      categoryId: form.categoryId,
      name: productQuery.trim(),
      defaultPrice: 0,
    });
    setQuickProductOpen(true);
  };

  const submitQuickProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (quickProductSavingRef.current) return;
    const formElement = event.currentTarget;
    const focus = (name: string) => requestAnimationFrame(() => {
      const field = formElement.elements.namedItem(name);
      if (field instanceof HTMLElement) field.focus();
    });
    const unit = businessUnits.find((item) => item.id === quickProductForm.businessUnitId);
    const category = categories.find((item) => item.id === quickProductForm.categoryId);
    const name = quickProductForm.name.trim();
    if (!unit) { setQuickProductError("사업부를 선택해 주세요."); focus("quickProductBusinessUnitId"); return; }
    if (!category || category.businessUnitId !== unit.id) { setQuickProductError("해당 사업부의 상품 분류를 선택해 주세요."); focus("quickProductCategoryId"); return; }
    if (!name) { setQuickProductError("상품명을 입력해 주세요."); focus("quickProductName"); return; }
    if (!Number.isFinite(quickProductForm.defaultPrice) || quickProductForm.defaultPrice < 0) { setQuickProductError("기본 판매가는 0원 이상으로 입력해 주세요."); focus("quickProductDefaultPrice"); return; }
    if (hasProductNameDuplicate(products, unit.id, name)) { setQuickProductError("같은 사업부에 동일하거나 공백만 다른 상품명이 이미 존재합니다. 기존 상품을 선택해 주세요."); focus("quickProductName"); return; }

    quickProductSavingRef.current = true; setQuickProductSaving(true); setQuickProductError("");
    const result = await supabase.from("products").insert({
      business_unit_id: unit.id,
      category_id: category.id,
      name,
      default_price: Math.trunc(quickProductForm.defaultPrice),
      sort_order: products.length + 1,
      is_active: true,
      memo: null,
    }).select("id, business_unit_id, category_id, name, default_price").single();
    quickProductSavingRef.current = false; setQuickProductSaving(false);
    if (result.error) {
      setQuickProductError(result.error.code === "23505"
        ? "같은 사업부에 동일한 상품명이 이미 존재합니다. 기존 상품을 선택해 주세요."
        : result.error.code === "42501"
          ? "상품 등록 권한이 없습니다. 직원 상품 등록 정책 적용 여부를 확인해 주세요."
          : "상품을 등록하지 못했습니다. 잠시 후 다시 시도하세요.");
      return;
    }
    const created: ProductOption = {
      id: result.data.id,
      businessUnitId: result.data.business_unit_id,
      categoryId: result.data.category_id,
      name: result.data.name,
      defaultPrice: result.data.default_price,
    };
    setProducts((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name, "ko")));
    selectProduct(created);
    setQuickProductOpen(false);
    setNotice("새 상품을 등록하고 선택했습니다.");
  };

  const renderProductGroup = (title: string, description: string, items: ProductRecommendation[]) => items.length ? <section className="space-y-2" aria-label={title}>
    <div><h3 className="text-sm font-semibold text-text-primary">{title}</h3><p className="mt-0.5 text-xs text-text-muted">{description}</p></div>
    <div className="flex snap-x gap-2 overflow-x-auto pb-2">
      {items.map(({ product, lastUsed, useCount }) => <button key={product.id} type="button" aria-pressed={form.productId === product.id} onClick={() => selectProduct(product)} className={cn("min-h-24 min-w-48 snap-start rounded-2xl border p-3.5 text-left transition duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2", form.productId === product.id ? "border-primary bg-primary text-white shadow-sm" : "border-border bg-surface hover:border-primary/30 hover:bg-primary-subtle")}>
        <strong className="block truncate text-sm">{product.name}</strong>
        <span className={cn("mt-2 block text-base font-bold tabular-nums", form.productId === product.id ? "text-white" : "text-text-primary")}>{won(product.defaultPrice)}</span>
        <span className={cn("mt-1 block truncate text-xs", form.productId === product.id ? "text-blue-100" : "text-text-muted")}>{businessUnits.find((unit) => unit.id === product.businessUnitId)?.name || "사업부"}{lastUsed ? ` · ${lastUsed}` : useCount ? ` · ${useCount}회` : ""}</span>
      </button>)}
    </div>
  </section> : null;

  if (loading) return <><PageHeader title="매출 등록" description="고객 선택부터 결제까지 한 화면에서 빠르게 등록합니다." /><Card><LoadingState /></Card></>;
  if (loadError) return <><PageHeader title="매출 등록" description="고객 선택부터 결제까지 한 화면에서 빠르게 등록합니다." /><Card><ErrorState title={loadError} retry={() => void loadOptions()} /></Card></>;

  return <>
    <PageHeader title="매출 등록" description="고객과 상품을 선택하면 결제 정보가 자동으로 준비됩니다." />
    <form onSubmit={submit} className="mx-auto max-w-6xl pb-28 lg:pb-4" aria-describedby={error ? "sale-form-error" : undefined} onFocusCapture={(event) => setMobileInputActive(event.target instanceof HTMLElement && event.target.matches("input, select, textarea"))} onBlurCapture={(event) => { const formElement = event.currentTarget; window.setTimeout(() => setMobileInputActive(Boolean(formElement.contains(document.activeElement) && document.activeElement instanceof HTMLElement && document.activeElement.matches("input, select, textarea"))), 0); }}>
      <Card className="relative z-20 p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-primary">1 · 고객 선택</p><h2 className="mt-1 text-lg font-semibold text-text-primary">고객·반려견</h2></div>{(form.customerId || form.dogId) && <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success"><CheckCircle2 size={16} />선택 완료</span>}</div>
        {!form.customerId && !form.dogId ? <>
          <div className="relative">
            <SearchBox inputRef={searchRef} aria-label="고객과 반려견 검색" value={search} role="combobox" aria-autocomplete="list" aria-expanded={searchFocused && Boolean(search.trim())} aria-controls="sale-party-search-results" aria-activedescendant={searchResults[highlightedResult] ? `sale-party-${searchResults[highlightedResult].key.replace(":", "-")}` : undefined} placeholder="반려견 이름, 보호자 이름 또는 연락처 검색" autoComplete="off" onFocus={() => setSearchFocused(true)} onBlur={() => setTimeout(() => setSearchFocused(false), 150)} onChange={(event) => setSearch(event.target.value)} onClear={() => setSearch("")} onKeyDown={(event) => {
              if (event.key === "ArrowDown" && searchResults.length) { event.preventDefault(); setHighlightedResult((value) => Math.min(searchResults.length - 1, value + 1)); }
              else if (event.key === "ArrowUp" && searchResults.length) { event.preventDefault(); setHighlightedResult((value) => Math.max(0, value - 1)); }
              else if (event.key === "Enter") { event.preventDefault(); const selected = searchResults[highlightedResult]; if (selected) selectParty(selected.customerId, selected.dogId); }
              else if (event.key === "Escape") { event.preventDefault(); setSearchFocused(false); searchRef.current?.blur(); }
            }} className="[&_input]:h-14 [&_input]:text-base" />
            {searchFocused && search.trim() && <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[min(430px,65dvh)] overflow-auto rounded-2xl border border-border bg-white p-2 shadow-[var(--pm-shadow-elevated)]">
              {searchLoading ? <div className="space-y-2 p-1" aria-label="검색 중"><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : searchResults.length ? <div id="sale-party-search-results" role="listbox" aria-label="고객과 반려견 검색 결과" className="space-y-1">{searchResults.map((result, index) => <div key={result.key} className={cn("rounded-xl transition", highlightedResult === index && "bg-primary-subtle")}><button id={`sale-party-${result.key.replace(":", "-")}`} type="button" role="option" aria-selected={highlightedResult === index} onMouseEnter={() => setHighlightedResult(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => selectParty(result.customerId, result.dogId)} className="flex min-h-24 w-full items-center gap-3 rounded-xl p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">{result.dogName ? <Dog size={21} /> : <UserRound size={21} />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-base text-text-primary"><HighlightedText text={result.dogName || result.customerName || "이름 미등록"} query={debouncedSearch} /></strong><span className="mt-1 block truncate text-sm text-text-secondary">보호자 <HighlightedText text={result.customerName || "미등록"} query={debouncedSearch} /> · {result.breed || "견종 미등록"}</span><span className="mt-1 block truncate text-xs text-text-muted"><HighlightedText text={maskedPhone(result.customerPhone)} query={debouncedSearch} /> · 반려견 {result.dogNames.length || 0}마리</span><span className="mt-1 block truncate text-xs text-primary">{result.lastSale ? `${result.lastSale.productName} · ${recentTime(result.lastSale.createdAt)}` : "최근 이용 없음"}</span></span><span className="shrink-0 text-xs font-semibold text-primary">선택</span></button>{result.customerId && <div className="flex justify-end px-3 pb-2"><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const customer = customers.find((item) => item.id === result.customerId); if (customer) openQuickRegistration(customer); }} className="min-h-11 rounded-xl px-3 text-xs font-semibold text-text-secondary hover:bg-white hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">같은 보호자에게 새 반려견 추가</button></div>}</div>)}</div> : <div className="p-5 text-center"><p className="text-sm font-semibold text-text-primary">검색된 고객이 없습니다.</p><p className="mt-1 text-xs text-text-muted">다른 연락처를 확인하거나 바로 신규 등록하세요.</p><Button type="button" className="mt-4" onMouseDown={(event) => event.preventDefault()} onClick={() => openQuickRegistration()}><Plus size={16} />신규 보호자·반려견 등록</Button></div>}
            </div>}
          </div>
          <div className="mt-5"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-text-secondary">최근 고객</span><Button type="button" variant="ghost" onClick={() => openQuickRegistration()}><Plus size={16} />신규 등록</Button></div>{recentParties.length ? <div className="flex snap-x gap-2 overflow-x-auto pb-2">{recentParties.map((party) => <button key={party.key} type="button" onClick={() => selectParty(party.customerId, party.dogId)} className="min-h-28 min-w-44 snap-start rounded-2xl border border-border bg-surface p-3.5 text-left transition duration-200 hover:border-primary/30 hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"><strong className="block truncate text-sm text-text-primary">{party.dogName || "반려견 없음"}</strong><span className="mt-1 block truncate text-xs text-text-secondary">{party.customerName || "보호자 미등록"}</span><span className="mt-3 block truncate text-xs font-medium text-primary">{party.lastSale?.productName || "상품 이력 없음"}</span><span className="mt-1 block truncate text-[11px] text-text-muted">{party.lastSale ? recentTime(party.lastSale.createdAt) : "최근 선택"}</span></button>)}</div> : <p className="rounded-xl bg-surface-secondary p-4 text-sm text-text-muted">최근 등록 고객이 없습니다.</p>}</div>
        </> : <div className="rounded-2xl border border-primary/20 bg-primary-subtle p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-white"><Dog size={24} /></span><div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">현재 선택</p><strong className="mt-1 block truncate text-2xl text-text-primary">{selectedDog?.name || "반려견 없음"}</strong><p className="mt-1 text-sm text-text-secondary">{selectedDog ? `${selectedDog.breed || "견종 미등록"} · ${dogAge(selectedDog.birthDate)}` : "보호자만 지정한 매출"}</p><p className="mt-1 text-sm text-text-secondary">보호자 {selectedCustomer?.name ?? selectedDog?.customerName ?? "미등록"} · {maskedPhone(selectedCustomer?.phone ?? selectedDog?.customerPhone ?? null)}</p>{latestSelectedSale && <p className="mt-2 text-xs font-medium text-primary">최근 {latestSelectedSale.productName} · {latestSelectedSale.saleDate}</p>}</div></div><div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end"><Button type="button" variant="secondary" onClick={clearParty}>고객 변경</Button>{selectedCustomer && <Button type="button" variant="secondary" onClick={() => openQuickRegistration(selectedCustomer)}><Plus size={16} />새 반려견</Button>}<Button type="button" variant="ghost" onClick={() => requestNavigation("/customers")}><ExternalLink size={16} />고객 상세</Button></div></div>{selectableDogs.length > 0 && <div className="mt-4 border-t border-primary/10 pt-4"><p className="mb-2 text-xs font-semibold text-text-secondary">다른 반려견 선택</p><div className="flex flex-wrap gap-2"><button type="button" aria-pressed={!form.dogId} onClick={() => setForm((current) => ({ ...current, dogId: "" }))} className={cn("min-h-11 rounded-xl border px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", !form.dogId ? "border-primary bg-primary text-white" : "border-border bg-white text-text-secondary")}>반려견 없음</button>{selectableDogs.map((dog) => <button type="button" aria-pressed={form.dogId === dog.id} key={dog.id} onClick={() => setForm((current) => ({ ...current, dogId: dog.id }))} className={cn("min-h-11 rounded-xl border px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", form.dogId === dog.id ? "border-primary bg-primary text-white" : "border-border bg-white text-text-secondary hover:border-primary/30")}>{dog.name}</button>)}</div></div>}</div>}
        {(form.customerId || form.dogId) && <div className="mt-5 border-t border-border pt-5"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Clock3 size={16} className="text-primary" /><h3 className="text-sm font-semibold text-text-primary">최근 거래</h3></div><div className="flex gap-1"><Button type="button" variant="ghost" onClick={() => setTimelineExpanded((value) => !value)}>{timelineExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}{timelineExpanded ? "접기" : "최대 5건"}</Button><Button type="button" variant="ghost" onClick={() => requestNavigation("/sales")}>전체 내역</Button></div></div>{selectedRecentSales.length ? <div className="space-y-2">{selectedRecentSales.slice(0, timelineExpanded ? 5 : 2).map((sale) => <button key={sale.id} type="button" onClick={() => requestNavigation(`/sales?detail=${sale.id}`)} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-border p-3 text-left transition duration-200 hover:border-primary/25 hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className="min-w-0"><strong className="block truncate text-sm text-text-primary">{sale.productName}</strong><span className="mt-1 block truncate text-xs text-text-muted">{sale.saleDate} · {sale.businessUnitName} · {sale.staffName || "담당자 미등록"}</span></span><span className="shrink-0 text-right"><strong className="block text-sm tabular-nums text-text-primary">{won(sale.paidAmount)}</strong><StatusBadge status={sale.status} /></span></button>)}</div> : <p className="rounded-xl bg-surface-secondary p-4 text-sm text-text-muted">최근 거래가 없습니다.</p>}</div>}
      </Card>

      <Card className="mt-4 p-5 sm:p-6"><div ref={productSectionRef} className="scroll-mt-5"><div className="mb-5 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-primary">2 · 상품 선택</p><h2 className="mt-1 text-lg font-semibold text-text-primary">추천 상품</h2></div>{form.productId && <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success"><CheckCircle2 size={16} />선택 완료</span>}</div><div className="space-y-5">{renderProductGroup("최근 이용 상품", "최근 사용한 상품부터 표시합니다.", recommendationGroups.recent)}{renderProductGroup("자주 이용한 상품", "이 고객의 이용 빈도 기준입니다.", recommendationGroups.frequent)}{renderProductGroup("사업부 인기 상품", "현재 사업부에서 자주 등록된 상품입니다.", recommendationGroups.popular)}<section className="space-y-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><PackageCheck size={16} className="text-primary" /><h3 className="text-sm font-semibold text-text-primary">전체 상품 검색 및 선택</h3></div><Button type="button" variant="ghost" onClick={openQuickProductRegistration}><Plus size={16} />새 상품</Button></div><SearchBox aria-label="상품명 검색" value={productQuery} placeholder="상품명 검색" onClear={() => setProductQuery("")} onChange={(event) => setProductQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />{productSearchResults.length > 0 ? <div className="grid gap-2 sm:grid-cols-2">{productSearchResults.map((product) => <button key={product.id} type="button" aria-pressed={form.productId === product.id} onClick={() => selectProduct(product)} className={cn("flex min-h-14 items-center justify-between rounded-xl border px-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", form.productId === product.id ? "border-primary bg-primary text-white" : "border-border hover:border-primary/30 hover:bg-primary-subtle")}><span className="truncate text-sm font-semibold">{product.name}</span><span className="ml-3 shrink-0 text-sm tabular-nums">{won(product.defaultPrice)}</span></button>)}</div> : productQuery.trim() && <div className="rounded-2xl border border-dashed border-border bg-surface-secondary p-4 text-center"><p className="text-sm text-text-secondary">검색된 상품이 없습니다.</p><Button type="button" variant="secondary" className="mt-3" onClick={openQuickProductRegistration}><Plus size={16} />“{productQuery.trim()}” 새 상품 등록</Button></div>}<div className="grid gap-4 md:grid-cols-3"><Field label="사업부" required><Select name="businessUnitId" value={form.businessUnitId} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, businessUnitId: event.target.value, categoryId: "", productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0 }))}><option value="">사업부 선택</option>{businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select></Field><Field label="상품 분류" required><Select name="categoryId" value={form.categoryId} disabled={saving || !form.businessUnitId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value, productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0 }))}><option value="">분류 선택</option>{filteredCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field><Field label="상품" required><Select name="productId" value={form.productId} disabled={saving || !form.categoryId} onChange={(event) => { const product = products.find((item) => item.id === event.target.value); if (product) selectProduct(product); else setForm((current) => ({ ...current, productId: "", originalAmount: 0, paidAmount: 0 })); }}><option value="">상품 선택</option>{filteredProducts.map((item) => <option key={item.id} value={item.id}>{item.name} · {won(item.defaultPrice)}</option>)}</Select></Field></div></section></div></div></Card>

      <Card className="mt-4 p-5 sm:p-6"><div className="mb-5"><p className="text-xs font-semibold text-primary">3 · 결제 확인</p><h2 className="mt-1 text-lg font-semibold text-text-primary">결제 정보와 저장</h2></div><div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="space-y-5"><div className="grid gap-5 md:grid-cols-2"><Field label="정상 판매가" required help="상품 기본가를 불러오며 수정할 수 있습니다."><CurrencyInput name="originalAmount" value={form.originalAmount} disabled={saving} onValue={(value) => setForm((current) => ({ ...current, originalAmount: value }))} /></Field><Field label="실제 결제 금액" required><CurrencyInput name="paidAmount" value={form.paidAmount} disabled={saving} onValue={(value) => setForm((current) => ({ ...current, paidAmount: value }))} /></Field><Field label="결제 수단" required><Select name="paymentMethod" value={form.paymentMethod} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))}><option value="card">카드</option><option value="transfer">계좌이체</option><option value="cash">현금</option><option value="outstanding">미수</option></Select></Field><Field label="구분" required><Select name="customerType" value={form.customerType} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, customerType: event.target.value }))}><option value="new">신규</option><option value="renewal">재등록</option></Select></Field><Field label="매출 일자" required><Input name="saleDate" type="date" value={form.saleDate} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, saleDate: event.target.value }))} /></Field><Field label="담당자" required><Select name="staffId" value={form.staffId} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field></div><button type="button" disabled={saving} className="flex min-h-12 w-full items-center justify-between rounded-xl border border-border bg-surface-secondary px-4 text-left text-sm font-semibold text-text-secondary transition hover:border-primary/20 hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}>할인·환불·미수금 고급 옵션<ChevronDown size={18} className={`transition-transform duration-200 ${advancedOpen ? "rotate-180" : ""}`} /></button>{advancedOpen && <div className="grid gap-5 rounded-2xl border border-border bg-surface-secondary p-4 md:grid-cols-3"><Field label="할인 금액"><CurrencyInput name="discountAmount" value={form.discountAmount} max={form.originalAmount} disabled={saving} onValue={(value) => setForm((current) => ({ ...current, discountAmount: value }))} /></Field><Field label="환불 금액"><CurrencyInput name="refundAmount" value={form.refundAmount} max={form.paidAmount} disabled={saving} onValue={(value) => setForm((current) => ({ ...current, refundAmount: value }))} /></Field><Field label="미수금"><CurrencyInput name="outstandingAmount" value={form.outstandingAmount} max={expectedAmount} disabled={saving} onValue={(value) => setForm((current) => ({ ...current, outstandingAmount: value }))} /></Field></div>}<Field label="메모"><Textarea name="memo" rows={3} maxLength={500} placeholder="전달할 업무 메모가 있을 때만 입력하세요." value={form.memo} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, memo: event.target.value }))} /></Field><div className="rounded-2xl border border-border bg-surface-secondary p-4"><div className="mb-3 flex items-center gap-2"><Settings2 size={16} className="text-primary" /><p className="text-sm font-semibold text-text-primary">다음 등록에 유지</p></div><div className="grid gap-1 sm:grid-cols-2">{([ ["keepBusinessUnit", "사업부"], ["keepStaff", "담당자"], ["keepProduct", "상품"], ["keepPaymentMethod", "결제수단"] ] as const).map(([key, label]) => <label key={key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm text-text-secondary hover:bg-white"><input type="checkbox" className="h-4 w-4 accent-primary" checked={repeatSettings[key]} disabled={saving || (key === "keepBusinessUnit" && repeatSettings.keepProduct)} onChange={(event) => updateRepeatSetting(key, event.target.checked)} />{label} 유지</label>)}</div></div></div><aside className="h-fit rounded-2xl border border-primary/15 bg-primary-subtle p-5 lg:sticky lg:top-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">결제 요약</p><p className="mt-3 truncate text-base font-semibold text-text-primary">{selectedDog?.name || selectedCustomer?.name || "고객 미선택"}</p><p className="mt-1 truncate text-sm text-text-secondary">{products.find((product) => product.id === form.productId)?.name || "상품 미선택"}</p><div className="my-5 border-y border-primary/10 py-5"><p className="text-xs text-text-secondary">최종 결제 금액</p><strong className="mt-1 block text-3xl tabular-nums text-primary">{won(Math.max(form.paidAmount, 0))}</strong></div><dl className="space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-text-muted">사업부</dt><dd className="font-medium text-text-primary">{businessUnits.find((unit) => unit.id === form.businessUnitId)?.name || "-"}</dd></div><div className="flex justify-between gap-3"><dt className="text-text-muted">원가 / 할인</dt><dd className="text-right font-medium text-text-primary">{won(form.originalAmount)} / {won(form.discountAmount)}</dd></div><div className="flex justify-between gap-3"><dt className="text-text-muted">결제수단</dt><dd className="font-medium text-text-primary">{paymentLabel[form.paymentMethod] || form.paymentMethod}</dd></div><div className="flex justify-between gap-3"><dt className="text-text-muted">담당자</dt><dd className="font-medium text-text-primary">{staff.find((item) => item.id === form.staffId)?.name || "-"}</dd></div><div className="flex justify-between gap-3"><dt className="text-text-muted">미수금</dt><dd className={cn("font-medium", form.outstandingAmount ? "text-warning" : "text-text-primary")}>{form.outstandingAmount ? won(form.outstandingAmount) : "없음"}</dd></div><div className="flex justify-between gap-3"><dt className="text-text-muted">메모</dt><dd className="font-medium text-text-primary">{form.memo.trim() ? "있음" : "없음"}</dd></div></dl>{error && <div id="sale-form-error" role="alert" className="mt-4 rounded-xl border border-error/15 bg-error-soft px-3 py-2.5 text-sm font-medium text-error">{error}</div>}<p className={cn("mt-4 text-sm", missingRequirement ? "text-text-secondary" : "font-semibold text-success")}>{missingRequirement || "저장할 준비가 완료되었습니다."}</p><div className="mt-4 hidden gap-2 lg:grid"><Button disabled={!canSave}>{saving && <LoaderCircle className="animate-spin" size={17} />}{saving ? "등록 중…" : `매출 저장 · ${won(Math.max(netAmount, 0))}`}</Button><Button type="button" variant="ghost" disabled={saving} onClick={resetAll}>입력 초기화</Button></div></aside></div></Card>
      {!mobileInputActive && <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"><div className="mx-auto max-w-5xl"><p className="mb-2 truncate text-center text-xs text-text-secondary">{missingRequirement || "저장할 준비가 완료되었습니다."}</p><div className="grid grid-cols-[auto_1fr] gap-2"><Button type="button" variant="secondary" disabled={saving} onClick={resetAll}>초기화</Button><Button disabled={!canSave}>{saving && <LoaderCircle className="animate-spin" size={17} />}{saving ? "등록 중…" : `매출 저장 · ${won(Math.max(netAmount, 0))}`}</Button></div></div></div>}
    </form>

    {notice && <Toast title="선택 완료" message={notice} tone="success" onClose={() => setNotice("")} />}
    <Modal open={Boolean(successSummary)} onClose={() => { if (!saving) resetAfterSave(); setSuccessSummary(null); }} title="매출 등록 완료">
      {successSummary && <div><div className="rounded-2xl bg-success-soft p-5 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success text-white"><CheckCircle2 size={24} /></span><p className="mt-3 text-sm font-semibold text-success">정상적으로 등록했습니다.</p><strong className="mt-2 block text-xl text-text-primary">{successSummary.partyName}</strong><p className="mt-1 text-sm text-text-secondary">{successSummary.productName}</p><p className="mt-3 text-2xl font-bold tabular-nums text-primary">{won(successSummary.paidAmount)}</p></div><dl className="mt-4 space-y-2 rounded-2xl border border-border p-4 text-sm"><div className="flex justify-between gap-3"><dt className="text-text-muted">등록 시각</dt><dd className="text-right font-medium text-text-primary">{new Date(successSummary.savedAt).toLocaleString("ko-KR")}</dd></div><div className="flex justify-between gap-3"><dt className="text-text-muted">담당자</dt><dd className="font-medium text-text-primary">{successSummary.staffName}</dd></div></dl><div className="mt-5 grid gap-2 sm:grid-cols-2"><Button type="button" data-modal-initial onClick={resetForSameParty}>같은 고객 추가 등록</Button><Button type="button" variant="secondary" onClick={resetForNewParty}>새 고객 등록</Button><Button type="button" variant="secondary" onClick={() => navigate(`/sales?detail=${successSummary.saleId}`)}>매출 내역 보기</Button><Button type="button" variant="ghost" onClick={() => { resetAfterSave(); setSuccessSummary(null); }}>닫기</Button></div></div>}
    </Modal>
    <ConfirmModal open={Boolean(pendingNavigation)} title="입력 중인 화면에서 이동할까요?" description="현재 선택한 고객과 상품 정보는 저장되지 않습니다." confirmLabel="이동" cancelLabel="계속 입력" tone="primary" onClose={() => setPendingNavigation(null)} onConfirm={() => { const path = pendingNavigation; setPendingNavigation(null); if (path) navigate(path); }} />
    <Modal open={quickOpen} onClose={() => { if (!quickSavingRef.current) setQuickOpen(false); }} title="신규 보호자·반려견 등록">
      <form onSubmit={submitQuickRegistration} className="space-y-4">
        <p className="text-sm leading-6 text-text-secondary">현장 매출에 필요한 최소 정보만 입력합니다. 상세 정보는 반려견 관리에서 보완할 수 있습니다.</p>
        <Field label="반려견 이름" required><Input data-modal-initial name="quickDogName" value={quickForm.dogName} disabled={quickSaving} onChange={(event) => setQuickForm((current) => ({ ...current, dogName: event.target.value }))} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="보호자 이름" required><Input name="quickCustomerName" value={quickForm.customerName} disabled={quickSaving || Boolean(duplicateCustomer)} onChange={(event) => setQuickForm((current) => ({ ...current, customerName: event.target.value }))} /></Field><Field label="연락처" required><Input ref={quickPhoneRef} name="quickPhone" inputMode="numeric" autoComplete="tel" placeholder="010-1234-5678" value={quickForm.phone} disabled={quickSaving || quickAddingToExisting} onChange={(event) => { setQuickForm((current) => ({ ...current, phone: formatPhone(event.target.value) })); setQuickAddingToExisting(false); setQuickError(""); }} /></Field></div>
        {duplicateCustomer && <div className="rounded-2xl border border-warning/20 bg-warning-soft p-4"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-warning" size={18} /><div><strong className="text-sm text-text-primary">동일 연락처의 기존 보호자가 있습니다.</strong><p className="mt-1 text-sm text-text-secondary">보호자: {duplicateCustomer.name || "이름 미등록"}</p><p className="mt-1 text-xs text-text-muted">등록된 반려견: {dogs.filter((dog) => dog.customerId === duplicateCustomer.id).map((dog) => dog.name).join(", ") || "없음"}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => { selectParty(duplicateCustomer.id); setQuickOpen(false); }}>기존 고객 선택</Button><Button type="button" variant={quickAddingToExisting ? "primary" : "secondary"} onClick={() => { setQuickAddingToExisting(true); setQuickForm((current) => ({ ...current, customerName: duplicateCustomer.name ?? current.customerName })); }}>새 반려견 추가</Button><Button type="button" variant="ghost" onClick={() => { setQuickForm((current) => ({ ...current, phone: "", customerName: "" })); setQuickAddingToExisting(false); requestAnimationFrame(() => quickPhoneRef.current?.focus()); }}>다른 연락처 입력</Button></div></div>}
        <Field label="견종"><Input name="quickBreed" value={quickForm.breed} disabled={quickSaving} placeholder="선택 입력" onChange={(event) => setQuickForm((current) => ({ ...current, breed: event.target.value }))} /></Field>
        {quickError && <p role="alert" className="rounded-xl bg-error-soft px-4 py-3 text-sm font-medium text-error">{quickError}</p>}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end"><Button type="button" variant="secondary" disabled={quickSaving} onClick={() => setQuickOpen(false)}>취소</Button><Button disabled={quickSaving}>{quickSaving && <LoaderCircle className="animate-spin" size={17} />}{quickSaving ? "등록 중..." : duplicateCustomer ? "반려견 등록 후 선택" : "등록 후 선택"}</Button></div>
      </form>
    </Modal>

    <Modal open={quickProductOpen} onClose={() => { if (!quickProductSavingRef.current) setQuickProductOpen(false); }} title="새 상품 등록">
      <form onSubmit={submitQuickProduct} className="space-y-4">
        <p className="text-sm leading-6 text-text-secondary">매출 등록에 필요한 활성 상품을 바로 추가합니다. 등록 후 현재 매출에 자동 선택됩니다.</p>
        <Field label="사업부" required><Select data-modal-initial name="quickProductBusinessUnitId" value={quickProductForm.businessUnitId} disabled={quickProductSaving} onChange={(event) => setQuickProductForm((current) => ({ ...current, businessUnitId: event.target.value, categoryId: "" }))}><option value="">사업부 선택</option>{businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select></Field>
        <Field label="상품 분류" required><Select name="quickProductCategoryId" value={quickProductForm.categoryId} disabled={quickProductSaving || !quickProductForm.businessUnitId} onChange={(event) => setQuickProductForm((current) => ({ ...current, categoryId: event.target.value }))}><option value="">상품 분류 선택</option>{categories.filter((category) => category.businessUnitId === quickProductForm.businessUnitId).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></Field>
        <Field label="상품명" required><Input name="quickProductName" value={quickProductForm.name} disabled={quickProductSaving} onChange={(event) => { setQuickProductForm((current) => ({ ...current, name: event.target.value })); setQuickProductError(""); }} /></Field>
        <Field label="기본 판매가" required><Input name="quickProductDefaultPrice" type="number" min="0" step="1" inputMode="numeric" value={quickProductForm.defaultPrice} disabled={quickProductSaving} onChange={(event) => setQuickProductForm((current) => ({ ...current, defaultPrice: Number(event.target.value) }))} /></Field>
        {quickProductError && <p id="quick-product-error" role="alert" className="rounded-xl bg-error-soft px-4 py-3 text-sm font-medium text-error">{quickProductError}</p>}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end"><Button type="button" variant="secondary" disabled={quickProductSaving} onClick={() => setQuickProductOpen(false)}>취소</Button><Button disabled={quickProductSaving}>{quickProductSaving && <LoaderCircle className="animate-spin" size={17} />}{quickProductSaving ? "등록 중..." : "등록 후 선택"}</Button></div>
      </form>
    </Modal>

    <Modal open={Boolean(duplicateWarning)} onClose={() => { if (!savingRef.current) setDuplicateWarning(null); }} title={duplicateWarning?.level === "strong" ? "중복 가능성이 있습니다" : "오늘 등록된 같은 상품이 있습니다"}>
      {duplicateWarning && <div><div className="rounded-2xl border border-warning/20 bg-warning-soft p-4"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-warning" size={20} /><div><p className="text-sm font-semibold text-text-primary">{duplicateWarning.level === "strong" ? "비슷한 매출이 최근 5분 안에 등록되었습니다." : "같은 고객과 상품의 매출이 오늘 이미 등록되었습니다."}</p><p className="mt-2 text-sm leading-6 text-text-secondary">{duplicateWarning.sale.saleDate} · {duplicateWarning.sale.dogName || "(반려견 없음)"}<br />{duplicateWarning.sale.businessUnitName} · {duplicateWarning.sale.productName} · {won(duplicateWarning.sale.paidAmount)}<br />등록자: {duplicateWarning.sale.staffName || "미등록"}</p></div></div></div><div className="mt-5 grid gap-2 sm:grid-cols-3"><Button type="button" variant="secondary" onClick={() => { const saleId = duplicateWarning.sale.id; setDuplicateWarning(null); navigate(`/sales?detail=${saleId}`); }}><ReceiptText size={16} />기존 내역 보기</Button><Button type="button" variant="secondary" disabled={saving} onClick={() => setDuplicateWarning(null)}>취소</Button><Button type="button" disabled={saving} onClick={() => void confirmDuplicate()}>{saving && <LoaderCircle className="animate-spin" size={17} />}{duplicateWarning.level === "strong" ? "그래도 등록" : "계속 등록"}</Button></div></div>}
    </Modal>
  </>;
}
