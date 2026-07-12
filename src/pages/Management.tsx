import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Eye, Pencil, Plus, RotateCcw, Search } from "lucide-react";
import { useData } from "../store/DataContext";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../lib/supabase";
import type { Category, Customer, Division, Pet, Product } from "../types";
import { koDate, net, won } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
  Table,
  Toast,
} from "../components/ui";
const divisions: Division[] = ["유치원", "교육센터", "호텔"];
const emptyCategory: Omit<Category, "id"> = {
  division: "유치원",
  name: "",
  active: true,
};
const emptyProduct: Omit<Product, "id"> = {
  division: "유치원",
  categoryId: "",
  name: "",
  defaultPrice: 0,
  active: true,
  memo: "",
};

export function CategoriesPage() {
  const { businessUnits, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [division, setDivision] = useState<Division>("유치원");
  const [editing, setEditing] = useState<
    Category | Omit<Category, "id"> | null
  >(null);
  const [rows, setRows] = useState<
    (Category & { sortOrder: number; linked: number; activeLinked: number })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processingId, setProcessingId] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const loadCategories = useCallback(async () => {
    const unit = businessUnits.find((item) => item.name === division);
    if (!unit) {
      setRows([]);
      setLoadError(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(false);
    const result = await supabase
      .from("product_categories")
      .select("id, name, sort_order, is_active, products(id, is_active)")
      .eq("business_unit_id", unit.id)
      .order("sort_order")
      .order("name");

    if (result.error) {
      setRows([]);
      setLoadError(true);
    } else {
      setRows(
        (result.data ?? []).map((category) => ({
          id: category.id,
          division,
          name: category.name,
          active: category.is_active,
          sortOrder: category.sort_order,
          linked: category.products?.length ?? 0,
          activeLinked:
            category.products?.filter((product) => product.is_active).length ?? 0,
        })),
      );
    }
    setLoading(false);
  }, [businessUnits, division]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!editing) return;
    if (!editing.name.trim()) {
      setFormError("분류명을 입력해 주세요.");
      const formElement = e.currentTarget as HTMLFormElement;
      requestAnimationFrame(() => { const field = formElement.elements.namedItem("categoryName"); if (field instanceof HTMLElement) field.focus(); });
      return;
    }
    const unit = businessUnits.find((item) => item.name === editing.division);
    if (!unit) {
      setFormError("사업부 정보를 확인할 수 없습니다.");
      return;
    }

    setSaving(true);
    setFormError("");
    const result =
      "id" in editing
        ? await supabase
            .from("product_categories")
            .update({
              name: editing.name.trim(),
              is_active: editing.active,
            })
            .eq("id", editing.id)
            .select("id")
            .single()
        : await supabase
            .from("product_categories")
            .insert({
              business_unit_id: unit.id,
              name: editing.name.trim(),
              is_active: editing.active,
              sort_order: Math.max(0, ...rows.map((row) => row.sortOrder)) + 1,
            })
            .select("id")
            .single();
    setSaving(false);

    if (result.error) {
      setFormError(
        result.error.code === "23505"
          ? "같은 사업부에 동일한 분류명이 이미 존재합니다."
          : "상품 분류를 저장하지 못했습니다. 잠시 후 다시 시도하세요.",
      );
      return;
    }

    setNotice("id" in editing ? "상품 분류를 수정했습니다." : "상품 분류를 등록했습니다.");
    setEditing(null);
    await loadCategories();
  };

  const toggleActive = async (
    category: Category & { activeLinked: number },
  ) => {
    if (category.active && category.activeLinked) {
      setNotice(`활성 상품 ${category.activeLinked}개가 연결되어 있어 비활성화할 수 없습니다.`);
      return;
    }
    setProcessingId(category.id);
    const result = await supabase
      .from("product_categories")
      .update({ is_active: !category.active })
      .eq("id", category.id)
      .select("id")
      .single();
    setProcessingId("");

    if (result.error) {
      setNotice("활성 상태를 변경하지 못했습니다.");
      return;
    }
    setNotice(category.active ? "상품 분류를 비활성화했습니다." : "상품 분류를 활성화했습니다.");
    await loadCategories();
  };
  return (
    <>
      <PageHeader
        title="상품 분류 관리"
        description="사업부별 상품 분류를 추가하고 활성 상태를 관리합니다."
        action={isAdmin ? (
          <Button onClick={() => setEditing({ ...emptyCategory, division })}>
            <Plus size={17} />
            분류 추가
          </Button>
        ) : undefined}
      />
      <div className="mb-4 flex gap-2">
        {divisions.map((x) => (
          <Button
            key={x}
            variant={division === x ? "primary" : "secondary"}
            onClick={() => setDivision(x)}
          >
            {x}
          </Button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : loadError ? (
          <ErrorState retry={() => void loadCategories()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="등록된 상품 분류가 없습니다"
            description="분류 추가 버튼으로 첫 상품 분류를 등록해 주세요."
          />
        ) : (
        <Table>
            <thead>
              <tr>
                <th>분류명</th>
                <th>연결 상품</th>
                <th>상태</th>
                <th className="text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                return (
                  <tr key={c.id}>
                    <td className="font-semibold">{c.name}</td>
                    <td>{c.linked}개</td>
                    <td>
                      <StatusBadge status={c.active ? "active" : "inactive"} />
                    </td>
                    <td>
                      {isAdmin ? <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          disabled={processingId === c.id}
                          onClick={() => {
                            setFormError("");
                            setEditing(c);
                          }}
                        >
                          <Pencil size={15} />
                          수정
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={processingId === c.id}
                          onClick={() => void toggleActive(c)}
                        >
                          {processingId === c.id
                            ? "처리 중..."
                            : c.active
                              ? "비활성화"
                              : "활성화"}
                        </Button>
                      </div> : <span className="block text-right text-sm text-slate-400">조회 전용</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Modal
        open={!!editing}
        onClose={() => !saving && setEditing(null)}
        title={"id" in (editing || {}) ? "분류 수정" : "분류 추가"}
      >
        {editing && (
          <form onSubmit={save} className="space-y-4">
            <Field label="사업부">
              <Select
                value={editing.division}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    division: e.target.value as Division,
                  })
                }
                disabled={"id" in editing}
              >
                {divisions.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label="분류명" required>
              <Input
                name="categoryName"
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                required
                disabled={saving}
                aria-invalid={Boolean(formError && !editing.name.trim())}
                aria-describedby={formError ? "category-form-error" : undefined}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) =>
                  setEditing({ ...editing, active: e.target.checked })
                }
                disabled={saving}
              />{" "}
              활성 상태
            </label>
            {formError && <p id="category-form-error" role="alert" className="text-sm text-red-600">{formError}</p>}
            <Button className="w-full" disabled={saving}>
              {saving ? "저장 중..." : "저장"}
            </Button>
          </form>
        )}
      </Modal>
      {notice && <Toast message={notice} onClose={() => setNotice("")} />}
    </>
  );
}

export function ProductsPage() {
  const d = useData();
  const [q, setQ] = useState("");
  const [division, setDivision] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<Product | Omit<Product, "id"> | null>(
    null,
  );
  const rows = d.products.filter(
    (p) =>
      (!q || p.name.includes(q)) &&
      (!division || p.division === division) &&
      (!category || p.categoryId === category),
  );
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.name || !editing.categoryId) return;
    if ("id" in editing) d.updateProduct(editing);
    else d.addProduct(editing);
    setEditing(null);
  };
  return (
    <>
      <PageHeader
        title="상품 관리"
        description="판매 상품과 기본 판매가를 관리합니다."
        action={
          <Button onClick={() => setEditing({ ...emptyProduct })}>
            <Plus size={17} />
            상품 등록
          </Button>
        }
      />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative">
            <Search
              className="absolute left-3 top-3 text-slate-400"
              size={16}
            />
            <Input
              className="pl-9"
              placeholder="상품명 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select
            value={division}
            onChange={(e) => {
              setDivision(e.target.value);
              setCategory("");
            }}
          >
            <option value="">전체 사업부</option>
            {divisions.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">전체 분류</option>
            {d.categories
              .filter((x) => !division || x.division === division)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </Select>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[850px]">
              <thead>
                <tr>
                  <th>사업부</th>
                  <th>상품 분류</th>
                  <th>상품명</th>
                  <th>기본 판매가</th>
                  <th>상태</th>
                  <th>메모</th>
                  <th className="text-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>{p.division}</td>
                    <td>
                      {d.categories.find((x) => x.id === p.categoryId)?.name}
                    </td>
                    <td className="font-semibold">{p.name}</td>
                    <td>{won(p.defaultPrice)}</td>
                    <td>
                      <Badge tone={p.active ? "green" : "gray"}>
                        {p.active ? "활성" : "비활성"}
                      </Badge>
                    </td>
                    <td>{p.memo || "-"}</td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => setEditing(p)}
                        >
                          <Pencil size={15} />
                          수정
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            d.updateProduct({ ...p, active: !p.active })
                          }
                        >
                          {p.active ? "비활성화" : "활성화"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState />
        )}
      </Card>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={"id" in (editing || {}) ? "상품 수정" : "상품 등록"}
        wide
      >
        {editing && (
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label="사업부" required>
              <Select
                value={editing.division}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    division: e.target.value as Division,
                    categoryId: "",
                  })
                }
              >
                {divisions.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label="상품 분류" required>
              <Select
                value={editing.categoryId}
                onChange={(e) =>
                  setEditing({ ...editing, categoryId: e.target.value })
                }
              >
                <option value="">분류 선택</option>
                {d.categories
                  .filter((x) => x.division === editing.division && x.active)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="상품명" required>
              <Input
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </Field>
            <Field label="기본 판매가" required>
              <Input
                type="number"
                min="0"
                value={editing.defaultPrice}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    defaultPrice: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) =>
                  setEditing({ ...editing, active: e.target.checked })
                }
              />{" "}
              활성 상태
            </label>
            <div className="sm:col-span-2">
              <Field label="메모">
                <Textarea
                  value={editing.memo}
                  onChange={(e) =>
                    setEditing({ ...editing, memo: e.target.value })
                  }
                />
              </Field>
            </div>
            <Button className="sm:col-span-2">저장</Button>
          </form>
        )}
      </Modal>
    </>
  );
}

