import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Eye, Pencil, Plus, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  ConfirmModal,
  LoadingState,
  Pagination,
  PageHeader,
  SearchBox,
  Select,
  StatusBadge,
  Table,
  Textarea,
  Toast,
} from "../components/ui";
import { koDate, net, won } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../lib/supabase";
import { useData } from "../store/DataContext";
import type { Customer, Division, Pet } from "../types";

const divisions: Division[] = ["유치원", "교육센터", "호텔"];

export function PetManagementPage() {
  const d = useData();
  const [view, setView] = useState<"dogs" | "customers">("dogs");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Pet | null>(null);
  const [editing, setEditing] = useState<Pet | Omit<Pet, "id"> | null>(null);
  const [ownerEditing, setOwnerEditing] = useState<
    Customer | Omit<Customer, "id"> | null
  >(null);

  const rows = useMemo(
    () =>
      d.pets
        .filter((pet) => {
          const owner = d.customers.find(
            (customer) => customer.id === pet.customerId,
          );
          const keyword = query.trim();
          return (
            !keyword ||
            pet.name.includes(keyword) ||
            owner?.name.includes(keyword) ||
            owner?.phone.includes(keyword)
          );
        })
        .map((pet) => {
          const owner = d.customers.find(
            (customer) => customer.id === pet.customerId,
          );
          const sales = d.sales.filter(
            (sale) => sale.petId === pet.id && sale.status !== "취소",
          );
          return {
            pet,
            owner,
            total: sales.reduce(
              (sum, sale) =>
                sum +
                net(sale.payment, sale.refund, sale.receivable, sale.status),
              0,
            ),
            recent: [...sales].sort((a, b) => b.date.localeCompare(a.date))[0]
              ?.date,
            count: sales.length,
          };
        }),
    [d, query],
  );

  const savePet = (event: FormEvent) => {
    event.preventDefault();
    if (!editing?.name || !editing.customerId) return;
    if ("id" in editing) d.updatePet(editing);
    else d.addPet(editing);
    setEditing(null);
  };
  const saveOwner = (event: FormEvent) => {
    event.preventDefault();
    if (!ownerEditing?.name || !ownerEditing.phone) return;
    if ("id" in ownerEditing) d.updateCustomer(ownerEditing);
    else {
      const owner = d.addCustomer(ownerEditing);
      setEditing((pet) => (pet ? { ...pet, customerId: owner.id } : pet));
    }
    setOwnerEditing(null);
  };

  if (view === "customers") {
    return (
      <>
        <PageHeader
          title="반려견 관리"
          description="반려견 업무에 연결되는 보호자 정보를 관리합니다."
        />
        <ManagementViewSwitch view={view} onChange={setView} />
        <CustomerList />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="반려견 관리"
        description="반려견을 기준으로 보호자 정보와 전체 이용 이력을 조회합니다."
        action={
          <Button
            onClick={() =>
              setEditing({
                customerId: "",
                name: "",
                breed: "",
                birthDate: "",
                sex: "",
                weight: 0,
                memo: "",
              })
            }
          >
            <Plus size={17} />
            반려견 등록
          </Button>
        }
      />
      <ManagementViewSwitch view={view} onChange={setView} />
      <Card className="mb-4 p-4">
        <div className="relative max-w-lg">
          <Search className="absolute left-3 top-3 text-slate-400" size={16} />
          <Input
            className="pl-9"
            placeholder="반려견명, 보호자명 또는 연락처 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </Card>
      <Card className="overflow-hidden">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[980px]">
              <thead>
                <tr>
                  <th>반려견명</th>
                  <th>보호자</th>
                  <th>연락처</th>
                  <th>견종</th>
                  <th>성별</th>
                  <th>누적 이용금액</th>
                  <th>최근 이용일</th>
                  <th>이용 횟수</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ pet, owner, total, recent, count }) => (
                  <tr key={pet.id}>
                    <td className="text-base font-bold text-slate-900">
                      {pet.name}
                    </td>
                    <td>{owner?.name || "-"}</td>
                    <td>{owner?.phone || "-"}</td>
                    <td>{pet.breed || "-"}</td>
                    <td>{pet.sex || "-"}</td>
                    <td className="font-semibold">{won(total)}</td>
                    <td>{recent ? koDate(recent) : "-"}</td>
                    <td>{count}회</td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          className="icon-btn"
                          title="반려견 상세"
                          onClick={() => setSelected(pet)}
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title="반려견 수정"
                          onClick={() => setEditing(pet)}
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
          <EmptyState
            title="등록된 반려견이 없습니다"
            description="검색어를 확인하거나 새 반려견을 등록해 주세요."
          />
        )}
      </Card>
      <PetFormModal
        pet={editing}
        onClose={() => setEditing(null)}
        onChange={setEditing}
        onSubmit={savePet}
        onAddOwner={() =>
          setOwnerEditing({
            name: "",
            phone: "",
            memo: "",
            createdAt: new Date().toISOString().slice(0, 10),
          })
        }
      />
      <OwnerModal
        owner={ownerEditing}
        onClose={() => setOwnerEditing(null)}
        onChange={setOwnerEditing}
        onSubmit={saveOwner}
      />
      <PetDetail
        pet={selected}
        onClose={() => setSelected(null)}
        onEditPet={() => selected && setEditing(selected)}
        onEditOwner={(owner) => setOwnerEditing(owner)}
      />
    </>
  );
}

