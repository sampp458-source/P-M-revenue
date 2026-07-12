import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Field, Input, LoadingState, Toast } from "../components/ui";
import { env } from "../lib/env";
import { formatPhone, isValidPhone, phoneDigits } from "../lib/phone";
import { supabase } from "../lib/supabase";

const statusMessage: Record<string, string> = {
  pending: "관리자 승인 대기 중인 계정입니다.", active: "사용 가능한 계정입니다.", rejected: "승인되지 않은 계정입니다. 관리자에게 문의해주세요.", inactive: "사용이 중지된 계정입니다. 관리자에게 문의해주세요.",
};

function AccountShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-[#f0f3f1] p-6"><Card className="w-full max-w-md p-6 sm:p-8"><h1 className="text-2xl font-bold">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>{children}</Card></main>;
}

export function FindAccountPage() {
  const [form, setForm] = useState({ name: "", phone: "" });
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ maskedEmail: string; status: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const lastRequestAt = useRef(0);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (submitting) return;
    setError(""); setResult(null); setNotFound(false);
    if (!form.name.trim()) { setError("이름을 입력해 주세요."); return; }
    if (!isValidPhone(form.phone)) { setError("휴대폰 번호는 010으로 시작하는 11자리 번호를 입력해 주세요."); return; }
    if (Date.now() - lastRequestAt.current < 5000) { setError("잠시 후 다시 시도해 주세요."); return; }
    lastRequestAt.current = Date.now(); setSubmitting(true);
    const response = await supabase.rpc("find_staff_account", { p_name: form.name.trim(), p_phone: phoneDigits(form.phone) });
    setSubmitting(false);
    if (response.error) { setError("계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."); return; }
    const row = response.data?.[0];
    if (row?.masked_email) setResult({ maskedEmail: row.masked_email, status: row.account_status });
    else setNotFound(true);
  };
  return <AccountShell title="아이디 찾기" description="가입 시 입력한 이름과 휴대폰 번호를 입력해 주세요."><form onSubmit={submit} className="mt-6 space-y-4"><Field label="이름" required><Input value={form.name} disabled={submitting} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="휴대폰 번호" required><Input inputMode="numeric" value={form.phone} disabled={submitting} onChange={(event) => setForm({ ...form, phone: formatPhone(event.target.value) })} /></Field>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}<Button className="w-full" disabled={submitting}>{submitting ? "확인 중..." : "계정 확인"}</Button></form>{result && <div className="mt-5 rounded-lg bg-blue-50 p-4 text-sm"><p>가입 이메일: <b>{result.maskedEmail}</b></p><p className="mt-2 text-blue-700">{statusMessage[result.status] || "계정 상태는 관리자에게 문의해주세요."}</p></div>}{notFound && <p className="mt-5 rounded-lg bg-slate-100 p-4 text-sm leading-6 text-slate-600">입력하신 정보로 확인 가능한 계정을 찾지 못했습니다. 입력 정보를 다시 확인하거나 관리자에게 문의해주세요.</p>}<AuthLinks /></AccountShell>;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(""); const [submitting, setSubmitting] = useState(false); const [completed, setCompleted] = useState(false); const [toast, setToast] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); if (submitting) return; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setToast("올바른 이메일 주소를 입력해 주세요."); return; } setSubmitting(true); await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${env.siteUrl}/reset-password` }); setSubmitting(false); setCompleted(true); setToast("비밀번호 재설정 요청을 처리했습니다."); };
  return <AccountShell title="비밀번호 찾기" description="가입한 이메일로 비밀번호 재설정 안내를 전송합니다.">{completed ? <p className="mt-6 rounded-lg bg-blue-50 p-4 text-sm leading-6 text-blue-800">입력하신 이메일로 비밀번호 재설정 안내를 전송했습니다.<br />메일이 보이지 않으면 스팸함을 확인해주세요.</p> : <form onSubmit={submit} className="mt-6 space-y-4"><Field label="이메일" required><Input type="email" autoComplete="email" value={email} disabled={submitting} onChange={(event) => setEmail(event.target.value)} /></Field><Button className="w-full" disabled={submitting}>{submitting ? "전송 중..." : "재설정 안내 전송"}</Button></form>}<AuthLinks />{toast && <Toast message={toast} onClose={() => setToast("")} />}</AccountShell>;
}

export function ResetPasswordPage() {
  const navigate = useNavigate(); const [checking, setChecking] = useState(true); const [valid, setValid] = useState(false); const [password, setPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState(""); const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  useEffect(() => { let mounted = true; void supabase.auth.getSession().then(({ data }) => { if (mounted) { setValid(Boolean(data.session)); setChecking(false); } }); const { data } = supabase.auth.onAuthStateChange((event, session) => { if (!mounted) return; if (event === "PASSWORD_RECOVERY" || session) { setValid(true); setChecking(false); } }); return () => { mounted = false; data.subscription.unsubscribe(); }; }, []);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (submitting) return; setError(""); if (password.length < 8) { setError("새 비밀번호는 8자 이상 입력해 주세요."); return; } if (password !== confirmPassword) { setError("새 비밀번호가 일치하지 않습니다."); return; } setSubmitting(true); const response = await supabase.auth.updateUser({ password }); setSubmitting(false); if (response.error) { setError("비밀번호를 변경하지 못했습니다. 링크가 만료되었는지 확인해 주세요."); return; } await supabase.auth.signOut(); navigate("/login", { replace: true }); };
  if (checking) return <AccountShell title="새 비밀번호 설정" description="재설정 링크를 확인하고 있습니다."><LoadingState /></AccountShell>;
  if (!valid) return <AccountShell title="유효하지 않은 링크" description="비밀번호 재설정 링크가 만료되었거나 올바르지 않습니다."><Link className="mt-6 flex min-h-10 items-center justify-center rounded-lg bg-[#274c77] px-4 py-2 text-sm font-semibold text-white" to="/forgot-password">비밀번호 다시 찾기</Link></AccountShell>;
  return <AccountShell title="새 비밀번호 설정" description="새로 사용할 비밀번호를 입력해 주세요."><form onSubmit={submit} className="mt-6 space-y-4"><Field label="새 비밀번호" required help="8자 이상 입력해 주세요."><Input type="password" autoComplete="new-password" value={password} disabled={submitting} onChange={(event) => setPassword(event.target.value)} /></Field><Field label="새 비밀번호 확인" required><Input type="password" autoComplete="new-password" value={confirmPassword} disabled={submitting} onChange={(event) => setConfirmPassword(event.target.value)} /></Field>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}<Button className="w-full" disabled={submitting}>{submitting ? "변경 중..." : "비밀번호 변경"}</Button></form></AccountShell>;
}

function AuthLinks() { return <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-medium text-blue-700"><Link to="/login">로그인</Link><Link to="/signup">직원 계정 신청</Link><Link to="/forgot-password">비밀번호 찾기</Link></div>; }
