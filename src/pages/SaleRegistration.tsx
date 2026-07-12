import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Textarea,
  Toast,
} from "../components/ui";
import { won } from "../lib/format";
import { supabase } from "../lib/supabase";

interface DogOption {
  id: string;
  name: string;
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

const today = () => new Date().toISOString().slice(0, 10);

export function SaleFormPage() {
  const { businessUnits, profile } = useAuth();
  const [dogs, setDogs] = useState<DogOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [form, setForm] = useState({
    saleDate: today(),
    businessUnitId: "",
    dogId: "",
    categoryId: "",
    productId: "",
    originalAmount: 0,
    discountAmount: 0,
    paidAmount: 0,
    refundAmount: 0,
    outstandingAmount: 0,
    paymentMethod: "card",
    customerType: "new",
    staffId: profile?.id ?? "",
    memo: "",
  });

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const [dogsResult, categoriesResult, productsResult, staffResult] = await Promise.all([
      supabase.from("dogs").select("id, name, customer_id, customers(name, phone)").eq("is_active", true).order("name"),
      supabase.from("product_categories").select("id, business_unit_id, name").eq("is_active", true).order("sort_order").order("name"),
      supabase.from("products").select("id, business_unit_id, category_id, name, default_price").eq("is_active", true).order("sort_order").order("name"),
      supabase.rpc("get_active_staff_directory"),
    ]);
    const failed = dogsResult.error || categoriesResult.error || productsResult.error || staffResult.error;
    if (failed) {
      setLoadError("매출 등록에 필요한 정보를 불러오지 못했습니다.");
      setLoading(false);
      return;
    }
    setDogs((dogsResult.data ?? []).map((dog) => {
      const customer = Array.isArray(dog.customers) ? dog.customers[0] : dog.customers;
      return { id: dog.id, name: dog.name, customerId: dog.customer_id, customerName: customer?.name ?? null, customerPhone: customer?.phone ?? null };
    }));
    setCategories((categoriesResult.data ?? []).map((item) => ({ id: item.id, businessUnitId: item.business_unit_id, name: item.name })));
    setProducts((productsResult.data ?? []).map((item) => ({ id: item.id, businessUnitId: item.business_unit_id, categoryId: item.category_id, name: item.name, defaultPrice: item.default_price })));
    setStaff((staffResult.data ?? []).map((item: { id: string; name: string }) => ({ id: item.id, name: item.name })));
    setForm((current) => ({ ...current, staffId: current.staffId || profile?.id || "" }));
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const selectedDog = dogs.find((dog) => dog.id === form.dogId);
  const filteredCategories = categories.filter((item) => item.businessUnitId === form.businessUnitId);
  const filteredProducts = products.filter((item) => item.businessUnitId === form.businessUnitId && item.categoryId === form.categoryId);
  const expectedAmount = Math.max(form.originalAmount - form.discountAmount, 0);
  const netAmount = form.paidAmount - form.refundAmount;

  const reset = () => {
    setForm({ saleDate: today(), businessUnitId: "", dogId: "", categoryId: "", productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0, refundAmount: 0, outstandingAmount: 0, paymentMethod: "card", customerType: "new", staffId: profile?.id ?? "", memo: "" });
    setAdvancedOpen(false);
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const formElement = event.currentTarget as HTMLFormElement;
    const focus = (name: string) => requestAnimationFrame(() => { const field = formElement.elements.namedItem(name); if (field instanceof HTMLElement) field.focus(); });
    setError("");
    if (!form.saleDate || !form.businessUnitId || !form.dogId || !form.categoryId || !form.productId || !form.staffId) {
      setError("필수 항목을 모두 입력해 주세요.");
      focus(!form.businessUnitId ? "businessUnitId" : !form.dogId ? "dogId" : !form.categoryId ? "categoryId" : !form.productId ? "productId" : !form.saleDate ? "saleDate" : "staffId");
      return;
    }
    const selectedCategory = categories.find((item) => item.id === form.categoryId);
    const selectedProduct = products.find((item) => item.id === form.productId);
    if (selectedCategory?.businessUnitId !== form.businessUnitId || selectedProduct?.businessUnitId !== form.businessUnitId || selectedProduct?.categoryId !== form.categoryId) {
      setError("사업부, 상품 분류와 상품의 연결 정보를 확인해 주세요.");
      return;
    }
    if ([form.originalAmount, form.discountAmount, form.paidAmount, form.refundAmount, form.outstandingAmount].some((amount) => !Number.isFinite(amount) || amount < 0)) {
      setError("금액은 0원 이상으로 입력해 주세요.");
      focus("originalAmount");
      return;
    }
    if (form.discountAmount > form.originalAmount) {
      setError("할인 금액은 정상 판매가를 초과할 수 없습니다.");
      setAdvancedOpen(true); focus("discountAmount");
      return;
    }
    if (form.refundAmount > form.paidAmount) {
      setError("환불 금액은 실제 결제 금액을 초과할 수 없습니다.");
      setAdvancedOpen(true); focus("refundAmount");
      return;
    }
    if (form.paidAmount + form.outstandingAmount > expectedAmount) {
      setError("결제 금액과 미수금의 합계는 할인 후 결제 예정액을 초과할 수 없습니다.");
      setAdvancedOpen(true); focus("outstandingAmount");
      return;
    }

    setSaving(true);
    const result = await supabase.from("sales").insert({
      sale_date: form.saleDate,
      business_unit_id: form.businessUnitId,
      dog_id: form.dogId,
      customer_id: selectedDog?.customerId ?? null,
      product_category_id: form.categoryId,
      product_id: form.productId,
      original_amount: Math.trunc(form.originalAmount),
      discount_amount: Math.trunc(form.discountAmount),
      paid_amount: Math.trunc(form.paidAmount),
      refund_amount: Math.trunc(form.refundAmount),
      outstanding_amount: Math.trunc(form.outstandingAmount),
      net_amount: Math.trunc(netAmount),
      payment_method: form.paymentMethod,
      customer_type: form.customerType,
      staff_id: form.staffId,
      memo: form.memo.trim() || null,
      status: "normal",
      business_unit_name: "",
      dog_name: "",
      customer_name: null,
      product_category_name: "",
      product_name: "",
    }).select("id").single();
    setSaving(false);
    if (result.error) {
      setError(
        result.error.code === "42501"
          ? "권한이 없습니다."
          : result.error.message.includes("마감된 월")
            ? "마감된 월에는 매출을 등록할 수 없습니다."
            : result.error.code === "23503" || result.error.code === "23514"
              ? "입력한 금액 또는 선택 항목을 다시 확인해 주세요."
              : "매출을 저장하지 못했습니다. 잠시 후 다시 시도하세요.",
      );
      return;
    }
    setNotice("매출을 저장했습니다.");
    reset();
    focus("businessUnitId");
  };

  if (loading) return <><PageHeader title="매출 등록" description="매출 정보를 업무 순서대로 입력합니다." /><Card><LoadingState /></Card></>;
  if (loadError) return <><PageHeader title="매출 등록" description="매출 정보를 업무 순서대로 입력합니다." /><Card><ErrorState title={loadError} retry={() => void loadOptions()} /></Card></>;

  const numberValue = (value: string) => value === "" ? 0 : Number(value);
  return <>
    <PageHeader title="매출 등록" description="매출 정보를 업무 순서대로 입력합니다." />
    <form onSubmit={submit}><Card className="p-5"><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      <Field label="사업부" required><Select name="businessUnitId" value={form.businessUnitId} disabled={saving} onChange={(e) => setForm((current) => ({ ...current, businessUnitId: e.target.value, categoryId: "", productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0 }))}><option value="">사업부 선택</option>{businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select></Field>
      <Field label="반려견" required><Select name="dogId" value={form.dogId} disabled={saving || !form.businessUnitId} onChange={(e) => setForm((current) => ({ ...current, dogId: e.target.value }))}><option value="">반려견명으로 선택</option>{dogs.map((dog) => <option key={dog.id} value={dog.id}>{dog.name} · {dog.customerName || "보호자 미등록"}</option>)}</Select></Field>
      <Field label="보호자"><div className="flex min-h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">{selectedDog ? `${selectedDog.customerName || "미등록"} · ${selectedDog.customerPhone || "-"}` : "반려견을 선택하면 자동 표시됩니다."}</div></Field>
      <Field label="매출 일자" required><Input name="saleDate" type="date" value={form.saleDate} disabled={saving} onChange={(e) => setForm({ ...form, saleDate: e.target.value })} /></Field>
      <Field label="상품 분류" required><Select name="categoryId" value={form.categoryId} disabled={saving || !form.businessUnitId} onChange={(e) => setForm((current) => ({ ...current, categoryId: e.target.value, productId: "", originalAmount: 0, discountAmount: 0, paidAmount: 0 }))}><option value="">분류 선택</option>{filteredCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
      <Field label="상품" required><Select name="productId" value={form.productId} disabled={saving || !form.categoryId} onChange={(e) => { const product = products.find((item) => item.id === e.target.value); const price = product?.defaultPrice ?? 0; setForm((current) => ({ ...current, productId: e.target.value, originalAmount: price, discountAmount: 0, paidAmount: price, refundAmount: 0, outstandingAmount: 0 })); }}><option value="">상품 선택</option>{filteredProducts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
      <Field label="정상 판매가" required help="상품 기본가를 불러오며 수정할 수 있습니다."><Input name="originalAmount" type="number" min="0" step="1" value={form.originalAmount} disabled={saving} onChange={(e) => setForm({ ...form, originalAmount: numberValue(e.target.value) })} /></Field>
      <Field label="실제 결제 금액" required><Input type="number" min="0" step="1" value={form.paidAmount} disabled={saving} onChange={(e) => setForm({ ...form, paidAmount: numberValue(e.target.value) })} /></Field>
      <Field label="결제 수단" required><Select value={form.paymentMethod} disabled={saving} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="card">카드</option><option value="transfer">계좌이체</option><option value="cash">현금</option><option value="outstanding">미수</option></Select></Field>
      <Field label="구분" required><Select value={form.customerType} disabled={saving} onChange={(e) => setForm({ ...form, customerType: e.target.value })}><option value="new">신규</option><option value="renewal">재등록</option></Select></Field>
      <Field label="담당자" required><Select name="staffId" value={form.staffId} disabled={saving} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
      <Field label="실매출" help="실제 결제 금액 - 환불 금액"><div className="flex min-h-10 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 font-bold text-blue-800">{won(Math.max(netAmount, 0))}</div></Field>
      <div className="md:col-span-2 xl:col-span-3"><button type="button" className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}>고급 옵션<ChevronDown size={18} className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`} /></button></div>
      {advancedOpen && <div className="grid gap-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4 md:col-span-2 md:grid-cols-2 xl:col-span-3 xl:grid-cols-3">
        <Field label="할인 금액"><Input name="discountAmount" type="number" min="0" max={form.originalAmount} step="1" value={form.discountAmount} disabled={saving} onChange={(e) => setForm({ ...form, discountAmount: numberValue(e.target.value) })} /></Field>
        <Field label="환불 금액"><Input name="refundAmount" type="number" min="0" max={form.paidAmount} step="1" value={form.refundAmount} disabled={saving} onChange={(e) => setForm({ ...form, refundAmount: numberValue(e.target.value) })} /></Field>
        <Field label="미수금"><Input name="outstandingAmount" type="number" min="0" max={expectedAmount} step="1" value={form.outstandingAmount} disabled={saving} onChange={(e) => setForm({ ...form, outstandingAmount: numberValue(e.target.value) })} /></Field>
        <div className="md:col-span-2 xl:col-span-3"><Field label="메모"><Textarea rows={3} maxLength={500} value={form.memo} disabled={saving} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field></div>
      </div>}
    </div>{error && <p id="sale-form-error" role="alert" className="mt-4 text-sm font-medium text-red-600">{error}</p>}<div className="mt-6 flex justify-end gap-2"><Button type="button" variant="secondary" disabled={saving} onClick={reset}>초기화</Button><Button disabled={saving}>{saving ? "저장 중..." : "저장"}</Button></div></Card></form>
    {notice && <Toast message={notice} onClose={() => setNotice("")} />}
  </>;
}
