import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Eye, Pencil, Undo2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Card,
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

interface SaleRow {
  id: string;
  saleDate: string;
  businessUnitId: string;
  businessUnitName: string;
  dogName: string;
  customerName: string | null;
  categoryName: string;
  productName: string;
  originalAmount: number;
  discountAmount: number;
  paidAmount: number;
  refundAmount: number;
  outstandingAmount: number;
  netAmount: number;
  paymentMethod: string;
  customerType: string;
  status: string;
  staffName: string | null;
  memo: string | null;
  createdBy: string;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

interface HistoryRow { id: string; action: string; previousData: unknown; changedData: unknown; changedBy: string; createdAt: string }

const paymentLabel: Record<string, string> = { card: "카드", transfer: "계좌이체", cash: "현금", outstanding: "미수" };
const statusLabel: Record<string, string> = { normal: "정상", partial_refund: "부분환불", full_refund: "전체환불", cancelled: "취소" };

export function SalesHistoryPage() {
  const { profile } = useAuth();
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");
  const [unitId, setUnitId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
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

  const loadSales = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [result, profilesResult] = await Promise.all([supabase
      .from("sales")
      .select("id, sale_date, business_unit_id, business_unit_name, dog_name, customer_name, product_category_name, product_name, original_amount, discount_amount, paid_amount, refund_amount, outstanding_amount, net_amount, payment_method, customer_type, status, staff_name, memo, created_by, cancellation_reason, created_at, updated_at, cancelled_at")
      .order("sale_date", { ascending: false })
      .order("created_at", { ascending: false }), supabase.rpc("get_staff_history_directory")]);
    if (result.error) {
      setSales([]);
      setLoadError(true);
    } else {
      setSales((result.data ?? []).map((sale) => ({
        id: sale.id, saleDate: sale.sale_date, businessUnitId: sale.business_unit_id, businessUnitName: sale.business_unit_name,
        dogName: sale.dog_name || "(반려견 없음)", customerName: sale.customer_name, categoryName: sale.product_category_name, productName: sale.product_name,
        originalAmount: sale.original_amount, discountAmount: sale.discount_amount, paidAmount: sale.paid_amount, refundAmount: sale.refund_amount,
        outstandingAmount: sale.outstanding_amount, netAmount: sale.net_amount, paymentMethod: sale.payment_method, customerType: sale.customer_type,
        status: sale.status, staffName: sale.staff_name, memo: sale.memo, createdBy: sale.created_by, cancellationReason: sale.cancellation_reason, createdAt: sale.created_at, updatedAt: sale.updated_at, cancelledAt: sale.cancelled_at,
      })));
    }
    if (!profilesResult.error) setProfileNames(Object.fromEntries((profilesResult.data ?? []).map((row: { id: string; name: string }) => [row.id, row.name])));
    setLoading(false);
  }, []);

  useEffect(() => { void loadSales(); }, [loadSales]);

