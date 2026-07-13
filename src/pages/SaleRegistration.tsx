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
  ChevronDown,
  Clock3,
  Dog,
  LoaderCircle,
  PackageCheck,
  Plus,
  ReceiptText,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  Button,
  Card,
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
  defaultRepeatSettings,
  duplicateWarningLevel,
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
const emptyQuickForm = () => ({ customerName: "", phone: "", dogName: "", breed: "", sex: "", birthDate: "", weight: "" });
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
  const savingRef = useRef(false);
  const quickSavingRef = useRef(false);
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [quickDetailsOpen, setQuickDetailsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [quickAddingToExisting, setQuickAddingToExisting] = useState(false);
  const [quickForm, setQuickForm] = useState(emptyQuickForm);
  const [duplicateWarning, setDuplicateWarning] = useState<{ sale: RecentSale; level: "strong" | "weak" } | null>(null);
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
    const fromSales = recentSales.flatMap((sale) => {
      const key = sale.customerId ? `customer:${sale.customerId}` : sale.dogId ? `dog:${sale.dogId}` : "";
      if (!key || seen.has(key)) return [];
      seen.add(key);
      const dog = dogs.find((item) => item.id === sale.dogId);
      const customer = customers.find((item) => item.id === sale.customerId);
      return [{ key, customerId: sale.customerId, dogId: sale.dogId, dogName: dog?.name ?? sale.dogName, breed: dog?.breed ?? null, customerName: customer?.name ?? sale.customerName, customerPhone: customer?.phone ?? dog?.customerPhone ?? null, dogNames: sale.customerId ? dogs.filter((item) => item.customerId === sale.customerId).map((item) => item.name) : sale.dogName ? [sale.dogName] : [], score: 7, lastSale: sale }];
    });
    const fromSelections = recentSelections.filter((party) => !seen.has(party.key));
    return [...fromSales, ...fromSelections].slice(0, 6);
  }, [customers, dogs, recentSales, recentSelections]);

  const selectedRecentSales = useMemo(() => recentSales.filter((sale) => form.customerId ? sale.customerId === form.customerId : form.dogId ? sale.dogId === form.dogId : false).slice(0, 5), [form.customerId, form.dogId, recentSales]);
  const recentProducts = useMemo(() => {
    const ids: string[] = [];
    const add = (productId: string) => { if (productId && !ids.includes(productId) && products.some((product) => product.id === productId)) ids.push(productId); };
    selectedRecentSales.forEach((sale) => add(sale.productId));
    recentSales.filter((sale) => sale.createdBy === profile?.id).forEach((sale) => add(sale.productId));
    const frequent = [...recentSales.reduce((map, sale) => {
      if (!form.businessUnitId || sale.businessUnitId === form.businessUnitId) map.set(sale.productId, (map.get(sale.productId) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]);
    frequent.forEach(([productId]) => add(productId));
    return ids.slice(0, 4).map((id) => products.find((product) => product.id === id)).filter((product): product is ProductOption => Boolean(product));
  }, [form.businessUnitId, products, profile?.id, recentSales, selectedRecentSales]);
  const latestSelectedSale = selectedRecentSales[0] ?? null;
  const missingRequirement = missingSaleRequirement({ hasParty: Boolean(form.customerId || form.dogId), businessUnitId: form.businessUnitId, productId: form.productId, paidAmount: form.paidAmount, staffId: form.staffId });
  const canSave = !missingRequirement && !saving;
  const duplicateCustomer = useMemo(() => {
    const normalized = phoneDigits(quickForm.phone);
    return normalized.length === 11 ? customers.find((customer) => phoneDigits(customer.phone ?? "") === normalized) ?? null : null;
  }, [customers, quickForm.phone]);

  const selectProduct = (product: ProductOption) => {
    setForm((current) => ({ ...current, businessUnitId: product.businessUnitId, categoryId: product.categoryId, productId: product.id, originalAmount: product.defaultPrice, discountAmount: 0, paidAmount: product.defaultPrice, refundAmount: 0, outstandingAmount: 0 }));
    setError("");
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
    setSearch(""); setSearchFocused(false); setError("");
  };

  const clearParty = () => {
    setForm((current) => ({ ...current, customerId: "", dogId: "" }));
    setSearch(""); requestAnimationFrame(() => searchRef.current?.focus());
  };

  const resetAfterSave = () => {
    const defaultPrice = products.find((product) => product.id === form.productId)?.defaultPrice ?? null;
    setForm((current) => nextSaleForm(current, repeatSettings, { today: today(), defaultStaffId: profile?.id ?? "", productDefaultPrice: defaultPrice }));
    setAdvancedOpen(false); setError(""); setSearch("");
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const resetAll = () => {
    setForm((current) => ({ saleDate: today(), businessUnitId: current.businessUnitId, customerId: "", dogId: "", categoryId: "", productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0, refundAmount: 0, outstandingAmount: 0, paymentMethod: "card", customerType: "new", staffId: current.staffId, memo: "" }));
    setAdvancedOpen(false); setError(""); setSearch(""); requestAnimationFrame(() => searchRef.current?.focus());
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
    setRecentSales((current) => [mapRecentSale(result.data as Record<string, unknown>), ...current].slice(0, 100));
    const savedParty = selectedDog?.name || selectedCustomer?.name || "보호자 지정 매출";
    const savedProduct = products.find((product) => product.id === form.productId)?.name || "상품";
    setNotice(`${savedParty} · ${savedProduct} · ${won(form.paidAmount)} 저장 완료`);
    resetAfterSave();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (savingRef.current) return;
    setError("");
    if (!validate(event.currentTarget)) return;
    savingRef.current = true; setSaving(true);
    const partyFilter = form.customerId ? `customer_id.eq.${form.customerId}` : `dog_id.eq.${form.dogId}`;
    const duplicateResult = await supabase.from("sales").select(recentSaleFields)
      .eq("product_id", form.productId).eq("sale_date", today()).neq("status", "cancelled")
      .or(partyFilter).order("created_at", { ascending: false }).limit(10);
    if (duplicateResult.error) { savingRef.current = false; setSaving(false); setError(`중복 매출 확인 실패: ${duplicateResult.error.message}`); return; }
    const candidates = (duplicateResult.data ?? []).map((row) => mapRecentSale(row as Record<string, unknown>));
    const currentDuplicate = { now: Date.now(), today: today(), businessUnitId: form.businessUnitId, paidAmount: Math.trunc(form.paidAmount) };
    const strong = candidates.find((sale) => duplicateWarningLevel(sale, currentDuplicate) === "strong");
    const weak = candidates.find((sale) => duplicateWarningLevel(sale, currentDuplicate) === "weak");
    if (strong || weak) { savingRef.current = false; setSaving(false); setDuplicateWarning({ sale: strong ?? weak!, level: strong ? "strong" : "weak" }); return; }
    await persistSale();
  };

  const openQuickRegistration = (customer?: CustomerOption) => {
    setQuickForm({ ...emptyQuickForm(), customerName: customer?.name ?? "", phone: formatPhone(customer?.phone ?? "") });
    setQuickError(""); setQuickAddingToExisting(Boolean(customer)); setQuickDetailsOpen(false); setQuickOpen(true);
  };

  const submitQuickRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (quickSavingRef.current) return;
    const customerName = quickForm.customerName.trim(); const dogName = quickForm.dogName.trim();
    const weight = quickForm.weight === "" ? null : Number(quickForm.weight);
    if (!customerName || !quickForm.phone || !dogName) { setQuickError("반려견 이름, 보호자 이름과 연락처를 입력해 주세요."); return; }
    if (!isValidPhone(quickForm.phone)) { setQuickError("연락처는 010으로 시작하는 11자리 번호로 입력해 주세요."); requestAnimationFrame(() => quickPhoneRef.current?.focus()); return; }
    if (duplicateCustomer && !quickAddingToExisting) { setQuickError("동일 연락처의 기존 보호자를 선택하거나 새 반려견 추가를 선택해 주세요."); return; }
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) { setQuickError("몸무게는 0보다 큰 값으로 입력해 주세요."); return; }
    quickSavingRef.current = true; setQuickSaving(true); setQuickError("");
    const result = await supabase.rpc("quick_register_sale_party", { p_customer_name: customerName, p_phone: phoneDigits(quickForm.phone), p_dog_name: dogName, p_breed: quickForm.breed.trim() || null, p_sex: quickForm.sex || null, p_birth_date: quickForm.birthDate || null, p_weight: weight });
    quickSavingRef.current = false; setQuickSaving(false);
    if (result.error) { setQuickError(result.error.code === "42501" ? "권한이 없습니다." : result.error.message); return; }
    const first = ((result.data ?? []) as QuickPartyResult[])[0];
    if (!first) { setQuickError("간편 등록 결과를 확인할 수 없습니다."); return; }
    setCustomers((current) => current.some((item) => item.id === first.customer_id) ? current : [...current, { id: first.customer_id, name: first.customer_name, phone: first.customer_phone }].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko")));
    if (first.dog_id && first.dog_name) setDogs((current) => current.some((dog) => dog.id === first.dog_id) ? current : [...current, { id: first.dog_id!, name: first.dog_name!, breed: quickForm.breed.trim() || null, birthDate: quickForm.birthDate || null, customerId: first.customer_id, customerName: first.customer_name, customerPhone: first.customer_phone }].sort((a, b) => a.name.localeCompare(b.name, "ko")));
    setForm((current) => ({ ...current, customerId: first.customer_id, dogId: first.dog_id ?? "" }));
    setQuickOpen(false); setSearch("");
    setNotice(first.customer_created ? "신규 보호자와 반려견을 등록하고 선택했습니다." : "기존 보호자에게 반려견을 연결하고 선택했습니다.");
  };

  if (loading) return <><PageHeader title="매출 등록" description="고객 선택부터 결제까지 한 화면에서 빠르게 등록합니다." /><Card><LoadingState /></Card></>;
  if (loadError) return <><PageHeader title="매출 등록" description="고객 선택부터 결제까지 한 화면에서 빠르게 등록합니다." /><Card><ErrorState title={loadError} retry={() => void loadOptions()} /></Card></>;

  return <>
    <PageHeader title="매출 등록" description="반려견 이름을 먼저 검색하면 가장 빠르게 등록할 수 있습니다." />
    <form onSubmit={submit} className="mx-auto max-w-5xl pb-24 lg:pb-0">
      <Card className="relative z-10 p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Step 1</p><h2 className="mt-1 text-lg font-semibold text-text-primary">고객·반려견 선택</h2></div>{(form.customerId || form.dogId) && <Button type="button" variant="ghost" onClick={clearParty}><X size={16} />선택 해제</Button>}</div>
        {!form.customerId && !form.dogId ? <>
          <div className="relative">
            <SearchBox inputRef={searchRef} value={search} role="combobox" aria-autocomplete="list" aria-expanded={searchFocused && Boolean(search.trim())} aria-controls="sale-party-search-results" aria-activedescendant={searchResults[highlightedResult] ? `sale-party-${searchResults[highlightedResult].key.replace(":", "-")}` : undefined} placeholder="반려견 이름, 보호자 이름 또는 전화번호 검색" autoComplete="off" onFocus={() => setSearchFocused(true)} onBlur={() => setTimeout(() => setSearchFocused(false), 120)} onChange={(event) => setSearch(event.target.value)} onClear={() => setSearch("")} onKeyDown={(event) => {
              if (event.key === "ArrowDown" && searchResults.length) { event.preventDefault(); setHighlightedResult((value) => Math.min(searchResults.length - 1, value + 1)); }
              else if (event.key === "ArrowUp" && searchResults.length) { event.preventDefault(); setHighlightedResult((value) => Math.max(0, value - 1)); }
              else if (event.key === "Enter") { event.preventDefault(); const selected = searchResults[highlightedResult]; if (selected) selectParty(selected.customerId, selected.dogId); }
              else if (event.key === "Escape") { event.preventDefault(); setSearchFocused(false); }
            }} className="[&_input]:h-13 [&_input]:text-[15px]" />
            {searchFocused && search.trim() && <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[420px] overflow-auto rounded-2xl border border-border bg-white p-2 shadow-[var(--pm-shadow-elevated)]">
              {searchLoading ? <div className="space-y-2 p-1" aria-label="검색 중"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : searchResults.length ? <div id="sale-party-search-results" role="listbox" aria-label="고객과 반려견 검색 결과">{searchResults.map((result, index) => <button id={`sale-party-${result.key.replace(":", "-")}`} key={result.key} type="button" role="option" aria-selected={highlightedResult === index} onMouseEnter={() => setHighlightedResult(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => selectParty(result.customerId, result.dogId)} className={cn("flex w-full items-center gap-3 rounded-xl p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", highlightedResult === index ? "bg-primary-subtle" : "hover:bg-primary-subtle")}><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">{result.dogName ? <Dog size={20} /> : <UserRound size={20} />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-[15px] text-text-primary">{result.dogName || result.customerName || "이름 미등록"}</strong><span className="mt-0.5 block truncate text-xs text-text-secondary">보호자 {result.customerName || "미등록"} · {result.breed || "견종 미등록"} · {maskedPhone(result.customerPhone)}</span><span className="mt-1 block truncate text-[11px] text-text-muted">{result.dogNames.length > 1 ? `다른 반려견 ${result.dogNames.length - 1}마리 · ` : ""}{result.lastSale ? `최근 ${recentTime(result.lastSale.createdAt)} · ${result.lastSale.businessUnitName}` : "최근 이용 없음"}</span></span></button>)}</div> : <div className="p-5 text-center"><p className="text-sm font-medium text-text-primary">검색 결과가 없습니다.</p><p className="mt-1 text-xs text-text-muted">새 보호자와 반려견을 바로 등록할 수 있습니다.</p><Button type="button" className="mt-4" onMouseDown={(event) => event.preventDefault()} onClick={() => openQuickRegistration()}><Plus size={16} />신규 보호자·반려견 등록</Button></div>}
            </div>}
          </div>
          <div className="mt-4"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-text-muted">최근 고객</span><Button type="button" variant="ghost" onClick={() => openQuickRegistration()}><Plus size={16} />신규 등록</Button></div>{recentParties.length ? <div className="flex gap-2 overflow-x-auto pb-1">{recentParties.map((party, index) => <button key={party.key} type="button" onClick={() => selectParty(party.customerId, party.dogId)} className={cn("min-h-24 min-w-40 flex-1 rounded-xl border border-border bg-surface p-3 text-left transition hover:border-primary/25 hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", index >= 4 && "hidden xl:block")}><strong className="block truncate text-sm text-text-primary">{party.dogName || "(반려견 없음)"}</strong><span className="mt-1 block truncate text-xs text-text-secondary">{party.customerName || "보호자 미등록"}</span><span className="mt-2 block truncate text-[11px] text-text-muted">{party.lastSale ? recentTime(party.lastSale.createdAt) : "최근 선택"}</span><span className="mt-0.5 block truncate text-[11px] text-primary">{party.lastSale?.productName || "상품 이력 없음"}</span></button>)}</div> : <p className="text-xs text-text-muted">최근 등록 고객이 없습니다.</p>}</div>
        </> : <div className="rounded-2xl border border-primary/20 bg-primary-subtle p-4 sm:p-5"><p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">현재 선택</p><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white"><Dog size={24} /></span><div><strong className="text-xl text-text-primary">{selectedDog?.name || "반려견 미지정"}</strong><p className="mt-0.5 text-sm text-text-secondary">{selectedDog ? `${selectedDog.breed || "견종 미등록"} · ${dogAge(selectedDog.birthDate)}` : "보호자만 지정한 매출"}</p><p className="mt-1 text-sm text-text-secondary">보호자 {selectedCustomer?.name ?? selectedDog?.customerName ?? "미등록"} · {maskedPhone(selectedCustomer?.phone ?? selectedDog?.customerPhone ?? null)}</p>{latestSelectedSale && <p className="mt-1.5 text-xs text-primary">최근 이용 {latestSelectedSale.saleDate} · {latestSelectedSale.productName}</p>}</div></div><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={clearParty}>다른 고객 선택</Button>{selectedCustomer && <Button type="button" variant="secondary" onClick={() => openQuickRegistration(selectedCustomer)}><Plus size={16} />새 반려견 추가</Button>}</div></div>{selectableDogs.length > 0 && <div className="mt-4 border-t border-primary/10 pt-4"><p className="mb-2 text-xs font-semibold text-text-secondary">연결된 반려견</p><div className="flex flex-wrap gap-2"><button type="button" aria-pressed={!form.dogId} onClick={() => setForm((current) => ({ ...current, dogId: "" }))} className={cn("min-h-11 rounded-xl border px-3 text-sm font-medium", !form.dogId ? "border-primary bg-primary text-white" : "border-border bg-white text-text-secondary")}>반려견 미지정</button>{selectableDogs.map((dog) => <button type="button" aria-pressed={form.dogId === dog.id} key={dog.id} onClick={() => setForm((current) => ({ ...current, dogId: dog.id }))} className={cn("min-h-11 rounded-xl border px-3 text-sm font-medium", form.dogId === dog.id ? "border-primary bg-primary text-white" : "border-border bg-white text-text-secondary hover:border-primary/25")}>{dog.name}</button>)}</div></div>}</div>}
        {(form.customerId || form.dogId) && <div className="mt-5 border-t border-border pt-5"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Clock3 size={16} className="text-primary" /><h3 className="text-sm font-semibold text-text-primary">최근 거래</h3><span className="text-xs text-text-muted">최대 5건</span></div><Button type="button" variant="ghost" onClick={() => navigate("/sales")}>전체 보기</Button></div>{selectedRecentSales.length ? <div className="grid gap-2 md:grid-cols-2">{selectedRecentSales.map((sale) => <button key={sale.id} type="button" onClick={() => navigate("/sales")} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-left transition hover:border-primary/20 hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className="min-w-0"><strong className="block truncate text-sm text-text-primary">{sale.productName}</strong><span className="mt-1 block text-xs text-text-muted">{sale.saleDate} · {sale.businessUnitName} · {sale.staffName || "담당자 미등록"}</span><span className="mt-1 block text-[11px] text-text-muted">{sale.status === "partial_refund" ? "부분 환불 처리" : sale.status === "full_refund" ? "환불 완료" : sale.status === "cancelled" ? "취소된 매출" : "환불 없음"}</span></span><span className="shrink-0 text-right"><strong className="block text-sm tabular-nums text-text-primary">{won(sale.paidAmount)}</strong><StatusBadge status={sale.status} /></span></button>)}</div> : <p className="rounded-xl bg-surface-secondary p-4 text-sm text-text-muted">최근 거래가 없습니다.</p>}</div>}
      </Card>

      <Card className="mt-4 p-5 sm:p-6"><div className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Step 2</p><h2 className="mt-1 text-lg font-semibold text-text-primary">상품 선택</h2></div>{recentProducts.length > 0 && <div className="mb-5"><div className="mb-2 flex items-center gap-2"><PackageCheck size={16} className="text-primary" /><p className="text-xs font-semibold text-text-secondary">빠른 상품 선택</p></div><div className="flex gap-2 overflow-x-auto pb-1">{recentProducts.map((product) => <button key={product.id} type="button" aria-pressed={form.productId === product.id} onClick={() => selectProduct(product)} className={cn("min-h-20 min-w-44 rounded-xl border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", form.productId === product.id ? "border-primary bg-primary text-white" : "border-border bg-surface hover:border-primary/25 hover:bg-primary-subtle")}><strong className={cn("block truncate text-sm", form.productId === product.id ? "text-white" : "text-text-primary")}>{product.name}</strong><span className={cn("mt-1.5 block text-xs", form.productId === product.id ? "text-blue-100/80" : "text-text-muted")}>{businessUnits.find((unit) => unit.id === product.businessUnitId)?.name || "사업부"} · {won(product.defaultPrice)}</span></button>)}</div></div>}<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <Field label="사업부" required><Select name="businessUnitId" value={form.businessUnitId} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, businessUnitId: event.target.value, categoryId: "", productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0 }))}><option value="">사업부 선택</option>{businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select></Field>
        <Field label="상품 분류" required><Select name="categoryId" value={form.categoryId} disabled={saving || !form.businessUnitId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value, productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0 }))}><option value="">분류 선택</option>{filteredCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Field label="상품" required><Select name="productId" value={form.productId} disabled={saving || !form.categoryId} onChange={(event) => { const product = products.find((item) => item.id === event.target.value); if (product) selectProduct(product); else setForm((current) => ({ ...current, productId: "", originalAmount: 0, paidAmount: 0 })); }}><option value="">상품 선택</option>{filteredProducts.map((item) => <option key={item.id} value={item.id}>{item.name} · {won(item.defaultPrice)}</option>)}</Select></Field>
      </div></Card>

      {(form.customerId || form.dogId) && <div className="sticky bottom-4 z-10 mt-4 hidden items-center justify-between gap-4 rounded-2xl border border-primary/15 bg-white/95 px-5 py-4 shadow-lg backdrop-blur lg:flex"><div className="min-w-0"><p className="truncate text-sm font-semibold text-text-primary">{selectedDog?.name || selectedCustomer?.name || "선택 고객"} · {products.find((product) => product.id === form.productId)?.name || "상품을 선택해 주세요"}</p><p className="mt-1 text-xs text-text-secondary">{missingRequirement || "선택이 완료되었습니다. 바로 저장할 수 있습니다."}</p></div><Button className="min-w-52" disabled={!canSave}>{saving && <LoaderCircle className="animate-spin" size={17} />}{saving ? "등록 중…" : `매출 저장 · ${won(Math.max(netAmount, 0))}`}</Button></div>}

      <Card className="mt-4 p-5 sm:p-6"><div className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Step 3</p><h2 className="mt-1 text-lg font-semibold text-text-primary">결제 정보</h2></div><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <Field label="정상 판매가" required help="상품 기본가를 불러오며 수정할 수 있습니다."><CurrencyInput name="originalAmount" value={form.originalAmount} disabled={saving} onValue={(value) => setForm((current) => ({ ...current, originalAmount: value }))} /></Field>
        <Field label="실제 결제 금액" required><CurrencyInput name="paidAmount" value={form.paidAmount} disabled={saving} onValue={(value) => setForm((current) => ({ ...current, paidAmount: value }))} /></Field>
        <Field label="실매출" help="실제 결제 금액 - 환불 금액"><div className="flex min-h-11 items-center justify-between rounded-xl border border-primary/15 bg-primary-subtle px-4"><span className="text-xs font-medium text-text-secondary">자동 계산</span><strong className="tabular-nums text-primary">{won(Math.max(netAmount, 0))}</strong></div></Field>
        <Field label="결제 수단" required><Select name="paymentMethod" value={form.paymentMethod} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))}><option value="card">카드</option><option value="transfer">계좌이체</option><option value="cash">현금</option><option value="outstanding">미수</option></Select></Field>
        <Field label="구분" required><Select name="customerType" value={form.customerType} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, customerType: event.target.value }))}><option value="new">신규</option><option value="renewal">재등록</option></Select></Field>
        <Field label="매출 일자" required><Input name="saleDate" type="date" value={form.saleDate} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, saleDate: event.target.value }))} /></Field>
        <div className="md:col-span-2 lg:col-span-3"><button type="button" disabled={saving} className="flex min-h-12 w-full items-center justify-between rounded-xl border border-border bg-surface-secondary px-4 text-left text-sm font-semibold text-text-secondary transition hover:border-primary/20 hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}>할인·환불·미수금 고급 옵션<ChevronDown size={18} className={`transition-transform duration-200 ${advancedOpen ? "rotate-180" : ""}`} /></button></div>
        {advancedOpen && <div className="grid gap-5 rounded-2xl border border-border bg-surface-secondary p-4 md:col-span-2 md:grid-cols-2 lg:col-span-3 lg:grid-cols-3"><Field label="할인 금액"><CurrencyInput name="discountAmount" value={form.discountAmount} max={form.originalAmount} disabled={saving} onValue={(value) => setForm((current) => ({ ...current, discountAmount: value }))} /></Field><Field label="환불 금액"><CurrencyInput name="refundAmount" value={form.refundAmount} max={form.paidAmount} disabled={saving} onValue={(value) => setForm((current) => ({ ...current, refundAmount: value }))} /></Field><Field label="미수금"><CurrencyInput name="outstandingAmount" value={form.outstandingAmount} max={expectedAmount} disabled={saving} onValue={(value) => setForm((current) => ({ ...current, outstandingAmount: value }))} /></Field></div>}
      </div></Card>

      <Card className="mt-4 p-5 sm:p-6"><div className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Step 4</p><h2 className="mt-1 text-lg font-semibold text-text-primary">담당자·다음 등록 설정</h2></div><div className="grid gap-5 md:grid-cols-2"><Field label="담당자" required><Select name="staffId" value={form.staffId} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, staffId: event.target.value }))}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field><div className="md:row-span-2"><Field label="메모"><Textarea name="memo" rows={4} maxLength={500} placeholder="전달할 업무 메모가 있을 때만 입력하세요." value={form.memo} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, memo: event.target.value }))} /></Field></div><div className="rounded-2xl border border-border bg-surface-secondary p-4"><div className="mb-3 flex items-center gap-2"><Settings2 size={16} className="text-primary" /><p className="text-sm font-semibold text-text-primary">다음 등록에 유지</p></div><div className="grid gap-1.5 sm:grid-cols-2">{([
          ["keepBusinessUnit", "사업부 유지"], ["keepStaff", "담당자 유지"], ["keepProduct", "상품 유지"], ["keepPaymentMethod", "결제수단 유지"],
        ] as const).map(([key, label]) => <label key={key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm text-text-secondary hover:bg-white"><input type="checkbox" className="h-4 w-4 accent-primary" checked={repeatSettings[key]} disabled={saving || (key === "keepBusinessUnit" && repeatSettings.keepProduct)} onChange={(event) => updateRepeatSetting(key, event.target.checked)} />{label}</label>)}</div>{repeatSettings.keepProduct && <p className="mt-2 text-xs text-text-muted">상품 유지 시 사업부와 기본 금액도 함께 유지됩니다.</p>}</div></div>
        {error && <div id="sale-form-error" role="alert" className="mt-5 rounded-xl border border-error/15 bg-error-soft px-4 py-3 text-sm font-medium text-error">{error}</div>}
        <div className="mt-5 flex items-center justify-between gap-4 rounded-xl bg-primary-subtle px-4 py-3"><p className={cn("text-sm", missingRequirement ? "text-text-secondary" : "font-semibold text-primary")}>{missingRequirement || "저장할 준비가 완료되었습니다."}</p><span className="hidden text-sm font-semibold tabular-nums text-primary sm:block">{won(Math.max(netAmount, 0))}</span></div>
        <div className="mt-4 hidden justify-end gap-2 lg:flex"><Button type="button" variant="secondary" disabled={saving} onClick={resetAll}>입력 초기화</Button><Button className="min-w-44" disabled={!canSave}>{saving && <LoaderCircle className="animate-spin" size={17} />}{saving ? "등록 중…" : `매출 저장 · ${won(Math.max(netAmount, 0))}`}</Button></div>
      </Card>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"><div className="mx-auto max-w-5xl"><p className="mb-2 truncate text-center text-xs text-text-secondary">{missingRequirement || "저장할 준비가 완료되었습니다."}</p><div className="grid grid-cols-[auto_1fr] gap-2"><Button type="button" variant="secondary" disabled={saving} onClick={resetAll}>초기화</Button><Button disabled={!canSave}>{saving && <LoaderCircle className="animate-spin" size={17} />}{saving ? "등록 중…" : `매출 저장 · ${won(Math.max(netAmount, 0))}`}</Button></div></div></div>
    </form>

    {notice && <Toast title="저장 완료" message={notice} tone="success" onClose={() => setNotice("")} />}
    <Modal open={quickOpen} onClose={() => { if (!quickSavingRef.current) setQuickOpen(false); }} title="신규 보호자·반려견 등록">
      <form onSubmit={submitQuickRegistration} className="space-y-4">
        <p className="text-sm leading-6 text-text-secondary">현장 매출에 필요한 최소 정보만 입력합니다. 상세 정보는 반려견 관리에서 보완할 수 있습니다.</p>
        <Field label="반려견 이름" required><Input data-modal-initial name="quickDogName" value={quickForm.dogName} disabled={quickSaving} onChange={(event) => setQuickForm((current) => ({ ...current, dogName: event.target.value }))} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="보호자 이름" required><Input name="quickCustomerName" value={quickForm.customerName} disabled={quickSaving || Boolean(duplicateCustomer)} onChange={(event) => setQuickForm((current) => ({ ...current, customerName: event.target.value }))} /></Field><Field label="연락처" required><Input ref={quickPhoneRef} name="quickPhone" inputMode="numeric" autoComplete="tel" placeholder="010-1234-5678" value={quickForm.phone} disabled={quickSaving || quickAddingToExisting} onChange={(event) => { setQuickForm((current) => ({ ...current, phone: formatPhone(event.target.value) })); setQuickAddingToExisting(false); setQuickError(""); }} /></Field></div>
        {duplicateCustomer && <div className="rounded-2xl border border-warning/20 bg-warning-soft p-4"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-warning" size={18} /><div><strong className="text-sm text-text-primary">동일 연락처의 기존 보호자가 있습니다.</strong><p className="mt-1 text-sm text-text-secondary">보호자: {duplicateCustomer.name || "이름 미등록"}</p><p className="mt-1 text-xs text-text-muted">등록된 반려견: {dogs.filter((dog) => dog.customerId === duplicateCustomer.id).map((dog) => dog.name).join(", ") || "없음"}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => { selectParty(duplicateCustomer.id); setQuickOpen(false); }}>기존 고객 선택</Button><Button type="button" variant={quickAddingToExisting ? "primary" : "secondary"} onClick={() => { setQuickAddingToExisting(true); setQuickForm((current) => ({ ...current, customerName: duplicateCustomer.name ?? current.customerName })); }}>새 반려견 추가</Button><Button type="button" variant="ghost" onClick={() => { setQuickForm((current) => ({ ...current, phone: "", customerName: "" })); setQuickAddingToExisting(false); requestAnimationFrame(() => quickPhoneRef.current?.focus()); }}>다른 연락처 입력</Button></div></div>}
        <button type="button" className="flex min-h-11 w-full items-center justify-between rounded-xl border border-border bg-surface-secondary px-4 text-sm font-semibold text-text-secondary" onClick={() => setQuickDetailsOpen((value) => !value)} aria-expanded={quickDetailsOpen}>추가 정보 <span className="flex items-center gap-1 text-xs font-normal text-text-muted">선택 사항 <ChevronDown size={16} className={`transition-transform ${quickDetailsOpen ? "rotate-180" : ""}`} /></span></button>
        {quickDetailsOpen && <div className="grid gap-4 rounded-2xl border border-border bg-surface-secondary p-4 sm:grid-cols-2"><Field label="견종"><Input value={quickForm.breed} disabled={quickSaving} onChange={(event) => setQuickForm((current) => ({ ...current, breed: event.target.value }))} /></Field><Field label="성별"><Select value={quickForm.sex} disabled={quickSaving} onChange={(event) => setQuickForm((current) => ({ ...current, sex: event.target.value }))}><option value="">미지정</option><option value="male">수컷</option><option value="female">암컷</option></Select></Field><Field label="생년월일"><Input type="date" value={quickForm.birthDate} disabled={quickSaving} onChange={(event) => setQuickForm((current) => ({ ...current, birthDate: event.target.value }))} /></Field><Field label="몸무게(kg)"><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={quickForm.weight} disabled={quickSaving} onChange={(event) => setQuickForm((current) => ({ ...current, weight: event.target.value }))} /></Field></div>}
        {quickError && <p role="alert" className="rounded-xl bg-error-soft px-4 py-3 text-sm font-medium text-error">{quickError}</p>}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end"><Button type="button" variant="secondary" disabled={quickSaving} onClick={() => setQuickOpen(false)}>취소</Button><Button disabled={quickSaving}>{quickSaving && <LoaderCircle className="animate-spin" size={17} />}{quickSaving ? "등록 중..." : duplicateCustomer ? "반려견 등록 후 선택" : "등록 후 선택"}</Button></div>
      </form>
    </Modal>

    <Modal open={Boolean(duplicateWarning)} onClose={() => { if (!savingRef.current) setDuplicateWarning(null); }} title={duplicateWarning?.level === "strong" ? "중복 가능성이 있습니다" : "오늘 등록된 같은 상품이 있습니다"}>
      {duplicateWarning && <div><div className="rounded-2xl border border-warning/20 bg-warning-soft p-4"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-warning" size={20} /><div><p className="text-sm font-semibold text-text-primary">{duplicateWarning.level === "strong" ? "비슷한 매출이 최근 5분 안에 등록되었습니다." : "같은 고객과 상품의 매출이 오늘 이미 등록되었습니다."}</p><p className="mt-2 text-sm leading-6 text-text-secondary">{duplicateWarning.sale.saleDate} · {duplicateWarning.sale.dogName || "(반려견 없음)"}<br />{duplicateWarning.sale.businessUnitName} · {duplicateWarning.sale.productName} · {won(duplicateWarning.sale.paidAmount)}<br />등록자: {duplicateWarning.sale.staffName || "미등록"}</p></div></div></div><div className="mt-5 grid gap-2 sm:grid-cols-3"><Button type="button" variant="secondary" onClick={() => { setDuplicateWarning(null); navigate("/sales"); }}><ReceiptText size={16} />기존 내역 보기</Button><Button type="button" variant="secondary" onClick={() => setDuplicateWarning(null)}>취소</Button><Button type="button" disabled={saving} onClick={() => { if (savingRef.current) return; savingRef.current = true; setDuplicateWarning(null); setSaving(true); void persistSale(); }}>{saving && <LoaderCircle className="animate-spin" size={17} />}{duplicateWarning.level === "strong" ? "그래도 등록" : "계속 등록"}</Button></div></div>}
    </Modal>
  </>;
}