export function CustomersPage() {
  const d = useData();
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [editing, setEditing] = useState<
    Customer | Omit<Customer, "id"> | null
  >(null);
  const [pet, setPet] = useState<Pet | Omit<Pet, "id"> | null>(null);
  const rows = useMemo(
    () =>
      d.customers
        .filter((c) => !q || c.name.includes(q) || c.phone.includes(q))
        .map((c) => {
          const sales = d.sales.filter(
            (s) => s.customerId === c.id && s.status !== "취소",
          );
          return {
            ...c,
            petList: d.pets.filter((p) => p.customerId === c.id),
            total: sales.reduce(
              (a, s) => a + net(s.payment, s.refund, s.receivable, s.status),
              0,
            ),
            last: [...sales].sort((a, b) => b.date.localeCompare(a.date))[0]
              ?.date,
            count: sales.length,
          };
        }),
    [d, q],
  );
  const saveCustomer = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if ("id" in editing) d.updateCustomer(editing);
    else d.addCustomer(editing);
    setEditing(null);
  };
  const savePet = (e: FormEvent) => {
    e.preventDefault();
    if (!pet) return;
    if ("id" in pet) d.updatePet(pet);
    else d.addPet(pet);
    setPet(null);
  };
  return (
    <>
      <PageHeader
        title="고객·반려견 관리"
        description="보호자와 반려견 정보, 이용 이력을 조회합니다."
        action={
          <Button
            onClick={() =>
              setEditing({
                name: "",
                phone: "",
                memo: "",
                createdAt: new Date().toISOString().slice(0, 10),
              })
            }
          >
            <Plus size={17} />
            고객 추가
          </Button>
        }
      />
      <Card className="mb-4 p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-3 text-slate-400" size={16} />
          <Input
            className="pl-9"
            placeholder="보호자명 또는 연락처 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </Card>
      <Card className="overflow-hidden">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[850px]">
              <thead>
                <tr>
                  <th>보호자명</th>
                  <th>연락처</th>
                  <th>연결된 반려견</th>
                  <th>누적 결제 금액</th>
                  <th>최근 이용일</th>
                  <th>총 이용 횟수</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="font-semibold">{c.name}</td>
                    <td>{c.phone}</td>
                    <td>{c.petList.map((x) => x.name).join(", ") || "-"}</td>
                    <td>{won(c.total)}</td>
                    <td>{c.last ? koDate(c.last) : "-"}</td>
                    <td>{c.count}회</td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          className="icon-btn"
                          onClick={() => setCustomer(c)}
                          title="상세"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => setEditing(c)}
                          title="수정"
                        >
                          <Pencil size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState />
        )}
      </Card>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={"id" in (editing || {}) ? "고객 수정" : "고객 추가"}
      >
        {editing && (
          <form onSubmit={saveCustomer} className="space-y-4">
            <Field label="보호자명" required>
              <Input
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </Field>
            <Field label="연락처" required>
              <Input
                value={editing.phone}
                onChange={(e) =>
                  setEditing({ ...editing, phone: e.target.value })
                }
              />
            </Field>
            <Field label="메모">
              <Textarea
                value={editing.memo}
                onChange={(e) =>
                  setEditing({ ...editing, memo: e.target.value })
                }
              />
            </Field>
            <Button className="w-full">저장</Button>
          </form>
        )}
      </Modal>
      <CustomerDetail
        customer={customer}
        onClose={() => setCustomer(null)}
        onAddPet={() =>
          customer &&
          setPet({
            customerId: customer.id,
            name: "",
            breed: "",
            birthDate: "",
            memo: "",
          })
        }
        onEditPet={setPet}
      />
      <Modal
        open={!!pet}
        onClose={() => setPet(null)}
        title={"id" in (pet || {}) ? "반려견 수정" : "반려견 추가"}
      >
        {pet && (
          <form onSubmit={savePet} className="space-y-4">
            <Field label="반려견명" required>
              <Input
                value={pet.name}
                onChange={(e) => setPet({ ...pet, name: e.target.value })}
              />
            </Field>
            <Field label="견종" required>
              <Input
                value={pet.breed}
                onChange={(e) => setPet({ ...pet, breed: e.target.value })}
              />
            </Field>
            <Field label="생년월일">
              <Input
                type="date"
                value={pet.birthDate}
                onChange={(e) => setPet({ ...pet, birthDate: e.target.value })}
              />
            </Field>
            <Field label="메모">
              <Textarea
                value={pet.memo}
                onChange={(e) => setPet({ ...pet, memo: e.target.value })}
              />
            </Field>
            <Button className="w-full">저장</Button>
          </form>
        )}
      </Modal>
    </>
  );
}

