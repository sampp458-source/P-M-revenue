import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input } from "../components/ui";
import { formatPhone, isValidPhone, phoneDigits } from "../lib/phone";

const minimumPasswordLength = 8;

export function SignupPage() {
  const { signUp } = useAuth();
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<{ emailConfirmationRequired: boolean } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const focus = (name: string) => requestAnimationFrame(() => { const field = formRef.current?.elements.namedItem(name); if (field instanceof HTMLElement) field.focus(); });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError("");
    if (!form.name.trim()) { setError("이름을 입력해 주세요."); focus("name"); return; }
    if (!isValidPhone(form.phone)) { setError("휴대폰 번호는 010으로 시작하는 11자리 번호를 입력해 주세요."); focus("phone"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError("올바른 이메일 주소를 입력해 주세요."); focus("email"); return; }
    if (form.password.length < minimumPasswordLength) { setError(`비밀번호는 ${minimumPasswordLength}자 이상 입력해 주세요.`); focus("password"); return; }
    if (form.password !== form.confirmPassword) { setError("비밀번호가 일치하지 않습니다."); focus("confirmPassword"); return; }
    setSubmitting(true);
    try {
      setCompleted(await signUp(form.name, phoneDigits(form.phone), form.email.trim(), form.password));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "계정 신청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="flex min-h-screen items-center justify-center bg-[#f0f3f1] p-6"><Card className="w-full max-w-md p-6 sm:p-8">{completed ? <div className="text-center"><CheckCircle2 className="mx-auto text-blue-700" size={42} /><h1 className="mt-4 text-2xl font-bold">계정 신청 완료</h1><p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">계정 신청이 완료되었습니다.{"\n"}관리자 승인 후 로그인할 수 있습니다.</p>{completed.emailConfirmationRequired && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">이메일로 전송된 인증 링크도 확인해 주세요.</p>}<Link className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-[#274c77] px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2" to="/login">로그인 화면으로</Link></div> : <><h1 className="text-2xl font-bold">직원 계정 신청</h1><p className="mt-2 text-sm text-slate-500">관리자 승인 후 P&amp;M 내부 프로그램을 사용할 수 있습니다.</p><form ref={formRef} onSubmit={submit} className="mt-6 space-y-4"><Field label="이름" required><Input name="name" autoComplete="name" value={form.name} disabled={submitting} aria-describedby={error ? "signup-error" : undefined} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="휴대폰 번호" required help="010-1234-5678 형식"><Input name="phone" inputMode="numeric" autoComplete="tel" value={form.phone} disabled={submitting} aria-invalid={Boolean(error && !isValidPhone(form.phone))} aria-describedby={error ? "signup-error" : undefined} onChange={(event) => setForm({ ...form, phone: formatPhone(event.target.value) })} /></Field><Field label="이메일" required><Input name="email" type="email" autoComplete="email" value={form.email} disabled={submitting} aria-describedby={error ? "signup-error" : undefined} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field><Field label="비밀번호" required help={`${minimumPasswordLength}자 이상 입력해 주세요.`}><Input name="password" type="password" autoComplete="new-password" value={form.password} disabled={submitting} aria-describedby={error ? "signup-error" : undefined} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field><Field label="비밀번호 확인" required><Input name="confirmPassword" type="password" autoComplete="new-password" value={form.confirmPassword} disabled={submitting} aria-describedby={error ? "signup-error" : undefined} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></Field>{error && <p id="signup-error" role="alert" className="text-sm text-red-600">{error}</p>}<Button className="w-full" disabled={submitting}>{submitting ? "신청 중..." : "계정 신청"}</Button><Link className="block text-center text-sm font-medium text-blue-700 hover:underline" to="/login">로그인으로 돌아가기</Link></form></>}</Card></main>;
}