function ManagementViewSwitch({
  view,
  onChange,
}: {
  view: "dogs" | "customers";
  onChange: (view: "dogs" | "customers") => void;
}) {
  return (
    <div className="mb-4 flex gap-2" aria-label="관리 대상 선택">
      <Button
        variant={view === "dogs" ? "primary" : "secondary"}
        onClick={() => onChange("dogs")}
      >
        반려견 목록
      </Button>
      <Button
        variant={view === "customers" ? "primary" : "secondary"}
        onClick={() => onChange("customers")}
      >
        보호자 목록
      </Button>
    </div>
  );
}

interface CustomerRow {
  id: string;
  name: string | null;
  phone: string | null;
  memo: string | null;
  is_active: boolean;
  created_at: string;
}

export function CustomerList() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const pageSize = 10;
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRow | null>(null);
  const [deactivatingCustomer, setDeactivatingCustomer] = useState<CustomerRow | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", memo: "" });

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(false);
    let request = supabase
      .from("customers")
      .select("id, name, phone, memo, is_active, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false });
    const safeKeyword = appliedSearch.replace(/[%_,().]/g, "").trim();
    if (safeKeyword) {
      request = request.or(
        `name.ilike.%${safeKeyword}%,phone.ilike.%${safeKeyword}%`,
      );
    }
    const from = (page - 1) * pageSize;
    const result = await request.range(from, from + pageSize - 1);

    if (result.error) {
      setCustomers([]);
      setTotalCount(0);
      setError(true);
    } else {
      setCustomers(result.data ?? []);
      setTotalCount(result.count ?? 0);
    }
    setLoading(false);
  }, [appliedSearch, page]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const saveCustomer = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name && !phone) {
      setSaveError("보호자명 또는 연락처 중 하나는 입력해 주세요.");
      const formElement = event.currentTarget as HTMLFormElement;
      requestAnimationFrame(() => { const field = formElement.elements.namedItem("customerName"); if (field instanceof HTMLElement) field.focus(); });
      return;
    }

    setSaving(true);
    setSaveError("");
    const values = {
      name: name || null,
      phone: phone || null,
      memo: form.memo.trim() || null,
    };
    const result = editingCustomer
      ? await supabase
          .from("customers")
          .update(values)
          .eq("id", editingCustomer.id)
          .select("id")
          .single()
      : await supabase.from("customers").insert(values).select("id").single();
    setSaving(false);

    if (result.error) {
      setSaveError(
        editingCustomer
          ? "보호자 정보를 수정하지 못했습니다. 입력 내용을 확인해 주세요."
          : "보호자를 등록하지 못했습니다. 입력 내용을 확인해 주세요.",
      );
      return;
    }

    setCreating(false);
    setEditingCustomer(null);
    setForm({ name: "", phone: "", memo: "" });
    setNotice(editingCustomer ? "보호자 정보를 수정했습니다." : "보호자를 등록했습니다.");
    await loadCustomers();
  };

  const deactivateCustomer = async () => {
    if (!deactivatingCustomer) return;
    setDeactivating(true);
    const result = await supabase
      .from("customers")
      .update({ is_active: false })
      .eq("id", deactivatingCustomer.id)
      .select("id")
      .single();
    setDeactivating(false);

    if (result.error) {
      setNotice("보호자를 비활성화하지 못했습니다.");
      return;
    }

    setDeactivatingCustomer(null);
    setNotice("보호자를 비활성화했습니다.");
    await loadCustomers();
  };

  return (
    <>
      <Card className="mb-4 p-4">
        <form
          className="flex max-w-lg gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setAppliedSearch(search.trim());
          }}
        >
          <SearchBox
              className="flex-1"
              aria-label="보호자 검색"
              placeholder="보호자명 또는 연락처 검색"
              value={search}
              onClear={() => { setSearch(""); setAppliedSearch(""); setPage(1); }}
              onChange={(event) => setSearch(event.target.value)}
            />
          <Button type="submit" variant="secondary">
            검색
          </Button>
        </form>
      </Card>
      <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-bold text-slate-900">보호자 목록</h2>
          <p className="mt-1 text-xs text-slate-500">
            검색 결과 보호자 {totalCount}명
          </p>
        </div>
        {isAdmin && <Button onClick={() => setCreating(true)}>
          <Plus size={17} />
          보호자 등록
        </Button>}
      </div>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState retry={() => void loadCustomers()} />
      ) : customers.length ? (
        <Table className="min-w-[760px]">
            <thead>
              <tr>
                <th>보호자명</th>
                <th>연락처</th>
                <th>메모</th>
                <th>상태</th>
                <th>등록일</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td className="font-semibold text-slate-900">
                    {customer.name || "이름 미등록"}
                  </td>
                  <td>{customer.phone || "연락처 미등록"}</td>
                  <td className="max-w-xs truncate">{customer.memo || "-"}</td>
                  <td>
                    <StatusBadge status={customer.is_active ? "active" : "inactive"} tone={customer.is_active ? "blue" : "gray"} />
                  </td>
                  <td>{koDate(customer.created_at)}</td>
                  <td>
                    {isAdmin ? <div className="flex items-center gap-2">
                      <button
                        className="icon-btn"
                        title="보호자 수정"
                        onClick={() => {
                          setEditingCustomer(customer);
                          setSaveError("");
                          setForm({
                            name: customer.name || "",
                            phone: customer.phone || "",
                            memo: customer.memo || "",
                          });
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      {customer.is_active && (
                        <Button
                          variant="secondary"
                          className="min-h-8 px-2 py-1 text-xs"
                          onClick={() => setDeactivatingCustomer(customer)}
                        >
                          비활성화
                        </Button>
                      )}
                    </div> : <span className="text-sm text-slate-400">조회 전용</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
      ) : (
        <EmptyState
          title="등록된 보호자가 없습니다"
          description="보호자를 등록하면 이 목록에서 확인할 수 있습니다."
        />
      )}
      {!loading && !error && totalCount > 0 && (
        <div className="border-t border-slate-200 px-5 pb-4"><Pagination page={page} totalPages={Math.max(1, Math.ceil(totalCount / pageSize))} totalLabel={`총 ${totalCount}명`} onPageChange={setPage} /></div>
      )}
      <Modal
        open={creating || !!editingCustomer}
        onClose={() => {
          if (saving) return;
          setCreating(false);
          setEditingCustomer(null);
          setSaveError("");
          setForm({ name: "", phone: "", memo: "" });
        }}
        title={editingCustomer ? "보호자 수정" : "보호자 등록"}
      >
        <form onSubmit={saveCustomer} className="space-y-4">
          <Field label="보호자명" help="이름 또는 연락처 중 하나는 필수입니다.">
            <Input
              name="customerName"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              disabled={saving}
              aria-invalid={Boolean(saveError && !form.name.trim() && !form.phone.trim())}
              aria-describedby={saveError ? "customer-form-error" : undefined}
            />
          </Field>
          <Field label="연락처">
            <Input
              name="customerPhone"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              disabled={saving}
              aria-invalid={Boolean(saveError && !form.name.trim() && !form.phone.trim())}
              aria-describedby={saveError ? "customer-form-error" : undefined}
            />
          </Field>
          <Field label="메모">
            <Textarea
              value={form.memo}
              onChange={(event) => setForm({ ...form, memo: event.target.value })}
              disabled={saving}
            />
          </Field>
          {saveError && <p id="customer-form-error" role="alert" className="text-sm text-red-600">{saveError}</p>}
          <Button className="w-full" disabled={saving}>
            {saving ? "저장 중..." : "저장"}
          </Button>
        </form>
      </Modal>
      <ConfirmModal open={!!deactivatingCustomer} onClose={() => setDeactivatingCustomer(null)} onConfirm={() => void deactivateCustomer()} title="보호자 비활성화" confirmLabel="비활성화" processing={deactivating} description={<><b className="text-slate-900">{deactivatingCustomer?.name || "이름 미등록 보호자"}</b>를 비활성화하시겠습니까? 연결된 반려견과 과거 매출 정보는 유지됩니다.</>} />
        {notice && <Toast message={notice} onClose={() => setNotice("")} />}
      </Card>
    </>
  );
}