function CustomerDetail({
  customer,
  onClose,
  onAddPet,
  onEditPet,
}: {
  customer: Customer | null;
  onClose: () => void;
  onAddPet: () => void;
  onEditPet: (p: Pet) => void;
}) {
  const d = useData();
  if (!customer) return null;
  const pets = d.pets.filter((p) => p.customerId === customer.id);
  const sales = d.sales
    .filter((s) => s.customerId === customer.id && s.status !== "취소")
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = (division?: Division) =>
    sales
      .filter((s) => !division || s.division === division)
      .reduce(
        (a, s) => a + net(s.payment, s.refund, s.receivable, s.status),
        0,
      );
  const totalPaid = total();
  const recentProduct = sales[0]
    ? d.products.find((p) => p.id === sales[0].productId)?.name || "-"
    : "-";
  return (
    <Modal
      open={!!customer}
      onClose={onClose}
      title={`${customer.name} 고객 상세`}
      wide
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-slate-500">누적 결제 금액</p>
          <b className="mt-1 block text-xl">{won(totalPaid)}</b>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">이용 횟수</p>
          <b className="mt-1 block text-xl">{sales.length}회</b>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">최근 이용일</p>
          <b className="mt-1 block text-base">
            {sales.length ? koDate(sales[0].date) : "-"}
          </b>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">최근 이용 상품</p>
          <b className="mt-1 block truncate text-base" title={recentProduct}>
            {recentProduct}
          </b>
        </Card>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500">
        <span>최초 결제일 {sales.length ? koDate(sales[sales.length - 1].date) : "-"}</span>
        <span>재등록 {sales.filter((s) => s.kind === "재등록").length}회</span>
      </div>
      <div className="mt-5 flex items-center justify-between">
        <h3 className="font-bold">반려견 목록</h3>
        <Button variant="secondary" onClick={onAddPet}>
          <Plus size={15} />
          추가
        </Button>
      </div>
      <div className="mt-2 divide-y rounded-lg border">
        {pets.map((p) => (
          <div className="flex items-center justify-between p-3" key={p.id}>
            <span>
              <b>{p.name}</b>{" "}
              <small className="text-slate-500">{p.breed}</small>
            </span>
            <Button variant="ghost" onClick={() => onEditPet(p)}>
              <Pencil size={15} />
              수정
            </Button>
          </div>
        ))}
      </div>
      <h3 className="mt-5 font-bold">사업부 이용 비율</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {divisions.map((x) => (
          <div className="rounded-lg bg-slate-50 p-3 text-sm" key={x}>
            <div className="flex justify-between gap-2">
              <p className="text-slate-500">{x}</p>
              <b>{totalPaid ? ((total(x) / totalPaid) * 100).toFixed(1) : "0.0"}%</b>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-[#274c77]"
                style={{ width: `${totalPaid ? (total(x) / totalPaid) * 100 : 0}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">{won(total(x))}</p>
          </div>
        ))}
      </div>
      <h3 className="mt-5 font-bold">전체 결제 내역</h3>
      <div className="mt-2 max-h-72 overflow-auto rounded-lg border">
        <table className="data-table">
          <thead>
            <tr><th>일자</th><th>사업부</th><th>상품</th><th className="text-right">실매출</th></tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id}>
                <td>{koDate(s.date)}</td>
                <td>{s.division}</td>
                <td>{d.products.find((p) => p.id === s.productId)?.name}</td>
                <td className="text-right font-semibold">
                  {won(net(s.payment, s.refund, s.receivable, s.status))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function SettingsPage() {
  const d = useData();
  const [settings, setSettings] = useState(d.settings);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <PageHeader
        title="설정"
        description="내부 프로그램의 기본 정보를 관리합니다."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-bold">기본 설정</h2>
          <div className="mt-4 space-y-4">
            <Field label="회사명">
              <Input
                value={settings.companyName}
                onChange={(e) =>
                  setSettings({ ...settings, companyName: e.target.value })
                }
              />
            </Field>
            <Field label="월 기본 목표 매출">
              <Input
                type="number"
                min="0"
                value={settings.defaultGoal}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    defaultGoal: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </Field>
            <Button
              onClick={() => {
                d.updateSettings(settings);
                setSaved(true);
                setTimeout(() => setSaved(false), 1800);
              }}
            >
              설정 저장
            </Button>
            {saved && (
              <span className="ml-3 text-sm text-blue-700">
                저장되었습니다.
              </span>
            )}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-bold">담당자</h2>
          <p className="mt-1 text-sm text-slate-500">
            Phase 1 샘플 데이터에서 사용하는 담당자 목록입니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {settings.staff.map((x) => (
              <Badge key={x} tone="green">
                {x}
              </Badge>
            ))}
          </div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-bold">개발용 샘플 데이터</h2>
          <p className="mt-1 text-sm text-slate-500">
            추가·수정한 샘플 데이터를 초기 상태로 되돌립니다. 이 동작은 취소할
            수 없습니다.
          </p>
          <Button
            variant="danger"
            className="mt-4"
            onClick={() => {
              if (confirm("샘플 데이터를 초기화하시겠습니까?")) d.resetData();
            }}
          >
            <RotateCcw size={16} />
            샘플 데이터 초기화
          </Button>
        </Card>
      </div>
    </>
  );
}
