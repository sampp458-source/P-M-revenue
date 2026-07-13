import { useCallback, useEffect, useState, type FormEvent } from "react";
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
import { won } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Division } from "../types";
import { hasCategoryNameDuplicate, hasProductNameDuplicate } from "./saleRegistrationLogic";

interface CategoryOption {
  id: string;
  business_unit_id: string;
  name: string;
  is_active: boolean;
}

interface ProductRow {
  id: string;
  businessUnitId: string;
  division: Division;
  categoryId: string;
  categoryName: string;
  name: string;
  defaultPrice: number;
  sortOrder: number;
  active: boolean;
  memo: string;
  unitLabel: string;
}

interface ProductForm {
  id: string | null;
  businessUnitId: string;
  categoryId: string;
  name: string;
  defaultPrice: number;
  active: boolean;
  memo: string;
  unitLabel: string;
}

const pageSize = 20;

export function ProductsPage() {
  const { businessUnits, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [editing, setEditing] = useState<ProductForm | null>(null);
  const [deactivating, setDeactivating] = useState<ProductRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [unitLabelSupported, setUnitLabelSupported] = useState(false);

  const loadCategories = useCallback(async () => {
    const result = await supabase
      .from("product_categories")
      .select("id, business_unit_id, name, is_active")
      .order("sort_order")
      .order("name");
    if (result.error) throw result.error;
    setCategories(result.data ?? []);
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const unitLabelCheck = await supabase.from("products").select("unit_label").limit(1);
    const supportsUnitLabel = !unitLabelCheck.error;
    setUnitLabelSupported(supportsUnitLabel);
    let request = supabase
      .from("products")
      .select(
        "id, business_unit_id, category_id, name, default_price, sort_order, is_active, memo, business_units(name), product_categories(name)",
        { count: "exact" },
      )
      .order("sort_order")
      .order("name");
    const unitId = businessUnits.find((unit) => unit.name === division)?.id;
    if (unitId) request = request.eq("business_unit_id", unitId);
    if (categoryId) request = request.eq("category_id", categoryId);
    if (activeFilter) request = request.eq("is_active", activeFilter === "active");
    const safeQuery = query.replace(/[%_]/g, "").trim();
    if (safeQuery) request = request.ilike("name", `%${safeQuery}%`);
    const from = (page - 1) * pageSize;
    const result = await request.range(from, from + pageSize - 1);

    if (result.error) {
      setRows([]);
      setTotalCount(0);
      setLoadError(true);
    } else {
      const unitLabelById = new Map<string, string>();
      if (supportsUnitLabel && (result.data?.length ?? 0) > 0) {
        const unitLabels = await supabase
          .from("products")
          .select("id, unit_label")
          .in("id", (result.data ?? []).map((product) => product.id));
        if (!unitLabels.error) {
          unitLabels.data?.forEach((product) => {
            if (typeof product.unit_label === "string") unitLabelById.set(product.id, product.unit_label);
          });
        }
      }
      setRows(
        (result.data ?? []).map((product) => {
          const unit = Array.isArray(product.business_units)
            ? product.business_units[0]
            : product.business_units;
          const productCategory = Array.isArray(product.product_categories)
            ? product.product_categories[0]
            : product.product_categories;
          return {
            id: product.id,
            businessUnitId: product.business_unit_id,
            division: unit?.name as Division,
            categoryId: product.category_id,
            categoryName: productCategory?.name ?? "-",
            name: product.name,
            defaultPrice: product.default_price,
            sortOrder: product.sort_order,
            active: product.is_active,
            memo: product.memo ?? "",
            unitLabel: unitLabelById.get(product.id) ?? "",
          };
        }),
      );
      setTotalCount(result.count ?? 0);
    }
    setLoading(false);
  }, [activeFilter, businessUnits, categoryId, division, page, query]);

  useEffect(() => {
    void Promise.all([loadProducts(), loadCategories()]).catch(() => {
      setLoadError(true);
      setLoading(false);
    });
  }, [loadCategories, loadProducts]);

  const openCreate = () => {
    setFormError("");
    setEditing({
      id: null,
      businessUnitId: businessUnits[0]?.id ?? "",
      categoryId: "",
      name: "",
      defaultPrice: 0,
      active: true,
      memo: "",
      unitLabel: "",
    });
    setCategoryQuery("");
    setNewCategoryName("");
    setAddingCategory(false);
  };

  const openEdit = (product: ProductRow) => {
    setFormError("");
    setEditing({
      id: product.id,
      businessUnitId: product.businessUnitId,
      categoryId: product.categoryId,
      name: product.name,
      defaultPrice: product.defaultPrice,
      active: product.active,
      memo: product.memo,
      unitLabel: product.unitLabel,
    });
    setCategoryQuery("");
    setNewCategoryName("");
    setAddingCategory(false);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const formElement = event.currentTarget as HTMLFormElement;
    const focus = (name: string) => requestAnimationFrame(() => { const field = formElement.elements.namedItem(name); if (field instanceof HTMLElement) field.focus(); });
    if (!editing) return;
    const unit = businessUnits.find((item) => item.id === editing.businessUnitId);
    const selectedCategory = categories.find((item) => item.id === editing.categoryId);
    if (!unit || !selectedCategory) {
      setFormError("사업부와 상품 분류를 모두 선택해 주세요.");
      focus(!unit ? "businessUnitId" : "categoryId");
      return;
    }
    if (selectedCategory.business_unit_id !== unit.id) {
      setFormError("선택한 상품 분류가 해당 사업부에 속하지 않습니다.");
      focus("categoryId");
      return;
    }
    if (!editing.name.trim()) {
      setFormError("상품명을 입력해 주세요.");
      focus("name");
      return;
    }
    if (!editing.id && hasProductNameDuplicate(rows, unit.id, editing.name)) {
      setFormError("같은 사업부에 동일하거나 공백만 다른 상품명이 이미 존재합니다.");
      focus("name");
      return;
    }
    if (!Number.isFinite(editing.defaultPrice) || editing.defaultPrice < 0) {
      setFormError("기본 판매가는 0원 이상으로 입력해 주세요.");
      focus("defaultPrice");
      return;
    }

    if (editing.unitLabel.trim() && !unitLabelSupported) {
      setFormError("단위 저장 Migration 적용 후 단위를 입력할 수 있습니다.");
      focus("unitLabel");
      return;
    }
    const values = {
      business_unit_id: unit.id,
      category_id: selectedCategory.id,
      name: editing.name.trim(),
      default_price: Math.trunc(editing.defaultPrice),
      memo: editing.memo.trim() || null,
      is_active: editing.active,
      ...(unitLabelSupported ? { unit_label: editing.unitLabel.trim() || null } : {}),
    };
    setSaving(true);
    setFormError("");
    const result = editing.id
      ? await supabase.from("products").update(values).eq("id", editing.id).select("id").single()
      : await supabase
          .from("products")
          .insert({ ...values, sort_order: totalCount + 1 })
          .select("id")
          .single();
    setSaving(false);
    if (result.error) {
      setFormError(
        result.error.code === "23505"
          ? "같은 사업부에 동일한 상품명이 이미 존재합니다."
          : result.error.code === "23503" || result.error.code === "23514"
            ? "사업부, 상품 분류 또는 판매가를 다시 확인해 주세요."
            : "상품을 저장하지 못했습니다. 잠시 후 다시 시도하세요.",
      );
      return;
    }
    setNotice(editing.id ? "상품을 수정했습니다." : "상품을 등록했습니다.");
    setEditing(null);
    await Promise.all([loadProducts(), loadCategories()]);
  };

  const createCategory = async () => {
    if (!editing || categorySaving) return;
    const unit = businessUnits.find((item) => item.id === editing.businessUnitId);
    const name = newCategoryName.trim().replace(/\s+/g, " ");
    if (!unit) { setFormError("사업부를 먼저 선택해 주세요."); return; }
    if (!name) { setFormError("새 분류명을 입력해 주세요."); return; }
    const comparable = categories.map((item) => ({ businessUnitId: item.business_unit_id, name: item.name }));
    if (hasCategoryNameDuplicate(comparable, unit.id, name)) {
      setFormError("같은 사업부에 동일하거나 공백만 다른 분류명이 이미 존재합니다.");
      return;
    }
    setCategorySaving(true);
    setFormError("");
    const result = await supabase.from("product_categories").insert({
      business_unit_id: unit.id,
      name,
      is_active: true,
      sort_order: categories.filter((item) => item.business_unit_id === unit.id).length + 1,
    }).select("id, business_unit_id, name, is_active").single();
    setCategorySaving(false);
    if (result.error) {
      setFormError(result.error.code === "23505"
        ? "같은 사업부에 동일한 분류명이 이미 존재합니다."
        : result.error.code === "42501"
          ? "분류 등록 권한이 없습니다. 직원 분류 등록 정책 적용 여부를 확인해 주세요."
          : "상품 분류를 등록하지 못했습니다. 잠시 후 다시 시도하세요.");
      return;
    }
    setCategories((current) => [...current, result.data].sort((a, b) => a.name.localeCompare(b.name, "ko")));
    setEditing((current) => current ? { ...current, categoryId: result.data.id } : current);
    setCategoryQuery("");
    setNewCategoryName("");
    setAddingCategory(false);
    setNotice("새 상품 분류를 등록하고 선택했습니다.");
  };

  const deactivate = async () => {
    if (!deactivating) return;
    setProcessing(true);
    const result = await supabase
      .from("products")
      .update({ is_active: false })
      .eq("id", deactivating.id)
      .select("id")
      .single();
    setProcessing(false);
    if (result.error) {
      setNotice("상품을 비활성화하지 못했습니다.");
      return;
    }
    setDeactivating(null);
    setNotice("상품을 비활성화했습니다.");
    await loadProducts();
  };

  const selectedUnitId = businessUnits.find((unit) => unit.name === division)?.id;
  const filterCategories = categories.filter(
    (item) => !selectedUnitId || item.business_unit_id === selectedUnitId,
  );
  const formCategories = categories.filter(
    (item) =>
      item.business_unit_id === editing?.businessUnitId &&
      (item.is_active || item.id === editing?.categoryId),
  );
  const searchedFormCategories = formCategories.filter((item) =>
    item.name.toLocaleLowerCase("ko").includes(categoryQuery.trim().toLocaleLowerCase("ko")),
  );

  return (
    <>
      <PageHeader
        title="상품 관리"
        description="판매 상품과 기본 판매가를 관리합니다."
        action={<Button onClick={openCreate}><Plus size={17} />상품 등록</Button>}
      />
      <FilterToolbar className="sm:grid-cols-2 lg:grid-cols-4">
          <SearchBox aria-label="상품명 검색" placeholder="상품명 검색" value={query} onClear={() => { setQuery(""); setPage(1); }} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
          <Select value={division} onChange={(e) => { setDivision(e.target.value); setCategoryId(""); setPage(1); }}>
            <option value="">전체 사업부</option>
            {businessUnits.map((unit) => <option key={unit.id}>{unit.name}</option>)}
          </Select>
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
            <option value="">전체 분류</option>
            {filterCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Select value={activeFilter} onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }}>
            <option value="">전체 상태</option>
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
          </Select>
      </FilterToolbar>
      <Card className="overflow-hidden">
        {loading ? <LoadingState /> : loadError ? (
          <ErrorState retry={() => void Promise.all([loadProducts(), loadCategories()])} />
        ) : rows.length ? (
          <Table className="min-w-[900px]">
              <thead><tr><th>사업부</th><th>상품 분류</th><th>상품명</th><th>기본 판매가</th><th>상태</th><th>메모</th><th className="text-right">관리</th></tr></thead>
              <tbody>{rows.map((product) => (
                <tr key={product.id}>
                  <td>{product.division}</td><td>{product.categoryName}</td><td className="font-semibold">{product.name}</td>
                  <td>{won(product.defaultPrice)}</td><td><StatusBadge status={product.active ? "active" : "inactive"} /></td>
                  <td>{product.memo || "-"}</td>
                  <td>{isAdmin ? <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => openEdit(product)}><Pencil size={15} />수정</Button>{product.active && <Button variant="secondary" onClick={() => setDeactivating(product)}>비활성화</Button>}</div> : <span className="text-sm text-slate-400">조회 전용</span>}</td>
                </tr>
              ))}</tbody>
          </Table>
        ) : <EmptyState title="등록된 상품이 없습니다" description="필터를 확인하거나 상품을 등록해 주세요." />}
      </Card>
      {!loading && !loadError && totalCount > 0 && (
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(totalCount / pageSize))} totalLabel={`총 ${totalCount}개`} onPageChange={setPage} />
      )}
      <Modal open={!!editing} onClose={() => !saving && setEditing(null)} title={editing?.id ? "상품 수정" : "상품 등록"} wide>
        {editing && <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="사업부" required><Select name="businessUnitId" aria-describedby={formError ? "product-form-error" : undefined} value={editing.businessUnitId} disabled={saving} onChange={(e) => setEditing({ ...editing, businessUnitId: e.target.value, categoryId: "" })}><option value="">사업부 선택</option>{businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select></Field>
          <div className="space-y-2"><Field label="상품 분류" required><Input aria-label="상품 분류 검색" placeholder="분류명 검색" value={categoryQuery} disabled={saving || !editing.businessUnitId} onChange={(e) => setCategoryQuery(e.target.value)} /><Select name="categoryId" className="mt-2" aria-describedby={formError ? "product-form-error" : undefined} value={editing.categoryId} disabled={saving || !editing.businessUnitId} onChange={(e) => setEditing({ ...editing, categoryId: e.target.value })}><option value="">분류 선택</option>{searchedFormCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field><Button type="button" variant="ghost" disabled={saving || !editing.businessUnitId} onClick={() => { setAddingCategory((value) => !value); setFormError(""); }}><Plus size={15} />새 분류 추가</Button>{addingCategory && <div className="flex gap-2 rounded-xl bg-slate-50 p-2"><Input aria-label="새 상품 분류명" placeholder="새 분류명" value={newCategoryName} disabled={categorySaving} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createCategory(); } }} /><Button type="button" disabled={categorySaving} onClick={() => void createCategory()}>{categorySaving ? "추가 중..." : "추가"}</Button></div>}</div>
          <Field label="상품명" required><Input name="name" aria-invalid={Boolean(formError && !editing.name.trim())} aria-describedby={formError ? "product-form-error" : undefined} value={editing.name} disabled={saving} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="기본 판매가" required><Input name="defaultPrice" aria-describedby={formError ? "product-form-error" : undefined} type="number" min="0" step="1" value={editing.defaultPrice} disabled={saving} onChange={(e) => setEditing({ ...editing, defaultPrice: Number(e.target.value) })} /></Field>
          <Field label="단위"><Input name="unitLabel" placeholder="예: 박, 회, 개" maxLength={20} value={editing.unitLabel} disabled={saving} onChange={(e) => setEditing({ ...editing, unitLabel: e.target.value })} /><span className="mt-1 block text-xs text-slate-500">선택 입력 · 단위 저장 Migration 적용 후 사용할 수 있습니다.</span></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.active} disabled={saving} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> 활성 상태</label>
          <div className="sm:col-span-2"><Field label="메모"><Textarea value={editing.memo} disabled={saving} onChange={(e) => setEditing({ ...editing, memo: e.target.value })} /></Field></div>
          {formError && <p id="product-form-error" role="alert" className="text-sm text-red-600 sm:col-span-2">{formError}</p>}
          <Button className="sm:col-span-2" disabled={saving}>{saving ? "저장 중..." : "저장"}</Button>
        </form>}
      </Modal>
      <ConfirmModal open={!!deactivating} onClose={() => setDeactivating(null)} onConfirm={() => void deactivate()} title="상품 비활성화" confirmLabel="비활성화" processing={processing} description={<><b className="text-slate-900">{deactivating?.name}</b> 상품을 비활성화하시겠습니까? 과거 매출 데이터는 유지됩니다.</>} />
      {notice && <Toast message={notice} onClose={() => setNotice("")} />}
    </>
  );
}