  const units = useMemo(() => [...new Map(sales.map((sale) => [sale.businessUnitId, sale.businessUnitName])).entries()], [sales]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko");
    return sales.filter((sale) =>
      (!month || sale.saleDate.startsWith(month)) &&
      (!unitId || sale.businessUnitId === unitId) &&
      (!status || sale.status === status) &&
      (!keyword || [sale.dogName, sale.customerName, sale.categoryName, sale.productName, sale.staffName].some((value) => value?.toLocaleLowerCase("ko").includes(keyword))),
    );
  }, [month, query, sales, status, unitId]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const canEdit = (sale: SaleRow) => (profile?.role === "admin" && sale.status !== "cancelled") || (sale.createdBy === profile?.id && sale.status === "normal");
  const mapError = (message: string, code?: string) =>
    code === "42501" ? "권한이 없습니다." : message.includes("마감된 월") ? "마감된 월의 매출은 변경할 수 없습니다." : "매출 정보를 변경하지 못했습니다.";

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!editing) return;
    const expected = Math.max(editing.originalAmount - editing.discountAmount, 0);
    if ([editing.originalAmount, editing.discountAmount, editing.paidAmount, editing.outstandingAmount].some((value) => value < 0) || editing.discountAmount > editing.originalAmount || editing.paidAmount + editing.outstandingAmount > expected) {
      setActionError("금액 관계를 확인해 주세요. 결제액과 미수금 합계는 할인 후 예정액을 초과할 수 없습니다.");
      return;
    }
    setSaving(true); setActionError("");
    const result = await supabase.from("sales").update({ sale_date: editing.saleDate, original_amount: Math.trunc(editing.originalAmount), discount_amount: Math.trunc(editing.discountAmount), paid_amount: Math.trunc(editing.paidAmount), outstanding_amount: Math.trunc(editing.outstandingAmount), payment_method: editing.paymentMethod, customer_type: editing.customerType, memo: editing.memo?.trim() || null }).eq("id", editing.id).select("id").single();
    setSaving(false);
    if (result.error) { setActionError(mapError(result.error.message, result.error.code)); return; }
    setEditing(null); setNotice("매출 정보를 수정했습니다."); await loadSales();
  };

  const applyRefund = async () => {
    if (!refunding) return;
    if (refundAmount <= 0 || refundAmount > refunding.paidAmount) { setActionError("환불 금액은 0원보다 크고 결제 금액 이하여야 합니다."); return; }
    setSaving(true); setActionError("");
    const result = await supabase.from("sales").update({ refund_amount: Math.trunc(refundAmount) }).eq("id", refunding.id).select("id").single();
    setSaving(false);
    if (result.error) { setActionError(mapError(result.error.message, result.error.code)); return; }
    setRefunding(null); setNotice(refundAmount === refunding.paidAmount ? "전액 환불을 처리했습니다." : "부분 환불을 처리했습니다."); await loadSales();
  };

  const cancelSale = async () => {
    if (!cancelling) return;
    if (!cancellationReason.trim()) { setActionError("취소 사유를 입력해 주세요."); return; }
    setSaving(true); setActionError("");
    const result = await supabase.from("sales").update({ status: "cancelled", cancellation_reason: cancellationReason.trim() }).eq("id", cancelling.id).select("id").single();
    setSaving(false);
    if (result.error) { setActionError(mapError(result.error.message, result.error.code)); return; }
    setCancelling(null); setCancellationReason(""); setNotice("매출을 취소했습니다."); await loadSales();
  };

  const openDetail = async (sale: SaleRow) => {
    setSelected(sale); setHistory([]); setHistoryLoading(true); setHistoryError(false);
    const result = await supabase.from("sale_history").select("id, action, previous_data, changed_data, changed_by, created_at").eq("sale_id", sale.id).order("created_at", { ascending: true });
    if (result.error) setHistoryError(true);
    else setHistory((result.data ?? []).map((row) => ({ id: row.id, action: row.action, previousData: row.previous_data, changedData: row.changed_data, changedBy: row.changed_by, createdAt: row.created_at })));
    setHistoryLoading(false);
  };

  const reopenSale = async () => {
    if (!reopening) return;
    setSaving(true); setActionError("");
    const result = await supabase.from("sales").update({ status: "normal" }).eq("id", reopening.id).select("id").single();
    setSaving(false);
    if (result.error) { setActionError(mapError(result.error.message, result.error.code)); return; }
    setReopening(null); setNotice("취소된 매출을 복구했습니다."); await loadSales();
  };

  return <>
    <PageHeader title="매출 내역" description="등록된 매출을 조회하고 권한 범위에서 수정·환불·취소합니다." />
    <FilterToolbar className="sm:grid-cols-2 lg:grid-cols-4">
      <SearchBox aria-label="매출 내역 검색" placeholder="반려견, 보호자, 상품 또는 담당자 검색" value={query} onClear={() => { setQuery(""); setPage(1); }} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
      <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }} />
      <Select value={unitId} onChange={(e) => { setUnitId(e.target.value); setPage(1); }}><option value="">전체 사업부</option>{units.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
      <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">전체 상태</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
    </FilterToolbar>
    <Card className="overflow-hidden">{loading ? <LoadingState /> : loadError ? <ErrorState title="매출 내역을 불러오지 못했습니다." retry={() => void loadSales()} /> : rows.length ? <Table className="min-w-[1450px]">
      <thead><tr><th>매출 일자</th><th>사업부</th><th>반려견</th><th>보호자</th><th>상품 분류</th><th>상품명</th><th>구분</th><th>정상가</th><th>할인</th><th>결제</th><th>환불</th><th>미수금</th><th>실매출</th><th>결제수단</th><th>담당자</th><th>상태</th><th className="text-right">관리</th></tr></thead>
      <tbody>{rows.map((sale) => <tr key={sale.id}><td>{koDate(sale.saleDate)}</td><td>{sale.businessUnitName}</td><td className="font-semibold">{sale.dogName}</td><td>{sale.customerName || "미등록"}</td><td>{sale.categoryName}</td><td>{sale.productName}</td><td>{sale.customerType === "new" ? "신규" : "재등록"}</td><td>{won(sale.originalAmount)}</td><td>{won(sale.discountAmount)}</td><td>{won(sale.paidAmount)}</td><td>{won(sale.refundAmount)}</td><td>{won(sale.outstandingAmount)}</td><td className="font-semibold">{won(sale.netAmount)}</td><td>{paymentLabel[sale.paymentMethod]}</td><td>{sale.staffName || "-"}</td><td><StatusBadge status={sale.status as "normal" | "partial_refund" | "full_refund" | "cancelled"} /></td><td><div className="flex justify-end gap-1"><button className="icon-btn" title="상세" onClick={() => void openDetail(sale)}><Eye size={16} /></button>{canEdit(sale) && <button className="icon-btn" title="수정" onClick={() => { setActionError(""); setEditing({ ...sale }); }}><Pencil size={16} /></button>}{profile?.role === "admin" && sale.status !== "cancelled" && <><Button className="min-h-8 px-2 py-1 text-xs" variant="secondary" disabled={sale.refundAmount >= sale.paidAmount} onClick={() => { setActionError(""); setRefundAmount(sale.refundAmount || 0); setRefunding(sale); }}>환불</Button><Button className="min-h-8 px-2 py-1 text-xs" variant="secondary" onClick={() => { setActionError(""); setCancellationReason(""); setCancelling(sale); }}><Undo2 size={14} />취소</Button></>}{profile?.role === "admin" && sale.status === "cancelled" && <Button className="min-h-8 px-2 py-1 text-xs" variant="secondary" onClick={() => { setActionError(""); setReopening(sale); }}>취소 복구</Button>}</div></td></tr>)}</tbody>
    </Table> : <EmptyState title="조회된 매출이 없습니다" description="필터 조건을 확인해 주세요." />}</Card>
    {!loading && !loadError && filtered.length > 0 && <Pagination page={page} totalPages={totalPages} totalLabel={`총 ${filtered.length}건`} onPageChange={setPage} />}
    <Modal open={!!selected} onClose={() => setSelected(null)} title="매출 상세" wide>{selected && <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Detail label="사업부" value={selected.businessUnitName} /><Detail label="반려견" value={selected.dogName} /><Detail label="보호자" value={selected.customerName || "미등록"} /><Detail label="상품 분류" value={selected.categoryName} /><Detail label="상품" value={selected.productName} /><Detail label="판매가" value={won(selected.originalAmount)} /><Detail label="할인액" value={won(selected.discountAmount)} /><Detail label="결제액" value={won(selected.paidAmount)} /><Detail label="미수금" value={won(selected.outstandingAmount)} /><Detail label="환불액" value={won(selected.refundAmount)} /><Detail label="실매출" value={won(selected.netAmount)} /><Detail label="결제수단" value={paymentLabel[selected.paymentMethod] || selected.paymentMethod} /><Detail label="등록자" value={profileNames[selected.createdBy] || "-"} /><Detail label="담당자" value={selected.staffName || "-"} /><Detail label="등록일" value={new Date(selected.createdAt).toLocaleString("ko-KR")} /><Detail label="수정일" value={new Date(selected.updatedAt).toLocaleString("ko-KR")} /><Detail label="취소 여부" value={selected.status === "cancelled" ? `취소 (${selected.cancelledAt ? new Date(selected.cancelledAt).toLocaleString("ko-KR") : "-"})` : "아니오"} /><Detail label="취소 사유" value={selected.cancellationReason || "-"} /><Detail label="메모" value={selected.memo || "-"} /></div><div className="mt-6 border-t pt-5"><h3 className="mb-3 font-semibold">변경 이력</h3>{historyLoading ? <LoadingState /> : historyError ? <p className="text-sm text-red-600">매출 변경 이력을 불러오지 못했습니다.</p> : history.length ? <div className="space-y-3">{history.map((item) => <div key={item.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><Badge>{item.action}</Badge><span className="text-xs text-slate-500">{profileNames[item.changedBy] || item.changedBy} · {new Date(item.createdAt).toLocaleString("ko-KR")}</span></div><div className="mt-3 grid gap-3 lg:grid-cols-2"><JsonData label="previous_data" value={item.previousData} /><JsonData label="changed_data" value={item.changedData} /></div></div>)}</div> : <p className="text-sm text-slate-500">기록된 변경 이력이 없습니다.</p>}</div></>}</Modal>
    <Modal open={!!editing} onClose={() => !saving && setEditing(null)} title="매출 수정" wide>{editing && <form onSubmit={saveEdit} className="grid gap-4 sm:grid-cols-2"><Field label="매출 일자" required><Input type="date" value={editing.saleDate} disabled={saving} onChange={(e) => setEditing({ ...editing, saleDate: e.target.value })} /></Field><Field label="정상 판매가"><MoneyInput value={editing.originalAmount} disabled={saving} onChange={(value) => setEditing({ ...editing, originalAmount: value })} /></Field><Field label="할인 금액"><MoneyInput value={editing.discountAmount} disabled={saving} onChange={(value) => setEditing({ ...editing, discountAmount: value })} /></Field><Field label="결제 금액"><MoneyInput value={editing.paidAmount} disabled={saving} onChange={(value) => setEditing({ ...editing, paidAmount: value })} /></Field><Field label="미수금"><MoneyInput value={editing.outstandingAmount} disabled={saving} onChange={(value) => setEditing({ ...editing, outstandingAmount: value })} /></Field><Field label="결제 수단"><Select value={editing.paymentMethod} disabled={saving} onChange={(e) => setEditing({ ...editing, paymentMethod: e.target.value })}>{Object.entries(paymentLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field><Field label="구분"><Select value={editing.customerType} disabled={saving} onChange={(e) => setEditing({ ...editing, customerType: e.target.value })}><option value="new">신규</option><option value="renewal">재등록</option></Select></Field><div className="sm:col-span-2"><Field label="메모"><Textarea value={editing.memo || ""} disabled={saving} onChange={(e) => setEditing({ ...editing, memo: e.target.value })} /></Field></div>{actionError && <p className="text-sm text-red-600 sm:col-span-2">{actionError}</p>}<Button className="sm:col-span-2" disabled={saving}>{saving ? "저장 중..." : "수정 저장"}</Button></form>}</Modal>
    <Modal open={!!refunding} onClose={() => !saving && setRefunding(null)} title="환불 처리"><form onSubmit={(event) => { event.preventDefault(); if (!saving) void applyRefund(); }}><Field label="누적 환불 금액" required><MoneyInput value={refundAmount} disabled={saving} max={refunding?.paidAmount} onChange={setRefundAmount} /></Field>{actionError && <p role="alert" className="mt-3 text-sm text-red-600">{actionError}</p>}<Button className="mt-4 w-full" disabled={saving}>{saving ? "처리 중..." : "환불 적용"}</Button></form></Modal>
    <Modal open={!!cancelling} onClose={() => !saving && setCancelling(null)} title="매출 취소"><Field label="취소 사유" required><Textarea value={cancellationReason} disabled={saving} onChange={(e) => setCancellationReason(e.target.value)} /></Field>{actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}<Button className="mt-4 w-full" variant="danger" disabled={saving} onClick={() => void cancelSale()}>{saving ? "처리 중..." : "매출 취소"}</Button></Modal>
    <ConfirmModal open={!!reopening} onClose={() => setReopening(null)} onConfirm={() => void reopenSale()} title="취소 복구" confirmLabel="취소 복구" tone="primary" processing={saving} description={<>취소된 매출을 복구합니다. 환불 금액에 따라 정상·부분환불·전체환불 상태가 다시 계산됩니다.{actionError && <span role="alert" className="mt-3 block text-red-600">{actionError}</span>}</>} />
    {notice && <Toast message={notice} onClose={() => setNotice("")} />}
  </>;
}

function MoneyInput({ value, onChange, disabled, max }: { value: number; onChange: (value: number) => void; disabled?: boolean; max?: number }) {
  return <Input type="number" min="0" max={max} step="1" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value) || 0)} />;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}

function JsonData({ label, value }: { label: string; value: unknown }) {
  return <div><p className="mb-1 text-xs font-medium text-slate-500">{label}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs text-slate-700">{value == null ? "-" : JSON.stringify(value, null, 2)}</pre></div>;
}