function PetFormModal({
  pet,
  onClose,
  onChange,
  onSubmit,
  onAddOwner,
}: {
  pet: Pet | Omit<Pet, "id"> | null;
  onClose: () => void;
  onChange: (pet: Pet | Omit<Pet, "id"> | null) => void;
  onSubmit: (event: FormEvent) => void;
  onAddOwner: () => void;
}) {
  const d = useData();
  return (
    <Modal
      open={!!pet}
      onClose={onClose}
      title={pet && "id" in pet ? "반려견 수정" : "반려견 등록"}
      wide
    >
      {pet && (
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="보호자" required>
              <div className="flex gap-2">
                <Select
                  value={pet.customerId}
                  onChange={(event) =>
                    onChange({ ...pet, customerId: event.target.value })
                  }
                >
                  <option value="">보호자 선택</option>
                  {d.customers.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name} · {owner.phone}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="secondary" onClick={onAddOwner}>
                  <Plus size={16} />
                  신규
                </Button>
              </div>
            </Field>
          </div>
          <Field label="반려견명" required>
            <Input
              value={pet.name}
              onChange={(event) =>
                onChange({ ...pet, name: event.target.value })
              }
            />
          </Field>
          <Field label="견종">
            <Input
              value={pet.breed}
              onChange={(event) =>
                onChange({ ...pet, breed: event.target.value })
              }
            />
          </Field>
          <Field label="성별">
            <Select
              value={pet.sex || ""}
              onChange={(event) =>
                onChange({ ...pet, sex: event.target.value as Pet["sex"] })
              }
            >
              <option value="">선택</option>
              <option>수컷</option>
              <option>암컷</option>
            </Select>
          </Field>
          <Field label="생년월일">
            <Input
              type="date"
              value={pet.birthDate}
              onChange={(event) =>
                onChange({ ...pet, birthDate: event.target.value })
              }
            />
          </Field>
          <Field label="체중(kg)">
            <Input
              type="number"
              min="0"
              step="0.1"
              value={pet.weight || 0}
              onChange={(event) =>
                onChange({
                  ...pet,
                  weight: Math.max(0, Number(event.target.value) || 0),
                })
              }
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="메모">
              <Textarea
                rows={3}
                value={pet.memo}
                onChange={(event) =>
                  onChange({ ...pet, memo: event.target.value })
                }
              />
            </Field>
          </div>
          <Button className="sm:col-span-2">저장</Button>
        </form>
      )}
    </Modal>
  );
}

