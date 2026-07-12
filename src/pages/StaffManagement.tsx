import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, FilterToolbar, LoadingState, Modal, PageHeader, SearchBox, Select, Table, Textarea, Toast } from "../components/ui";
import { supabase } from "../lib/supabase";
import { formatPhone } from "../lib/phone";

type AccountStatus = "pending" | "active" | "rejected" | "inactive";
interface StaffRow { id: string; name: string; email: string | null; phone: string | null; role: "admin" | "staff"; status: AccountStatus; createdAt: string; approvedAt: string | null; deactivatedAt: string | null }
type ConfirmAction = "approve" | "restore";
type ReasonAction = "reject" | "deactivate";

const statusLabel: Record<AccountStatus, string> = { pending: "승인 대기", active: "재직", rejected: "승인 거절", inactive: "퇴사" };
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR") : "-";

export function StaffManagementPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [confirming, setConfirming] = useState<{ row: StaffRow; action: ConfirmAction } | null>(null);
  const [reasoning, setReasoning] = useState<{ row: StaffRow; action: ReasonAction } | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setLoadError(false);
    const result = await supabase.from("profiles").select("id, name, email, phone, role, account_status, created_at, approved_at, deactivated_at").order("created_at", { ascending: false });
    if (result.error) { setRows([]); setLoadError(true); }
    else setRows((result.data ?? []).map((row) => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role as StaffRow["role"], status: row.account_status as AccountStatus, createdAt: row.created_at, approvedAt: row.approved_at, deactivatedAt: row.deactivated_at })));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => { const keyword = query.trim().toLocaleLowerCase("ko"); return rows.filter((row) => (!status || row.status === status) && (!keyword || row.name.toLocaleLowerCase("ko").includes(keyword) || row.email?.toLocaleLowerCase("ko").includes(keyword) || row.phone?.includes(keyword.replace(/[^0-9]/g, "")))); }, [query, rows, status]);
  const errorMessage = (message: string, code?: string) => code === "42501" ? "직원 계정을 변경할 권한이 없습니다." : message.includes("마지막 관리자") || message.includes("자신의 계정") ? message : "직원 계정 상태를 변경하지 못했습니다.";

  const applyConfirm = async () => {
    if (!confirming || processing || !profile) return;
    setProcessing(true); setActionError("");
    const now = new Date().toISOString();
    const values = confirming.action === "approve"
      ? { account_status: "active", is_active: true, approved_at: now, approved_by: profile.id, rejection_reason: null }
      : { account_status: "active", is_active: true, deactivated_at: null, deactivated_by: null, deactivation_reason: null };
    const result = await supabase.from("profiles").update(values).eq("id", confirming.row.id).eq("role", confirming.row.role).select("id").single();
    setProcessing(false);
    if (result.error) { setActionError(errorMessage(result.error.message, result.error.code)); return; }
    setNotice(confirming.action === "approve" ? "직원 계정을 승인했습니다." : "직원 계정을 복구했습니다."); setConfirming(null); await load();
  };

  const applyReason = async (event: FormEvent) => {
    event.preventDefault();
    if (!reasoning || processing || !profile) return;
    if (reasoning.action === "deactivate" && !reason.trim()) { setActionError("퇴사 사유를 입력해 주세요."); return; }
    setProcessing(true); setActionError("");
    const now = new Date().toISOString();
    const values = reasoning.action === "reject"
      ? { account_status: "rejected", is_active: false, rejection_reason: reason.trim() || null }
      : { account_status: "inactive", is_active: false, deactivated_at: now, deactivated_by: profile.id, deactivation_reason: reason.trim() };
    const result = await supabase.from("profiles").update(values).eq("id", reasoning.row.id).eq("role", "staff").select("id").single();
    setProcessing(false);
    if (result.error) { setActionError(errorMessage(result.error.message, result.error.code)); return; }
    setNotice(reasoning.action === "reject" ? "직원 계정 신청을 거절했습니다." : "직원을 퇴사 처리했습니다."); setReasoning(null); setReason(""); await load();
  };

  return <>
    <PageHeader title="직원 관리" description="직원 계정 신청을 승인하고 재직 상태를 관리합니다." />
    <FilterToolbar className="sm:grid-cols-2"><SearchBox aria-label="직원 검색" placeholder="이름, 이메일 또는 휴대폰 검색" value={query} onClear={() => setQuery("")} onChange={(event) => setQuery(event.target.value)} /><Select aria-label="직원 상태 필터" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">전체 상태</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FilterToolbar>
    <Card className="overflow-hidden">{loading ? <LoadingState /> : loadError ? <ErrorState title="직원 목록을 불러오지 못했습니다." retry={() => void load()} /> : filtered.length ? <Table className="min-w-[1150px]"><thead><tr><th>이름</th><th>이메일</th><th>휴대폰 번호</th><th>역할</th><th>상태</th><th>가입일</th><th>승인일</th><th>퇴사 처리일</th><th className="text-right">관리</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td className="font-semibold">{row.name}</td><td>{row.email || "-"}</td><td>{row.phone ? formatPhone(row.phone) : "-"}</td><td>{row.role === "admin" ? "관리자" : "직원"}</td><td><Badge tone={row.status === "active" ? "green" : row.status === "pending" ? "amber" : row.status === "rejected" ? "red" : "gray"}>{statusLabel[row.status]}</Badge></td><td>{dateTime(row.createdAt)}</td><td>{dateTime(row.approvedAt)}</td><td>{dateTime(row.deactivatedAt)}</td><td><div className="flex justify-end gap-2">{row.role === "staff" && row.status === "pending" && <><Button variant="secondary" onClick={() => { setActionError(""); setConfirming({ row, action: "approve" }); }}>승인</Button><Button variant="secondary" onClick={() => { setActionError(""); setReason(""); setReasoning({ row, action: "reject" }); }}>거절</Button></>}{row.role === "staff" && row.status === "active" && <Button variant="secondary" onClick={() => { setActionError(""); setReason(""); setReasoning({ row, action: "deactivate" }); }}>퇴사 처리</Button>}{row.role === "staff" && row.status === "inactive" && <Button variant="secondary" onClick={() => { setActionError(""); setConfirming({ row, action: "restore" }); }}>계정 복구</Button>}{row.role === "admin" && <span className="text-sm text-slate-400">관리자 보호</span>}</div></td></tr>)}</tbody></Table> : <EmptyState title="조회된 직원이 없습니다." />}</Card>
    <ConfirmModal open={!!confirming} onClose={() => setConfirming(null)} onConfirm={() => void applyConfirm()} processing={processing} tone="primary" title={confirming?.action === "approve" ? "직원 계정 승인" : "직원 계정 복구"} confirmLabel={confirming?.action === "approve" ? "승인" : "복구"} description={<>{confirming?.row.name} 계정을 {confirming?.action === "approve" ? "승인" : "복구"}하시겠습니까?{actionError && <span role="alert" className="mt-2 block text-red-600">{actionError}</span>}</>} />
    <Modal open={!!reasoning} onClose={() => !processing && setReasoning(null)} title={reasoning?.action === "reject" ? "가입 승인 거절" : "퇴사 처리"}><form onSubmit={applyReason} className="space-y-4"><p className="text-sm leading-6 text-slate-600">{reasoning?.action === "deactivate" ? "이 직원을 퇴사 처리하시겠습니까? 로그인과 프로그램 접근이 즉시 차단되지만 기존 매출 및 변경 이력은 유지됩니다." : `${reasoning?.row.name} 계정 신청을 거절합니다. Auth 사용자는 삭제되지 않습니다.`}</p><Field label={reasoning?.action === "deactivate" ? "퇴사 사유" : "거절 사유"} required={reasoning?.action === "deactivate"}><Textarea value={reason} disabled={processing} onChange={(event) => setReason(event.target.value)} /></Field>{actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={processing} onClick={() => setReasoning(null)}>취소</Button><Button variant="danger" disabled={processing}>{processing ? "처리 중..." : reasoning?.action === "reject" ? "가입 거절" : "퇴사 처리"}</Button></div></form></Modal>
    {notice && <Toast message={notice} onClose={() => setNotice("")} />}
  </>;
}
