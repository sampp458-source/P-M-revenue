import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, ErrorState, PageHeader, Select, Skeleton, Toast } from "../components/ui";
import { won } from "../lib/format";
import { supabase } from "../lib/supabase";

interface TargetRow { id: string; businessUnitId: string | null; targetAmount: number }
type SaveStatus = "idle" | "saving" | "saved" | "error";

const koreaToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const initialPeriod = koreaToday().slice(0, 7);
const numericText = (value: string) => value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
const toAmount = (value: string) => {
  const parsed = Number(value || "0");
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
const formatInput = (value: string) => Number(value || "0").toLocaleString("ko-KR");

export function SettingsPage() {
  const { profile, businessUnits } = useAuth();
  const [period, setPeriod] = useState(initialPeriod);
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({ overall: "0" });
  const [statuses, setStatuses] = useState<Record<string, SaveStatus>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const requestSequence = useRef(0);
  const isAdmin = profile?.role === "admin";
  const [year, month] = period.split("-").map(Number);
  const activeUnits = useMemo(() => [...businessUnits].sort((a, b) => a.sortOrder - b.sortOrder), [businessUnits]);

  const loadTargets = useCallback(async (targetPeriod: string) => {
    const sequence = ++requestSequence.current;
    const [targetYear, targetMonth] = targetPeriod.split("-").map(Number);
    setLoading(true); setLoadError(false); setFormError(""); setStatuses({});
    const result = await supabase.from("monthly_targets").select("id, business_unit_id, target_amount").eq("year", targetYear).eq("month", targetMonth);
    if (sequence !== requestSequence.current) return;
    if (result.error) { setRows([]); setLoadError(true); setLoading(false); return; }
    const loaded = (result.data ?? []).map((row) => ({ id: row.id, businessUnitId: row.business_unit_id, targetAmount: row.target_amount ?? 0 }));
    const nextValues: Record<string, string> = { overall: String(loaded.find((row) => row.businessUnitId === null)?.targetAmount ?? 0) };
    activeUnits.forEach((unit) => { nextValues[unit.id] = String(loaded.find((row) => row.businessUnitId === unit.id)?.targetAmount ?? 0); });
    setRows(loaded); setValues(nextValues); setLoading(false);
  }, [activeUnits]);

  useEffect(() => { void loadTargets(period); }, [loadTargets, period]);

  const saveTarget = async (key: string, businessUnitId: string | null) => {
    if (!isAdmin) { setFormError("목표 저장 권한이 없습니다."); return; }
    const amount = toAmount(values[key] ?? "0");
    if (amount === null) { setFormError("목표 금액을 확인해주세요."); return; }
    if (statuses[key] === "saving") return;
    setFormError(""); setStatuses((current) => ({ ...current, [key]: "saving" }));
    const existing = rows.find((row) => row.businessUnitId === businessUnitId);
    const result = existing
      ? await supabase.from("monthly_targets").update({ target_amount: amount }).eq("id", existing.id).select("id").single()
      : await supabase.from("monthly_targets").insert({ year, month, business_unit_id: businessUnitId, target_amount: amount }).select("id").single();
    if (result.error) {
      const message = result.error.code === "42501" ? "목표 저장 권한이 없습니다." : result.error.code === "23505" ? "동일한 목표 데이터가 중복되어 있습니다." : "목표를 저장하지 못했습니다. 잠시 후 다시 시도하세요.";
      setFormError(message); setStatuses((current) => ({ ...current, [key]: "error" })); return;
    }
    setNotice("목표가 저장되었습니다.");
    await loadTargets(period);
    setStatuses((current) => ({ ...current, [key]: "saved" }));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-target-key="${key}"]`)?.focus());
  };

  const overall = toAmount(values.overall ?? "0") ?? 0;
  const unitTotal = activeUnits.reduce((total, unit) => total + (toAmount(values[unit.id] ?? "0") ?? 0), 0);
  const difference = overall - unitTotal;
  const currentKoreaYear = Number(initialPeriod.slice(0, 4));
  const years = Array.from({ length: 11 }, (_, index) => currentKoreaYear - 5 + index);
  const submit = (event: FormEvent) => event.preventDefault();

  return <>
    <PageHeader title="설정" description="사업부별 월 매출 목표를 관리합니다." />
    <Card className="mb-4 p-5"><div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-1.5 block text-sm font-medium text-slate-700">연도</span><Select aria-label="목표 연도" value={year} onChange={(event) => setPeriod(`${event.target.value}-${String(month).padStart(2, "0")}`)}>{years.map((value) => <option key={value} value={value}>{value}년</option>)}</Select></label><label><span className="mb-1.5 block text-sm font-medium text-slate-700">월</span><Select aria-label="목표 월" value={month} onChange={(event) => setPeriod(`${year}-${String(event.target.value).padStart(2, "0")}`)}>{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}월</option>)}</Select></label></div></Card>
    {loading ? <SettingsSkeleton /> : loadError ? <ErrorState title="목표 정보를 불러오지 못했습니다." retry={() => void loadTargets(period)} /> : <form onSubmit={submit} className="space-y-4">
      {!isAdmin && <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600"><LockKeyhole size={18} />직원 계정은 목표를 조회만 할 수 있습니다.</div>}
      <TargetCard title="전체 목표" description={`${year}년 ${month}월 전체 사업부 목표`} value={values.overall ?? "0"} editable={isAdmin} status={statuses.overall ?? "idle"} onChange={(value) => setValues((current) => ({ ...current, overall: numericText(value) || "0" }))} onSave={() => void saveTarget("overall", null)} />
      <Card className="overflow-hidden"><div className="border-b px-5 py-4"><h2 className="font-bold">사업부별 목표</h2><p className="mt-1 text-sm text-slate-500">활성 사업부별 목표를 각각 저장합니다.</p></div><div className="divide-y">{activeUnits.map((unit) => <TargetRow key={unit.id} targetKey={unit.id} name={unit.name} value={values[unit.id] ?? "0"} editable={isAdmin} status={statuses[unit.id] ?? "idle"} onChange={(value) => setValues((current) => ({ ...current, [unit.id]: numericText(value) || "0" }))} onSave={() => void saveTarget(unit.id, unit.id)} />)}</div></Card>
      <Card className="p-5"><h2 className="font-bold">합계 확인</h2><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><Summary label="전체 목표" value={won(overall)} /><Summary label="사업부 목표 합계" value={won(unitTotal)} /><Summary label="차이" value={`${difference >= 0 ? "" : "-"}${won(Math.abs(difference))}`} /></dl>{difference !== 0 ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">전체 목표와 사업부 목표 합계가 {won(Math.abs(difference))} 차이 납니다. 값이 달라도 저장할 수 있습니다.</p> : <p className="mt-4 flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-700"><CheckCircle2 size={17} />전체 목표와 사업부 목표 합계가 일치합니다.</p>}</Card>
      {formError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
    </form>}
    {notice && <Toast message={notice} onClose={() => setNotice("")} />}
  </>;
}

function MoneyField({ targetKey, value, editable, onChange, onEnter }: { targetKey: string; value: string; editable: boolean; onChange: (value: string) => void; onEnter: () => void }) {
  return editable ? <div className="relative"><input data-target-key={targetKey} aria-label="목표 금액" inputMode="numeric" autoComplete="off" className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 pr-9 text-right text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100" value={formatInput(value)} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onEnter(); } }} /><span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-500">원</span></div> : <p className="text-lg font-bold">{won(toAmount(value) ?? 0)}</p>;
}
function StatusText({ status }: { status: SaveStatus }) { return <span aria-live="polite" className={`text-xs ${status === "error" ? "text-red-600" : status === "saved" ? "text-blue-700" : "text-slate-500"}`}>{status === "saving" ? "저장 중..." : status === "saved" ? "저장 완료" : status === "error" ? "저장 실패" : ""}</span>; }
function TargetCard({ title, description, value, editable, status, onChange, onSave }: { title: string; description: string; value: string; editable: boolean; status: SaveStatus; onChange: (value: string) => void; onSave: () => void }) { return <Card className="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-end"><div className="flex-1"><h2 className="font-bold">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p><div className="mt-4 max-w-sm"><MoneyField targetKey="overall" value={value} editable={editable} onChange={onChange} onEnter={onSave} /></div></div>{editable && <div className="flex items-center gap-3"><StatusText status={status} /><Button type="button" disabled={status === "saving"} onClick={onSave}>{status === "saving" ? "저장 중..." : "전체 목표 저장"}</Button></div>}</div></Card>; }
function TargetRow({ targetKey, name, value, editable, status, onChange, onSave }: { targetKey: string; name: string; value: string; editable: boolean; status: SaveStatus; onChange: (value: string) => void; onSave: () => void }) { return <div className="grid gap-3 px-5 py-4 sm:grid-cols-[140px_1fr_auto] sm:items-center"><div><p className="font-semibold">{name}</p><StatusText status={status} /></div><MoneyField targetKey={targetKey} value={value} editable={editable} onChange={onChange} onEnter={onSave} />{editable && <Button type="button" variant="secondary" disabled={status === "saving"} onClick={onSave}>{status === "saving" ? "저장 중..." : "저장"}</Button>}</div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-bold text-slate-900">{value}</dd></div>; }
function SettingsSkeleton() { return <div aria-busy="true" aria-label="목표 정보 로딩 중" className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>; }