function OwnerModal({
  owner,
  onClose,
  onChange,
  onSubmit,
}: {
  owner: Customer | Omit<Customer, "id"> | null;
  onClose: () => void;
  onChange: (owner: Customer | Omit<Customer, "id"> | null) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Modal
      open={!!owner}
      onClose={onClose}
      title={owner && "id" in owner ? "보호자 정보 수정" : "신규 보호자 추가"}
    >
      {owner && (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="보호자명" required>
            <Input
              value={owner.name}
              onChange={(event) =>
                onChange({ ...owner, name: event.target.value })
              }
            />
          </Field>
          <Field label="연락처" required>
            <Input
              value={owner.phone}
              onChange={(event) =>
                onChange({ ...owner, phone: event.target.value })
              }
            />
          </Field>
          <Field label="메모">
            <Textarea
              value={owner.memo}
              onChange={(event) =>
                onChange({ ...owner, memo: event.target.value })
              }
            />
          </Field>
          <Button className="w-full">저장</Button>
        </form>
      )}
    </Modal>
  );
}

function PetDetail({
  pet,
  onClose,
  onEditPet,
  onEditOwner,
}: {
  pet: Pet | null;
  onClose: () => void;
  onEditPet: () => void;
  onEditOwner: (owner: Customer) => void;
}) {
  const d = useData();
  if (!pet) return null;
  const owner = d.customers.find((customer) => customer.id === pet.customerId);
  const sales = d.sales
    .filter((sale) => sale.petId === pet.id && sale.status !== "취소")
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = sales.reduce(
    (sum, sale) =>
      sum + net(sale.payment, sale.refund, sale.receivable, sale.status),
    0,
  );
  const divisionTotal = (division: Division) =>
    sales
      .filter((sale) => sale.division === division)
      .reduce(
        (sum, sale) =>
          sum + net(sale.payment, sale.refund, sale.receivable, sale.status),
        0,
      );
  return (
    <Modal open={!!pet} onClose={onClose} title={`${pet.name} 상세`} wide>
      <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-slate-900">{pet.name}</h3>
            <p className="mt-1 text-sm text-slate-600">
              보호자 {owner?.name || "-"} · {owner?.phone || "-"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onEditPet}>
              <Pencil size={15} />
              반려견 수정
            </Button>
            {owner && (
              <Button variant="secondary" onClick={() => onEditOwner(owner)}>
                <Pencil size={15} />
                보호자 수정
              </Button>
            )}
          </div>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["견종", pet.breed || "-"],
          ["성별", pet.sex || "-"],
          ["생년월일", pet.birthDate ? koDate(pet.birthDate) : "-"],
          ["체중", pet.weight ? `${pet.weight.toFixed(1)}kg` : "-"],
          ["메모", pet.memo || "-"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-1 font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-slate-500">누적 이용금액</p>
          <b className="mt-1 block text-xl">{won(total)}</b>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">최근 이용일</p>
          <b className="mt-1 block text-base">
            {sales[0] ? koDate(sales[0].date) : "-"}
          </b>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">이용 횟수</p>
          <b className="mt-1 block text-xl">{sales.length}회</b>
        </Card>
      </div>
      <h3 className="mt-5 font-bold">이용 사업부</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {divisions.map((division) => (
          <div key={division} className="rounded-lg bg-slate-50 p-3">
            <div className="flex justify-between text-sm">
              <span>{division}</span>
              <b>
                {total
                  ? `${((divisionTotal(division) / total) * 100).toFixed(1)}%`
                  : "0.0%"}
              </b>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-[#274c77]"
                style={{
                  width: `${total ? (divisionTotal(division) / total) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {won(divisionTotal(division))}
            </p>
          </div>
        ))}
      </div>
      <h3 className="mt-5 font-bold">전체 매출 내역</h3>
      <div className="mt-2 max-h-72 overflow-auto rounded-lg border">
        {sales.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>일자</th>
                <th>사업부</th>
                <th>상품</th>
                <th>구분</th>
                <th className="text-right">실매출</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td>{koDate(sale.date)}</td>
                  <td>{sale.division}</td>
                  <td>
                    {d.products.find((product) => product.id === sale.productId)
                      ?.name || "-"}
                  </td>
                  <td>
                    <Badge tone={sale.kind === "신규" ? "blue" : "green"}>
                      {sale.kind}
                    </Badge>
                  </td>
                  <td className="text-right font-semibold">
                    {won(
                      net(
                        sale.payment,
                        sale.refund,
                        sale.receivable,
                        sale.status,
                      ),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="매출 내역이 없습니다" />
        )}
      </div>
    </Modal>
  );
}
