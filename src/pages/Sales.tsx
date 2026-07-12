import { useMemo, useState, type FormEvent } from "react";
import {
  ChevronDown,
  Download,
  Eye,
  Pencil,
  Plus,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../store/DataContext";
import type {
  Division,
  PaymentMethod,
  Sale,
  SaleKind,
  SaleStatus,
} from "../types";
import { koDate, net, won } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";

const divisions: Division[] = ["유치원", "교육센터", "호텔"];
const methods: PaymentMethod[] = ["카드", "계좌이체", "현금", "미수"];
const statusTone = (s: SaleStatus) =>
  s === "완료"
    ? "green"
    : s === "취소" || s === "전체환불"
      ? "red"
      : s === "부분환불" || s === "미수"
        ? "amber"
        : "gray";
const num = (v: string) => Math.max(0, Number(v) || 0);

export function SaleFormPage() {
  const d = useData();
  const nav = useNavigate();
  const { saleId } = useParams();
  const existing = d.sales.find((s) => s.id === saleId);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState(() =>
    existing
      ? { ...existing }
      : {
          date: today,
          division: "" as Division | "",
          customerId: "",
          petId: "",
          categoryId: "",
          productId: "",
          listPrice: 0,
          discount: 0,
          payment: 0,
          refund: 0,
          receivable: 0,
          paymentMethod: "카드" as PaymentMethod,
          kind: "신규" as SaleKind,
          staff: d.settings.staff[0],
          memo: "",
          status: "완료" as SaleStatus,
        },
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [customerModal, setCustomerModal] = useState(false);
  const [petModal, setPetModal] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(
      existing?.discount ||
        existing?.refund ||
        existing?.receivable ||
        existing?.memo,
    ),
  );
  const categories = d.categories.filter(
    (x) => x.division === form.division && x.active,
  );
  const products = d.products.filter(
    (x) =>
      x.division === form.division &&
      x.categoryId === form.categoryId &&
      x.active,
  );
  const pets = [...d.pets].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const real = net(form.payment, form.refund, form.receivable, form.status);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const chooseProduct = (id: string) => {
    const p = d.products.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      productId: id,
      listPrice: p?.defaultPrice || 0,
      payment: p?.defaultPrice || 0,
      discount: 0,
    }));
  };
  const choosePet = (id: string) => {
    const pet = d.pets.find((item) => item.id === id);
    setForm((current) => ({
      ...current,
      petId: id,
      customerId: pet?.customerId || "",
    }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (
      !form.division ||
      !form.customerId ||
      !form.petId ||
      !form.categoryId ||
      !form.productId
    ) {
      setNotice("필수 항목을 모두 입력해 주세요.");
      return;
    }
    setSaving(true);
    setTimeout(() => {
      const payload = {
        ...form,
        division: form.division as Division,
        status: (form.refund >= form.payment && form.payment > 0
          ? "전체환불"
          : form.refund > 0
            ? "부분환불"
            : form.receivable > 0
              ? "미수"
              : "완료") as SaleStatus,
      };
      if (existing) d.updateSale({ ...existing, ...payload });
      else d.addSale(payload);
      setSaving(false);
      nav("/sales", {
        state: {
          message: existing
            ? "매출이 수정되었습니다."
            : "매출이 저장되었습니다.",
        },
      });
    }, 450);
  };
  return (
    <>
      <PageHeader
        title={existing ? "매출 수정" : "매출 등록"}
        description="매출 정보를 업무 순서대로 입력합니다."
      />
      <form onSubmit={submit}>
        <Card className="p-5">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <Field label="사업부" required>
              <Select
                value={form.division}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    division: e.target.value as Division,
                    categoryId: "",
                    productId: "",
                    listPrice: 0,
                    payment: 0,
                  }))
                }
              >
                <option value="">사업부 선택</option>
                {divisions.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label="반려견" required>
              <div className="flex gap-2">
                <Select
                  value={form.petId}
                  disabled={!form.division}
                  onChange={(e) => choosePet(e.target.value)}
                >
                  <option value="">반려견명으로 선택</option>
                  {pets.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ·{" "}
                      {d.customers.find((owner) => owner.id === x.customerId)
                        ?.name || "보호자 미등록"}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCustomerModal(true)}
                  aria-label="신규 반려견"
                >
                  <Plus size={17} />
                </Button>
              </div>
            </Field>
            <Field label="보호자">
              <div className="flex min-h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                {form.customerId
                  ? `${d.customers.find((owner) => owner.id === form.customerId)?.name || "-"} · ${d.customers.find((owner) => owner.id === form.customerId)?.phone || "-"}`
                  : "반려견을 선택하면 자동 표시됩니다."}
              </div>
            </Field>
            <Field label="매출 일자" required>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
              />
            </Field>
            <Field label="상품 분류" required>
              <Select
                value={form.categoryId}
                disabled={!form.division}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    categoryId: e.target.value,
                    productId: "",
                    listPrice: 0,
                    payment: 0,
                  }))
                }
              >
                <option value="">분류 선택</option>
                {categories.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="상품" required>
              <Select
                value={form.productId}
                disabled={!form.categoryId}
                onChange={(e) => chooseProduct(e.target.value)}
              >
                <option value="">상품 선택</option>
                {products.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="정상 판매가"
              required
              help="상품 기본가를 불러오며 수정할 수 있습니다."
            >
              <Input
                type="number"
                min="0"
                step="1"
                value={form.listPrice}
                onChange={(e) => set("listPrice", num(e.target.value))}
              />
            </Field>
            <Field label="실제 결제 금액" required>
              <Input
                type="number"
                min="0"
                step="1"
                value={form.payment}
                onChange={(e) => set("payment", num(e.target.value))}
              />
            </Field>
            <Field label="결제 수단" required>
              <Select
                value={form.paymentMethod}
                onChange={(e) =>
                  set("paymentMethod", e.target.value as PaymentMethod)
                }
              >
                {methods.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label="구분" required>
              <Select
                value={form.kind}
                onChange={(e) => set("kind", e.target.value as SaleKind)}
              >
                <option>신규</option>
                <option>재등록</option>
              </Select>
            </Field>
            <Field label="담당자" required>
              <Select
                value={form.staff}
                onChange={(e) => set("staff", e.target.value)}
              >
                {d.settings.staff.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label="실매출" help="결제 금액 - 환불 금액 - 미수금">
              <div className="flex min-h-10 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 font-bold text-blue-800">
                {won(real)}
              </div>
            </Field>
            <div className="md:col-span-2 xl:col-span-3">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => setAdvancedOpen((open) => !open)}
                aria-expanded={advancedOpen}
              >
                고급 옵션
                <ChevronDown
                  size={18}
                  className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
              </button>
            </div>
            {advancedOpen && (
              <div className="grid gap-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4 md:col-span-2 md:grid-cols-2 xl:col-span-3 xl:grid-cols-3">
                <Field label="할인 금액">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={form.discount}
                    onChange={(e) => {
                      const discount = num(e.target.value);
                      setForm((f) => ({
                        ...f,
                        discount,
                        payment: Math.max(0, f.listPrice - discount),
                      }));
                    }}
                  />
                </Field>
                <Field label="환불 금액">
                  <Input
                    type="number"
                    min="0"
                    max={form.payment}
                    value={form.refund}
                    onChange={(e) =>
                      set("refund", Math.min(form.payment, num(e.target.value)))
                    }
                  />
                </Field>
                <Field label="미수금">
                  <Input
                    type="number"
                    min="0"
                    max={form.payment}
                    value={form.receivable}
                    onChange={(e) =>
                      set(
                        "receivable",
                        Math.min(form.payment, num(e.target.value)),
                      )
                    }
                  />
                </Field>
                <div className="md:col-span-2 xl:col-span-3">
                  <Field label="메모">
                    <Textarea
                      rows={3}
                      value={form.memo}
                      onChange={(e) => set("memo", e.target.value)}
                      maxLength={500}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>
          {notice && (
            <p className="mt-4 text-sm font-medium text-red-600">{notice}</p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => nav(-1)}>
              취소
            </Button>
            <Button disabled={saving}>{saving ? "저장 중..." : "저장"}</Button>
          </div>
        </Card>
      </form>
      <QuickCustomer
        open={customerModal}
        onClose={() => setCustomerModal(false)}
        onCreated={(id) => {
          set("customerId", id);
          setCustomerModal(false);
          setPetModal(true);
        }}
      />
      <QuickPet
        open={petModal}
        customerId={form.customerId}
        onClose={() => setPetModal(false)}
        onCreated={(id) => {
          choosePet(id);
          setPetModal(false);
        }}
      />
    </>
  );
}

function QuickCustomer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const d = useData();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="신규 반려견의 보호자 추가">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = d.addCustomer({
            name,
            phone,
            memo: "",
            createdAt: new Date().toISOString().slice(0, 10),
          });
          onCreated(n.id);
        }}
        className="space-y-4"
      >
        <Field label="보호자명" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="연락처" required>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-0000-0000"
            required
          />
        </Field>
        <Button className="w-full">추가</Button>
      </form>
    </Modal>
  );
}
function QuickPet({
  open,
  customerId,
  onClose,
  onCreated,
}: {
  open: boolean;
  customerId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const d = useData();
  const [name, setName] = useState("");
  const [breed, setBreed] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="신규 반려견 추가">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = d.addPet({
            customerId,
            name,
            breed,
            birthDate: "",
            memo: "",
          });
          onCreated(n.id);
        }}
        className="space-y-4"
      >
        <Field label="반려견명" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="견종" required>
          <Input
            value={breed}
            onChange={(e) => setBreed(e.target.value)}
            required
          />
        </Field>
        <Button className="w-full">추가</Button>
      </form>
    </Modal>
  );
}

