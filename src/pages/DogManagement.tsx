import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FilterToolbar,
  Input,
  LoadingState,
  Modal,
  ConfirmModal,
  Pagination,
  PageHeader,
  SearchBox,
  Select,
  StatusBadge,
  Table,
  Textarea,
  Toast,
} from "../components/ui";
import { koDate } from "../lib/format";
import { supabase } from "../lib/supabase";
import {
  logSupabaseError,
  partyMutationError,
} from "../lib/supabaseError";
import {
  findCustomerPhoneDuplicate,
  findDogNameDuplicate,
  hasCustomerIdentity,
  normalizeCustomerPhone,
} from "./customerIdentity";
import { CustomerList } from "./Pets";

interface OwnerOption {
  id: string;
  name: string | null;
  phone: string | null;
  is_active: boolean;
}

interface DogRow {
  id: string;
  customerId: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  name: string;
  breed: string | null;
  sex: "male" | "female" | null;
  birthDate: string | null;
  weight: number | null;
  neutered: boolean | null;
  memo: string | null;
  active: boolean;
}

interface DogForm {
  id: string | null;
  customerId: string;
  name: string;
  breed: string;
  sex: "male" | "female" | "";
  birthDate: string;
  weight: string;
  memo: string;
}

interface OwnerForm { name: string; phone: string; memo: string }

const emptyForm = (): DogForm => ({
  id: null,
  customerId: "",
  name: "",
  breed: "",
  sex: "",
  birthDate: "",
  weight: "",
  memo: "",
});

