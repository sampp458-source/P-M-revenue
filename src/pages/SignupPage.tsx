import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button, Input } from "../components/ui";
import { formatPhone, isValidPhone, phoneDigits } from "../lib/phone";

const minimumPasswordLength = 8;
type FieldName = "name" | "phone" | "email" | "password" | "confirmPassword";

const darkInputClass =
  "border-white/15 bg-white/[0.07] text-white placeholder:text-blue-100/35 hover:border-white/30 focus:border-[#8fc7ee] focus:bg-white/[0.1] focus:ring-[#8fc7ee]/25 disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-blue-100/45 aria-[invalid=true]:border-[#ff9292] aria-[invalid=true]:bg-red-950/25 aria-[invalid=true]:focus:ring-red-300/20";

function SignupField({
  label,
  help,
  required = true,
  children,
}: {
  label: string;
  help?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-50">
        {label}
        {required && (
          <span className="ml-1 text-red-300" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
      {help && (
        <span className="mt-1.5 block text-xs leading-5 text-blue-100/72">
          {help}
        </span>
      )}
    </label>
  );
}

export function SignupPage() {
  const { signUp } = useAuth();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<FieldName | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<{
    emailConfirmationRequired: boolean;
  } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const fail = (message: string, field?: FieldName) => {
    setError(message);
    setErrorField(field ?? null);
    if (!field) return;
    requestAnimationFrame(() => {
      const element = formRef.current?.elements.namedItem(field);
      if (element instanceof HTMLElement) element.focus();
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setErrorField(null);
    if (!form.name.trim()) return fail("이름을 입력해 주세요.", "name");
    if (!isValidPhone(form.phone)) {
      return fail(
        "휴대폰 번호는 010으로 시작하는 11자리 번호를 입력해 주세요.",
        "phone",
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return fail("올바른 이메일 주소를 입력해 주세요.", "email");
    }
    if (form.password.length < minimumPasswordLength) {
      return fail(
        `비밀번호는 ${minimumPasswordLength}자 이상이어야 합니다.`,
        "password",
      );
    }
    if (form.password !== form.confirmPassword) {
      return fail("비밀번호 확인이 일치하지 않습니다.", "confirmPassword");
    }

    setSubmitting(true);
    try {
      setCompleted(
        await signUp(
          form.name,
          phoneDigits(form.phone),
          form.email.trim(),
          form.password,
        ),
      );
    } catch (caught) {
      fail(
        caught instanceof Error
          ? caught.message
          : "계정 정보 저장에 실패했습니다. 관리자에게 문의해 주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#071a39] px-4 py-8 sm:px-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_12%,rgba(67,119,190,0.38),transparent_34%),radial-gradient(circle_at_85%_85%,rgba(24,85,142,0.2),transparent_36%),linear-gradient(145deg,#0b2b59_0%,#071a39_58%,#06152f_100%)]"
        aria-hidden="true"
      />
      <section className="relative w-full max-w-[30rem] rounded-[1.5rem] border border-white/12 bg-white/[0.075] p-6 shadow-[0_28px_80px_rgba(0,9,28,0.38)] backdrop-blur-xl sm:p-9">
        {completed ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto text-[#9bd0ec]" size={44} />
            <h1 className="mt-5 text-2xl font-bold tracking-[-0.025em] text-white">
              계정 신청 완료
            </h1>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-blue-100/80">
              계정 신청이 완료되었습니다.{"\n"}관리자 승인 후 로그인할 수
              있습니다.
            </p>
            {completed.emailConfirmationRequired && (
              <p className="mt-4 rounded-xl border border-[#8fc7ee]/25 bg-[#8fc7ee]/10 p-3 text-sm text-[#c8e7fa]">
                이메일로 전송된 인증 링크도 확인해 주세요.
              </p>
            )}
            <Link
              className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-[#153967] transition hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9bd0ec] focus-visible:ring-offset-2 focus-visible:ring-offset-[#071a39]"
              to="/login"
            >
              로그인 화면으로
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold tracking-[0.08em] text-[#9bd0ec]">
              P&amp;M OS
            </p>
            <h1 className="mt-2 text-[clamp(1.75rem,7vw,2.125rem)] font-bold tracking-[-0.035em] text-white">
              직원 계정 신청
            </h1>
            <p className="mt-2 text-sm leading-6 text-blue-100/76">
              관리자 승인 후 P&amp;M OS를 사용할 수 있습니다.
            </p>
            <form ref={formRef} onSubmit={submit} className="mt-7 space-y-4" noValidate>
              <SignupField label="이름">
                <Input
                  className={darkInputClass}
                  name="name"
                  autoComplete="name"
                  value={form.name}
                  disabled={submitting}
                  aria-invalid={errorField === "name"}
                  aria-describedby={error ? "signup-error" : undefined}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </SignupField>
              <SignupField label="휴대폰 번호" help="010-1234-5678 형식">
                <Input
                  className={darkInputClass}
                  name="phone"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={form.phone}
                  disabled={submitting}
                  aria-invalid={errorField === "phone"}
                  aria-describedby={error ? "signup-error" : undefined}
                  onChange={(event) =>
                    setForm({ ...form, phone: formatPhone(event.target.value) })
                  }
                />
              </SignupField>
              <SignupField label="이메일">
                <Input
                  className={darkInputClass}
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  disabled={submitting}
                  aria-invalid={errorField === "email"}
                  aria-describedby={error ? "signup-error" : undefined}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </SignupField>
              <SignupField
                label="비밀번호"
                help={`${minimumPasswordLength}자 이상 입력해 주세요.`}
              >
                <Input
                  className={darkInputClass}
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  disabled={submitting}
                  aria-invalid={errorField === "password"}
                  aria-describedby={error ? "signup-error" : undefined}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                />
              </SignupField>
              <SignupField label="비밀번호 확인">
                <Input
                  className={darkInputClass}
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  disabled={submitting}
                  aria-invalid={errorField === "confirmPassword"}
                  aria-describedby={error ? "signup-error" : undefined}
                  onChange={(event) =>
                    setForm({ ...form, confirmPassword: event.target.value })
                  }
                />
              </SignupField>
              {error && (
                <div
                  id="signup-error"
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-red-300/30 bg-red-950/35 px-3.5 py-3 text-sm leading-5 text-red-100"
                >
                  <AlertCircle className="mt-0.5 shrink-0" size={17} />
                  <span>{error}</span>
                </div>
              )}
              <Button
                className="w-full bg-[#3d75ad] shadow-[0_10px_26px_rgba(0,8,28,0.18)] hover:bg-[#4a83bb] focus-visible:ring-[#9bd0ec] focus-visible:ring-offset-[#071a39]"
                disabled={submitting}
                aria-busy={submitting}
              >
                {submitting && (
                  <LoaderCircle className="animate-spin" size={18} />
                )}
                {submitting ? "신청 중..." : "계정 신청"}
              </Button>
              <Link
                className="block rounded-lg py-1 text-center text-sm font-semibold text-[#a9d8f5] underline-offset-4 transition hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9bd0ec]"
                to="/login"
              >
                로그인으로 돌아가기
              </Link>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