export function SalesHistoryPage() {
  const d = useData();
  const nav = useNavigate();
  const [filters, setFilters] = useState({
    month: "",
    from: "",
    to: "",
    division: "",
    categoryId: "",
    productId: "",
    kind: "",
    paymentMethod: "",
    staff: "",
    status: "",
    customer: "",
    pet: "",
  });
  const [sort, setSort] = useState<"date-desc" | "date-asc" | "net-desc">(
    "date-desc",
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Sale | null>(null);
  const [action, setAction] = useState<"cancel" | "refund" | null>(null);
  const [refund, setRefund] = useState(0);
  const [detailFiltersOpen, setDetailFiltersOpen] = useState(false);
  const set = (k: string, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const rows = useMemo(
    () =>
      d.sales
        .filter((s) => {
          const customer = d.customers.find((x) => x.id === s.customerId);
          const pet = d.pets.find((x) => x.id === s.petId);
          return (
            (!filters.month || s.date.startsWith(filters.month)) &&
            (!filters.from || s.date >= filters.from) &&
            (!filters.to || s.date <= filters.to) &&
            (!filters.division || s.division === filters.division) &&
            (!filters.categoryId || s.categoryId === filters.categoryId) &&
            (!filters.productId || s.productId === filters.productId) &&
            (!filters.kind || s.kind === filters.kind) &&
            (!filters.paymentMethod ||
              s.paymentMethod === filters.paymentMethod) &&
            (!filters.staff || s.staff === filters.staff) &&
            (!filters.status || s.status === filters.status) &&
            (!filters.customer || customer?.name.includes(filters.customer)) &&
            (!filters.pet || pet?.name.includes(filters.pet))
          );
        })
        .sort((a, b) =>
          sort === "date-asc"
            ? a.date.localeCompare(b.date)
            : sort === "net-desc"
              ? net(b.payment, b.refund, b.receivable, b.status) -
                net(a.payment, a.refund, a.receivable, a.status)
              : b.date.localeCompare(a.date),
        ),
    [d, filters, sort],
  );
  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);
  const reset = () => {
    setFilters({
      month: "",
      from: "",
      to: "",
      division: "",
      categoryId: "",
      productId: "",
      kind: "",
      paymentMethod: "",
      staff: "",
      status: "",
      customer: "",
      pet: "",
    });
    setPage(1);
  };
  return (
    <>
      <PageHeader
        title="매출 내역"
        description={`조건에 맞는 매출 ${rows.length.toLocaleString()}건`}
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                alert("필터 결과 다운로드는 Phase 6에서 제공 예정입니다.")
              }
            >
              <Download size={17} />
              다운로드 안내
            </Button>
            <Button onClick={() => nav("/sales/new")}>
              <Plus size={17} />
              매출 등록
            </Button>
          </div>
        }
      />
      <Card className="mb-4 p-4">
        <div
          className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 ${detailFiltersOpen ? "" : "[&>*:nth-child(n+5)]:hidden"}`}
        >
          <Input
            type="month"
            value={filters.month}
            onChange={(e) => set("month", e.target.value)}
            aria-label="월"
          />
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => set("from", e.target.value)}
            aria-label="시작일"
          />
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => set("to", e.target.value)}
            aria-label="종료일"
          />
          <Select
            value={filters.division}
            onChange={(e) => set("division", e.target.value)}
            aria-label="사업부"
          >
            <option value="">전체 사업부</option>
            {divisions.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <Select
            value={filters.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            aria-label="상품 분류"
          >
            <option value="">전체 분류</option>
            {d.categories
              .filter(
                (x) => !filters.division || x.division === filters.division,
              )
              .map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
          </Select>
          <Select
            value={filters.productId}
            onChange={(e) => set("productId", e.target.value)}
            aria-label="상품"
          >
            <option value="">전체 상품</option>
            {d.products
              .filter(
                (x) => !filters.division || x.division === filters.division,
              )
              .map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
          </Select>
          <Select
            value={filters.kind}
            onChange={(e) => set("kind", e.target.value)}
            aria-label="신규 재등록"
          >
            <option value="">신규·재등록 전체</option>
            <option>신규</option>
            <option>재등록</option>
          </Select>
          <Select
            value={filters.paymentMethod}
            onChange={(e) => set("paymentMethod", e.target.value)}
            aria-label="결제 수단"
          >
            <option value="">전체 결제 수단</option>
            {methods.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <Select
            value={filters.staff}
            onChange={(e) => set("staff", e.target.value)}
            aria-label="담당자"
          >
            <option value="">전체 담당자</option>
            {d.settings.staff.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <Select
            value={filters.status}
            onChange={(e) => set("status", e.target.value)}
            aria-label="상태"
          >
            <option value="">전체 상태</option>
            {["완료", "부분환불", "전체환불", "취소", "미수"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <Input
            placeholder="고객명"
            value={filters.customer}
            onChange={(e) => set("customer", e.target.value)}
          />
          <Input
            placeholder="반려견명"
            value={filters.pet}
            onChange={(e) => set("pet", e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setDetailFiltersOpen((open) => !open)}
              aria-expanded={detailFiltersOpen}
            >
              <ChevronDown
                size={16}
                className={`transition-transform ${detailFiltersOpen ? "rotate-180" : ""}`}
              />
              상세 필터
            </Button>
            <Button variant="ghost" onClick={reset}>
              <RotateCcw size={16} />
              필터 초기화
            </Button>
          </div>
          <Select
            className="w-40"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="date-desc">최신순</option>
            <option value="date-asc">오래된순</option>
            <option value="net-desc">실매출 높은순</option>
          </Select>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {!shown.length ? (
          <EmptyState description="필터 조건을 변경해 보세요." />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[1450px]">
              <thead>
                <tr>
                  {[
                    "매출 일자",
                    "사업부",
                    "고객명",
                    "반려견명",
                    "상품 분류",
                    "상품명",
                    "신규/재등록",
                    "정상 판매가",
                    "할인",
                    "결제",
                    "환불",
                    "실매출",
                    "결제 수단",
                    "담당자",
                    "상태",
                    "작업",
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const p = d.products.find((x) => x.id === s.productId);
                  return (
                    <tr key={s.id}>
                      <td>{koDate(s.date)}</td>
                      <td>{s.division}</td>
                      <td>
                        {d.customers.find((x) => x.id === s.customerId)?.name}
                      </td>
                      <td>{d.pets.find((x) => x.id === s.petId)?.name}</td>
                      <td>
                        {d.categories.find((x) => x.id === s.categoryId)?.name}
                      </td>
                      <td className="font-medium">{p?.name}</td>
                      <td>
                        <Badge tone={s.kind === "신규" ? "blue" : "green"}>
                          {s.kind}
                        </Badge>
                      </td>
                      <td>{won(s.listPrice)}</td>
                      <td>{won(s.discount)}</td>
                      <td>{won(s.payment)}</td>
                      <td>{won(s.refund)}</td>
                      <td className="font-bold">
                        {won(net(s.payment, s.refund, s.receivable, s.status))}
                      </td>
                      <td>{s.paymentMethod}</td>
                      <td>{s.staff}</td>
                      <td>
                        <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                      </td>
                      <td>
                        <div className="flex">
                          <button
                            className="icon-btn"
                            title="상세"
                            onClick={() => setSelected(s)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            title="수정"
                            onClick={() => nav(`/sales/${s.id}/edit`)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            title="취소"
                            onClick={() => {
                              setSelected(s);
                              setAction("cancel");
                            }}
                          >
                            <Undo2 size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            title="환불"
                            onClick={() => {
                              setSelected(s);
                              setRefund(s.refund);
                              setAction("refund");
                            }}
                          >
                            <RotateCcw size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
          <span>
            {page} / {pages} 페이지
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              이전
            </Button>
            <Button
              variant="secondary"
              disabled={page === pages}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </Button>
          </div>
        </div>
      </Card>
      <SaleDetail
        sale={selected}
        open={!!selected && !action}
        onClose={() => setSelected(null)}
      />
      <Modal
        open={!!action && !!selected}
        onClose={() => {
          setAction(null);
          setSelected(null);
        }}
        title={action === "cancel" ? "매출 취소" : "환불 처리"}
      >
        {selected && (
          <div>
            <p className="mb-4 text-sm text-slate-600">
              {d.products.find((x) => x.id === selected.productId)?.name} ·{" "}
              {won(selected.payment)}
            </p>
            {action === "refund" && (
              <Field label="환불 금액">
                <Input
                  type="number"
                  min="0"
                  max={selected.payment}
                  value={refund}
                  onChange={(e) =>
                    setRefund(Math.min(selected.payment, num(e.target.value)))
                  }
                />
              </Field>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setAction(null);
                  setSelected(null);
                }}
              >
                닫기
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  d.updateSale({
                    ...selected,
                    refund: action === "refund" ? refund : selected.refund,
                    status:
                      action === "cancel"
                        ? "취소"
                        : refund >= selected.payment
                          ? "전체환불"
                          : "부분환불",
                  });
                  setAction(null);
                  setSelected(null);
                }}
              >
                {action === "cancel" ? "취소 확정" : "환불 저장"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
function SaleDetail({
  sale,
  open,
  onClose,
}: {
  sale: Sale | null;
  open: boolean;
  onClose: () => void;
}) {
  const d = useData();
  if (!sale) return null;
  return (
    <Modal open={open} onClose={onClose} title="매출 상세" wide>
      <dl className="grid gap-4 sm:grid-cols-2">
        {[
          ["매출 일자", koDate(sale.date)],
          ["사업부", sale.division],
          ["고객", d.customers.find((x) => x.id === sale.customerId)?.name],
          ["반려견", d.pets.find((x) => x.id === sale.petId)?.name],
          ["상품", d.products.find((x) => x.id === sale.productId)?.name],
          ["정상 판매가", won(sale.listPrice)],
          ["결제 금액", won(sale.payment)],
          ["환불 금액", won(sale.refund)],
          ["미수금", won(sale.receivable)],
          [
            "실매출",
            won(net(sale.payment, sale.refund, sale.receivable, sale.status)),
          ],
          ["담당자", sale.staff],
          ["메모", sale.memo || "-"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-slate-500">{k}</dt>
            <dd className="mt-1 font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