export function PetManagementPage() {
  const { profile } = useAuth();
  const [view, setView] = useState<"dogs" | "customers">("dogs");
  const [dogs, setDogs] = useState<DogRow[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [query, setQuery] = useState("");
  const [breed, setBreed] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DogForm | null>(null);
  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerCreating, setOwnerCreating] = useState(false);
  const [ownerForm, setOwnerForm] = useState<OwnerForm>({ name: "", phone: "", memo: "" });
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [ownerError, setOwnerError] = useState("");
  const [deactivating, setDeactivating] = useState<DogRow | null>(null);
  const [duplicateDog, setDuplicateDog] = useState<DogRow | null>(null);
  const [allowDuplicateDog, setAllowDuplicateDog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const pageSize = 20;

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const [dogsResult, ownersResult] = await Promise.all([
      supabase
        .from("dogs")
        .select("id, customer_id, name, breed, sex, birth_date, weight, neutered, memo, is_active, customers(id, name, phone, is_active)")
        .order("name"),
      supabase
        .from("customers")
        .select("id, name, phone, is_active")
        .eq("is_active", true)
        .order("name"),
    ]);
    if (dogsResult.error) {
      setDogs([]);
      setLoadError("반려견 목록을 불러오지 못했습니다.");
    } else if (ownersResult.error) {
      setDogs([]);
      setLoadError("보호자 목록을 불러오지 못했습니다.");
    } else {
      setDogs(
        (dogsResult.data ?? []).map((dog) => {
          const customer = Array.isArray(dog.customers) ? dog.customers[0] : dog.customers;
          return {
            id: dog.id,
            customerId: dog.customer_id,
            ownerName: customer?.name ?? null,
            ownerPhone: customer?.phone ?? null,
            name: dog.name,
            breed: dog.breed,
            sex: dog.sex as DogRow["sex"],
            birthDate: dog.birth_date,
            weight: dog.weight === null ? null : Number(dog.weight),
            neutered: dog.neutered,
            memo: dog.memo,
            active: dog.is_active,
          };
        }),
      );
      setOwners(ownersResult.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const breeds = useMemo(
    () => [...new Set(dogs.map((dog) => dog.breed).filter((value): value is string => Boolean(value)))].sort(),
    [dogs],
  );
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko");
    return dogs.filter((dog) => {
      const keywordMatch =
        !keyword ||
        [dog.name, dog.ownerName, dog.ownerPhone, dog.breed].some((value) =>
          value?.toLocaleLowerCase("ko").includes(keyword),
        );
      return (
        keywordMatch &&
        (!breed || dog.breed === breed) &&
        (!activeFilter || dog.active === (activeFilter === "active"))
      );
    });
  }, [activeFilter, breed, dogs, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const visibleOwners = useMemo(() => {
    const keyword = ownerSearch.trim().toLocaleLowerCase("ko");
    return owners.filter((owner) => owner.id === editing?.customerId || !keyword || [owner.name, owner.phone].some((value) => value?.toLocaleLowerCase("ko").includes(keyword)));
  }, [editing?.customerId, ownerSearch, owners]);

  const openEdit = (dog: DogRow) => {
    setFormError("");
    setOwnerSearch("");
    setDuplicateDog(null);
    setAllowDuplicateDog(false);
    setEditing({
      id: dog.id,
      customerId: dog.customerId ?? "",
      name: dog.name,
      breed: dog.breed ?? "",
      sex: dog.sex ?? "",
      birthDate: dog.birthDate ?? "",
      weight: dog.weight === null ? "" : String(dog.weight),
      memo: dog.memo ?? "",
    });
  };

  const openOwnerCreate = () => {
    const initial = ownerSearch.trim();
    const looksLikePhone = /^[0-9\-\s]+$/.test(initial);
    setOwnerError("");
    setOwnerForm({ name: looksLikePhone ? "" : initial, phone: looksLikePhone ? initial : "", memo: "" });
    setOwnerCreating(true);
  };

  const saveOwner = async (event: FormEvent) => {
    event.preventDefault();
    if (ownerSaving) return;
    const name = ownerForm.name.trim();
    const phone = normalizeCustomerPhone(ownerForm.phone);
    if (!hasCustomerIdentity(name, phone)) {
      setOwnerError("보호자명 또는 연락처 중 하나는 입력해 주세요.");
      const formElement = event.currentTarget as HTMLFormElement;
      requestAnimationFrame(() => { const field = formElement.elements.namedItem("ownerName"); if (field instanceof HTMLElement) field.focus(); });
      return;
    }
    const duplicate = findCustomerPhoneDuplicate(owners, phone);
    if (duplicate) {
      setEditing((current) => current ? { ...current, customerId: duplicate.id } : current);
      setOwnerSearch(`${duplicate.name || "이름 미등록"} ${duplicate.phone || ""}`.trim());
      setOwnerCreating(false);
      setNotice("동일 연락처의 기존 보호자를 선택했습니다.");
      return;
    }
    setOwnerSaving(true); setOwnerError("");
    const result = await supabase.from("customers").insert({ name: name || null, phone: phone || null, memo: ownerForm.memo.trim() || null, is_active: true }).select("id, name, phone, is_active").single();
    setOwnerSaving(false);
    if (result.error) {
      logSupabaseError("반려견 관리 보호자 등록", result.error, result.status);
      setOwnerError(
        partyMutationError(
          result.error,
          "보호자를 등록하지 못했습니다. 입력 내용을 확인해 주세요.",
        ),
      );
      return;
    }
    const created = result.data;
    setOwners((current) => [...current, created].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko")));
    setEditing((current) => current ? { ...current, customerId: created.id } : current);
    setOwnerSearch(`${created.name || "이름 미등록"} ${created.phone || ""}`.trim());
    setOwnerCreating(false);
    setNotice("새 보호자를 등록하고 자동으로 선택했습니다.");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const formElement = event.currentTarget as HTMLFormElement;
    const focus = (name: string) => requestAnimationFrame(() => { const field = formElement.elements.namedItem(name); if (field instanceof HTMLElement) field.focus(); });
    if (!editing) return;
    if (!editing.name.trim()) {
      setFormError("반려견명을 입력해 주세요.");
      focus("name");
      return;
    }
    if (!editing.id && profile?.role === "staff" && !editing.customerId) {
      setFormError("직원은 보호자를 선택한 뒤 반려견을 등록할 수 있습니다.");
      focus("customerId");
      return;
    }
    const weight = editing.weight === "" ? null : Number(editing.weight);
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
      setFormError("체중은 0보다 큰 값으로 입력해 주세요.");
      focus("weight");
      return;
    }
    if (editing.customerId && !owners.some((owner) => owner.id === editing.customerId)) {
      setFormError("선택한 보호자 정보를 확인할 수 없습니다.");
      focus("customerId");
      return;
    }
    if (!editing.id && !allowDuplicateDog) {
      const duplicate = findDogNameDuplicate(
        dogs,
        editing.customerId,
        editing.name,
      );
      if (duplicate) {
        setDuplicateDog(duplicate);
        setFormError("같은 보호자에게 동일한 이름의 반려견이 있습니다.");
        return;
      }
    }
    const values = {
      customer_id: editing.customerId || null,
      name: editing.name.trim(),
      breed: editing.breed.trim() || null,
      sex: editing.sex || null,
      birth_date: editing.birthDate || null,
      weight,
      memo: editing.memo.trim() || null,
    };
    setSaving(true);
    setFormError("");
    const result = editing.id
      ? await supabase.from("dogs").update(values).eq("id", editing.id).select("id").single()
      : await supabase.from("dogs").insert({ ...values, is_active: true }).select("id").single();
    setSaving(false);
    if (result.error) {
      logSupabaseError(
        editing.id ? "반려견 정보 수정" : "반려견 등록",
        result.error,
        result.status,
      );
      setFormError(
        partyMutationError(
          result.error,
          editing.id
            ? "반려견 정보를 수정하지 못했습니다."
            : "반려견을 저장하지 못했습니다.",
        ),
      );
      return;
    }
    setNotice(editing.id ? "반려견 정보를 수정했습니다." : "반려견을 등록했습니다.");
    setDuplicateDog(null);
    setAllowDuplicateDog(false);
    setEditing(null);
    await loadData();
  };

  const deactivate = async () => {
    if (!deactivating) return;
    setProcessing(true);
    const result = await supabase
      .from("dogs")
      .update({ is_active: false })
      .eq("id", deactivating.id)
      .select("id")
      .single();
    setProcessing(false);
    if (result.error) {
      setNotice(result.error.code === "42501" ? "권한이 없습니다." : "반려견을 비활성화하지 못했습니다.");
      return;
    }
    setDeactivating(null);
    setNotice("반려견을 비활성화했습니다.");
    await loadData();
  };

  return (
    <>
      <PageHeader
        title="반려견 관리"
        description="반려견을 기준으로 보호자 연결 정보와 기본 정보를 관리합니다."
        action={view === "dogs" ? <Button onClick={() => { setFormError(""); setOwnerSearch(""); setDuplicateDog(null); setAllowDuplicateDog(false); setEditing(emptyForm()); }}><Plus size={17} />반려견 등록</Button> : undefined}
      />
      <div className="mb-4 flex gap-2" aria-label="관리 대상 선택">
        <Button variant={view === "dogs" ? "primary" : "secondary"} onClick={() => setView("dogs")}>반려견 목록</Button>
        <Button variant={view === "customers" ? "primary" : "secondary"} onClick={() => setView("customers")}>보호자 목록</Button>
      </div>
      {view === "customers" ? <CustomerList onAddDog={(customer) => { setView("dogs"); setFormError(""); setOwnerSearch(`${customer.name || "이름 미등록"} ${customer.phone || ""}`.trim()); setDuplicateDog(null); setAllowDuplicateDog(false); setEditing({ ...emptyForm(), customerId: customer.id }); }} /> : <>
        <FilterToolbar className="sm:grid-cols-3">
            <SearchBox aria-label="반려견 검색" placeholder="반려견명, 보호자명, 연락처 또는 견종 검색" value={query} onClear={() => { setQuery(""); setPage(1); }} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
            <Select value={breed} onChange={(e) => { setBreed(e.target.value); setPage(1); }}><option value="">전체 견종</option>{breeds.map((item) => <option key={item}>{item}</option>)}</Select>
            <Select value={activeFilter} onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }}><option value="">전체 상태</option><option value="active">활성</option><option value="inactive">비활성</option></Select>
        </FilterToolbar>
        <Card className="overflow-hidden">
          {loading ? <LoadingState /> : loadError ? <ErrorState title={loadError} retry={() => void loadData()} /> : rows.length ? (
            <Table className="min-w-[1100px]">
              <thead><tr><th>반려견명</th><th>보호자명</th><th>연락처</th><th>견종</th><th>성별</th><th>생년월일</th><th>체중</th><th>상태</th><th>메모</th><th className="text-right">관리</th></tr></thead>
              <tbody>{rows.map((dog) => <tr key={dog.id}>
                <td className="font-semibold text-slate-900">{dog.name}</td><td>{dog.ownerName || "미등록"}</td><td>{dog.ownerPhone || "-"}</td><td>{dog.breed || "-"}</td><td>{dog.sex === "male" ? "수컷" : dog.sex === "female" ? "암컷" : "-"}</td><td>{dog.birthDate ? koDate(dog.birthDate) : "-"}</td><td>{dog.weight === null ? "-" : `${dog.weight}kg`}</td><td><StatusBadge status={dog.active ? "active" : "inactive"} /></td><td className="max-w-xs truncate">{dog.memo || "-"}</td>
                <td>{profile?.role === "admin" ? <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => openEdit(dog)}><Pencil size={15} />수정</Button>{dog.active && <Button variant="secondary" onClick={() => setDeactivating(dog)}>비활성화</Button>}</div> : <span className="text-sm text-slate-400">조회 전용</span>}</td>
              </tr>)}</tbody>
            </Table>
          ) : <EmptyState title="등록된 반려견이 없습니다" description="검색 조건을 확인하거나 반려견을 등록해 주세요." />}
        </Card>
        {!loading && !loadError && filtered.length > 0 && <Pagination page={page} totalPages={totalPages} totalLabel={`총 ${filtered.length}마리`} onPageChange={setPage} />}
      </>}
      <Modal open={!!editing && !ownerCreating} onClose={() => !saving && setEditing(null)} title={editing?.id ? "반려견 수정" : "반려견 등록"} wide>
        {editing && <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Field label={profile?.role === "staff" && !editing.id ? "보호자 연결" : "보호자 연결 (선택)"}><SearchBox aria-label="보호자 이름 또는 연락처 검색" placeholder="보호자 이름 또는 연락처 검색" value={ownerSearch} onClear={() => setOwnerSearch("")} onChange={(event) => setOwnerSearch(event.target.value)} /></Field><div className="grid gap-2 sm:grid-cols-[1fr_auto]"><Select className="min-w-0" name="customerId" aria-describedby={formError ? "dog-form-error" : undefined} value={editing.customerId} disabled={saving} onChange={(e) => { setDuplicateDog(null); setAllowDuplicateDog(false); setEditing({ ...editing, customerId: e.target.value }); }}><option value="">보호자 미등록</option>{visibleOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name || "이름 미등록"} · {owner.phone || "연락처 미등록"}</option>)}</Select><Button type="button" variant="secondary" disabled={saving} onClick={openOwnerCreate}><Plus size={16} />새 보호자</Button></div>{ownerSearch.trim() && visibleOwners.length === 0 && <p className="text-sm text-text-muted">검색된 활성 보호자가 없습니다. 새 보호자를 바로 등록할 수 있습니다.</p>}</div>
          <Field label="반려견명" required><Input name="name" aria-invalid={Boolean(formError && !editing.name.trim())} aria-describedby={formError ? "dog-form-error" : undefined} value={editing.name} disabled={saving} onChange={(e) => { setDuplicateDog(null); setAllowDuplicateDog(false); setEditing({ ...editing, name: e.target.value }); }} /></Field>
          <Field label="견종"><Input list="dog-breeds" value={editing.breed} disabled={saving} onChange={(e) => setEditing({ ...editing, breed: e.target.value })} /><datalist id="dog-breeds">{breeds.map((item) => <option key={item} value={item} />)}</datalist></Field>
          <Field label="성별"><Select value={editing.sex} disabled={saving} onChange={(e) => setEditing({ ...editing, sex: e.target.value as DogForm["sex"] })}><option value="">선택</option><option value="male">수컷</option><option value="female">암컷</option></Select></Field>
          <Field label="생년월일"><Input type="date" value={editing.birthDate} disabled={saving} onChange={(e) => setEditing({ ...editing, birthDate: e.target.value })} /></Field>
          <Field label="체중(kg)"><Input name="weight" aria-describedby={formError ? "dog-form-error" : undefined} type="number" min="0.01" step="0.01" value={editing.weight} disabled={saving} onChange={(e) => setEditing({ ...editing, weight: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="메모"><Textarea rows={3} value={editing.memo} disabled={saving} onChange={(e) => setEditing({ ...editing, memo: e.target.value })} /></Field></div>
          {duplicateDog && !allowDuplicateDog && <div className="rounded-xl bg-warning-soft p-3 text-sm text-text-secondary sm:col-span-2"><p>같은 보호자에게 <strong className="text-text-primary">{duplicateDog.name}</strong>이(가) 이미 등록되어 있습니다.</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => { setQuery(duplicateDog.name); setEditing(null); setDuplicateDog(null); }}>기존 반려견 보기</Button><Button type="button" variant="ghost" onClick={() => { setAllowDuplicateDog(true); setFormError(""); }}>그래도 새로 등록</Button></div></div>}
          {formError && <p id="dog-form-error" role="alert" className="text-sm text-error sm:col-span-2">{formError}</p>}<Button className="sm:col-span-2" disabled={saving}>{saving ? "저장 중..." : "저장"}</Button>
        </form>}
      </Modal>
      <Modal open={ownerCreating} onClose={() => !ownerSaving && setOwnerCreating(false)} title="새 보호자 등록">
        <form onSubmit={saveOwner} className="space-y-4">
          <Field label="보호자명" help="이름 또는 연락처 중 하나는 필수입니다."><Input name="ownerName" value={ownerForm.name} disabled={ownerSaving} aria-invalid={Boolean(ownerError && !ownerForm.name.trim() && !ownerForm.phone.trim())} aria-describedby={ownerError ? "owner-create-error" : undefined} onChange={(event) => setOwnerForm({ ...ownerForm, name: event.target.value })} /></Field>
          <Field label="연락처"><Input name="ownerPhone" value={ownerForm.phone} disabled={ownerSaving} aria-invalid={Boolean(ownerError && !ownerForm.name.trim() && !ownerForm.phone.trim())} aria-describedby={ownerError ? "owner-create-error" : undefined} onChange={(event) => setOwnerForm({ ...ownerForm, phone: event.target.value })} /></Field>
          <Field label="메모"><Textarea rows={3} value={ownerForm.memo} disabled={ownerSaving} onChange={(event) => setOwnerForm({ ...ownerForm, memo: event.target.value })} /></Field>
          {ownerError && <p id="owner-create-error" role="alert" className="text-sm text-red-600">{ownerError}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={ownerSaving} onClick={() => setOwnerCreating(false)}>취소</Button><Button disabled={ownerSaving}>{ownerSaving ? "저장 중..." : "보호자 등록"}</Button></div>
        </form>
      </Modal>
      <ConfirmModal open={!!deactivating} onClose={() => setDeactivating(null)} onConfirm={() => void deactivate()} title="반려견 비활성화" confirmLabel="비활성화" processing={processing} description={<><b className="text-slate-900">{deactivating?.name}</b>을 비활성화하시겠습니까? 기존 매출과 이용 이력은 유지됩니다.</>} />
      {notice && <Toast message={notice} onClose={() => setNotice("")} />}
    </>
  );
}
