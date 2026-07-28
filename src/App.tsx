import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Boxes,
  ChevronRight,
  ClipboardPlus,
  Dog,
  Eye,
  EyeOff,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Package,
  ReceiptText,
  Settings,
  ShieldCheck,
  UserCog,
  UserRound,
  X,
} from "lucide-react";
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  Link,
} from "react-router-dom";
import { Button, Input } from "./components/ui";
import { useAuth } from "./auth/AuthContext";
import { safeReturnTo } from "./auth/authStateLogic";
import { ReportsPage } from "./pages/ReportsDB";
import { DashboardPage } from "./pages/DashboardDB";
import { SaleFormPage as LegacySaleFormPage } from "./pages/Sales";
import { SaleFormPage } from "./pages/SaleRegistration";
import { SalesHistoryPage } from "./pages/SalesHistoryDB";
import { CategoriesPage } from "./pages/Management";
import { SettingsPage } from "./pages/SettingsDB";
import { ProductsPage } from "./pages/ProductManagement";
import { PetManagementPage } from "./pages/DogManagement";
import { SignupPage } from "./pages/SignupPage";
import { StaffManagementPage } from "./pages/StaffManagement";
import { FindAccountPage, ForgotPasswordPage, ResetPasswordPage } from "./pages/AccountRecoveryPages";

interface MenuItem { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; adminOnly?: boolean; group: "업무" | "관리" | "분석" }
const menus: MenuItem[] = [
  { to: "/dashboard", label: "대시보드", icon: LayoutDashboard, group: "업무" },
  { to: "/sales/new", label: "매출 등록", icon: ClipboardPlus, group: "업무" },
  { to: "/sales", label: "매출 내역", icon: ReceiptText, end: true, group: "업무" },
  { to: "/customers", label: "반려견 관리", icon: Dog, group: "관리" },
  { to: "/categories", label: "상품 분류 관리", icon: Boxes, adminOnly: true, group: "관리" },
  { to: "/products", label: "상품 관리", icon: Package, group: "관리" },
  { to: "/reports", label: "월별 보고서", icon: BarChart3, group: "분석" },
  { to: "/settings", label: "설정", icon: Settings, group: "분석" },
  { to: "/staff", label: "직원 관리", icon: UserCog, adminOnly: true, group: "관리" },
];
const savedEmailKey = "pm-saved-login-email";
const autoLoginPreferenceKey = "pm-auto-login-enabled";
const appVersion = `v${__APP_VERSION__}`;
export default function App() {
  const { user, loading } = useAuth();
  const loggedIn = Boolean(user);
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        로그인 상태를 확인하는 중입니다.
      </div>
    );
  return (
    <Routes>
      <Route
        path="/login"
        element={<LoginRoute loggedIn={loggedIn} />}
      />
      <Route path="/signup" element={loggedIn ? <Navigate to="/dashboard" replace /> : <SignupPage />} />
      <Route path="/find-account" element={<FindAccountPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={<ProtectedLayout loggedIn={loggedIn} />}
      >
        {menus.map(() => null)}
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="sales" element={<SalesHistoryPage />} />
        <Route path="sales/new" element={<SaleFormPage />} />
        <Route path="sales/:saleId/edit" element={<LegacySaleFormPage />} />
        <Route path="customers" element={<PetManagementPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="staff" element={<AdminOnly><StaffManagementPage /></AdminOnly>} />
      </Route>
      <Route path="*" element={<NotFound loggedIn={loggedIn} />} />
    </Routes>
  );
}

function LoginRoute({ loggedIn }: { loggedIn: boolean }) {
  const location = useLocation();
  const returnTo = safeReturnTo(
    (location.state as { returnTo?: unknown } | null)?.returnTo,
  );
  return loggedIn ? <Navigate to={returnTo} replace /> : <LoginPage />;
}

function ProtectedLayout({ loggedIn }: { loggedIn: boolean }) {
  const location = useLocation();
  if (loggedIn) return <AppLayout />;
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to="/login" replace state={{ returnTo }} />;
}

function LoginPage() {
  const { signIn, authError } = useAuth();
  const [email, setEmail] = useState(() => localStorage.getItem(savedEmailKey) ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(() => Boolean(localStorage.getItem(savedEmailKey)));
  const [keepSignedIn, setKeepSignedIn] = useState(() => localStorage.getItem(autoLoginPreferenceKey) !== "false");
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => (localStorage.getItem(savedEmailKey) ? passwordRef.current : emailRef.current)?.focus());
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!email || !password) {
      setError("이메일과 비밀번호를 입력해 주세요.");
      requestAnimationFrame(() => (!email ? emailRef.current : passwordRef.current)?.focus());
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await signIn(email, password);
      if (rememberEmail) localStorage.setItem(savedEmailKey, email.trim());
      else localStorage.removeItem(savedEmailKey);
      localStorage.setItem(autoLoginPreferenceKey, String(keepSignedIn));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "서버 연결에 실패했습니다. 잠시 후 다시 시도하세요.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="login-shell flex min-h-[100dvh] bg-app-background">
      <section className="login-brand-panel relative hidden w-[46%] flex-col justify-between overflow-hidden p-10 text-white lg:flex xl:p-14">
        <div className="login-orb login-orb-top" aria-hidden="true" />
        <div className="login-orb login-orb-bottom" aria-hidden="true" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-base font-black text-primary shadow-lg shadow-slate-950/10">P&M</div>
          <div><strong className="block text-sm tracking-wide">P&M 매출관리</strong><span className="text-xs text-blue-100/65">INTERNAL WORKSPACE</span></div>
        </div>
        <div className="relative z-10 max-w-xl pb-8">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-blue-50 backdrop-blur-sm"><ShieldCheck size={15} /> P&M 임직원 전용 보안 시스템</div>
          <h1 className="text-[2.75rem] font-bold leading-[1.18] tracking-[-0.035em] xl:text-5xl">매출을 더 정확하게,<br />업무를 더 간편하게.</h1>
          <p className="mt-6 max-w-lg text-[15px] leading-7 text-blue-100/75">상품, 보호자, 반려견과 매출 현황을 한곳에서 빠르고 안정적으로 관리합니다.</p>
          <div className="mt-10 grid max-w-md grid-cols-3 gap-3 text-center text-xs text-blue-100/70"><div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-4"><strong className="block text-base text-white">3</strong>사업부 통합</div><div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-4"><strong className="block text-base text-white">실시간</strong>매출 현황</div><div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-4"><strong className="block text-base text-white">안전한</strong>권한 관리</div></div>
        </div>
        <div className="relative z-10 flex items-center justify-between text-xs text-blue-100/55"><span>© 2026 P&M</span><span>{appVersion}</span></div>
      </section>
      <section className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8 lg:px-12">
        <form onSubmit={submit} className="w-full max-w-[420px] rounded-[28px] border border-border bg-white p-6 shadow-[0_24px_70px_rgba(23,36,58,0.10)] sm:p-9 lg:border-0 lg:shadow-none">
          <div className="mb-8 flex items-center justify-between lg:hidden"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-sm font-black text-white shadow-md">P&M</div><div><strong className="block text-sm text-text-primary">P&M 매출관리</strong><span className="text-[11px] text-text-muted">INTERNAL</span></div></div><span className="text-xs font-medium text-text-muted">{appVersion}</span></div>
          <div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-primary">Welcome back</p><h2 className="text-[2rem] font-bold tracking-[-0.035em] text-text-primary">로그인</h2><p className="mt-2 text-sm leading-6 text-text-secondary">업무 계정으로 안전하게 접속하세요.</p></div>
          <div className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-text-primary">이메일</span>
              <div className="relative"><Mail aria-hidden="true" className="pointer-events-none absolute left-4 top-3.5 text-text-muted" size={17} /><Input ref={emailRef} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="name@company.com" className="h-12 pl-11" disabled={submitting} aria-invalid={Boolean(error && !email)} aria-describedby={error ? "login-error" : undefined} /></div>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-text-primary">비밀번호</span>
              <div className="relative"><LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-4 top-3.5 text-text-muted" size={17} /><Input ref={passwordRef} type={showPassword ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="비밀번호 입력" className="h-12 pl-11 pr-12" disabled={submitting} aria-invalid={Boolean(error && !password)} aria-describedby={error ? "login-error" : undefined} /><button type="button" disabled={submitting} onClick={() => setShowPassword((value) => !value)} className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
            </label>
            <div className="flex flex-col gap-3 text-sm text-text-secondary min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between"><label className="flex min-h-11 cursor-pointer items-center gap-2.5"><input type="checkbox" checked={rememberEmail} disabled={submitting} onChange={(event) => setRememberEmail(event.target.checked)} className="h-4 w-4 rounded border-border-strong accent-primary" />아이디 저장</label><label className="flex min-h-11 cursor-pointer items-center gap-2.5"><input type="checkbox" checked={keepSignedIn} disabled={submitting} onChange={(event) => setKeepSignedIn(event.target.checked)} className="h-4 w-4 rounded border-border-strong accent-primary" />자동 로그인 유지</label></div>
            {(error || authError) && (
              <div id="login-error" role="alert" className="rounded-xl border border-error/15 bg-error-soft px-4 py-3 text-sm leading-5 text-error">{error || authError}</div>
            )}
            <Button className="h-12 w-full text-[15px] shadow-[0_8px_18px_rgba(39,76,119,0.2)]" disabled={submitting}>{submitting && <LoaderCircle className="animate-spin" size={18} />}{submitting ? "로그인 중..." : "로그인"}</Button>
          </div>
          <div className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-semibold text-primary"><Link className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" to="/signup">직원 계정 신청</Link><Link className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" to="/find-account">아이디 찾기</Link><Link className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" to="/forgot-password">비밀번호 찾기</Link></div>
          <p className="mt-7 flex items-center justify-center gap-2 text-center text-xs leading-5 text-text-muted"><ShieldCheck size={14} />P&amp;M에서 승인된 업무 계정만 접속할 수 있습니다.</p>
        </form>
      </section>
    </main>
  );
}

function AppLayout() {
  const { signOut, user, profile, businessUnits } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current =
    menus.find((x) =>
      x.end ? location.pathname === x.to : location.pathname.startsWith(x.to),
    )?.label || "P&M 매출관리";
  const visibleMenus = menus.filter((item) => !item.adminOnly || profile?.role === "admin");
  return (
    <div className="min-h-screen bg-app-background">
      <aside
        className={`app-sidebar fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col text-white shadow-2xl shadow-slate-950/10 transition-transform duration-200 ease-out lg:w-[268px] lg:translate-x-0 lg:shadow-none ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.055] px-4.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/70 bg-white/95 text-[11px] font-black text-[#1e3a5f] shadow-[0_6px_18px_rgba(4,18,35,0.1)]">
              P&M
            </div>
            <div>
              <b className="block text-[15px] tracking-[-0.01em]">매출관리</b>
              <span className="text-[9px] font-semibold tracking-[0.18em] text-blue-100/45">INTERNAL</span>
            </div>
          </div>
          <button
            className="flex h-11 w-11 items-center justify-center rounded-xl text-blue-100/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="메뉴 닫기"
          >
            <X />
          </button>
        </div>
        <nav className="app-sidebar-nav flex-1 overflow-y-auto px-3 py-4">
          {(["업무", "관리", "분석"] as const).map((group) => <div key={group} className="mb-5 last:mb-0"><p className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[0.18em] text-blue-100/40">{group}</p><div className="space-y-0.5">{visibleMenus.filter((item) => item.group === group).map(({ to, label, icon: Icon, end }) => (
              <NavLink end={end} key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `app-sidebar-link group relative flex min-h-10 items-center gap-3 rounded-xl px-3.5 py-2 text-[13px] font-medium transition-[color,background-color,transform] duration-150 ${isActive ? "is-active bg-white/[0.085] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]" : "text-blue-50/68 hover:translate-x-0.5 hover:bg-white/[0.045] hover:text-white"}`}>
                {({ isActive }) => <><span className={`absolute inset-y-2.5 left-0 w-0.5 rounded-full transition-colors ${isActive ? "bg-[#8fc1e8]" : "bg-transparent"}`} /><Icon size={18} strokeWidth={isActive ? 2.2 : 1.75} /><span>{label}</span></>}
              </NavLink>
            ))}</div></div>)}
        </nav>
        <div className="shrink-0 border-t border-white/[0.055] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="app-sidebar-profile mb-2 flex items-center gap-2.5 rounded-xl border border-white/[0.045] px-3 py-2.5"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-blue-50"><UserRound size={16} /></div><div className="min-w-0 flex-1"><b className="block truncate text-xs text-white">{profile?.name || "이름 미등록"}</b><span className="mt-0.5 block truncate text-[10px] text-blue-100/52">{profile?.role === "admin" ? "관리자" : "직원"} · {user?.email}</span></div></div>
          <button
            onClick={() => void signOut()}
            className="flex min-h-11 w-full items-center gap-3 rounded-[13px] px-3 py-2.5 text-sm text-blue-50/60 transition hover:bg-white/[0.055] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <LogOut size={18} />
            로그아웃
          </button>
        </div>
      </aside>
      {open && (
        <button
          className="pm-drawer-overlay fixed inset-0 z-30 bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="메뉴 배경 닫기"
        />
      )}
      <div className="lg:pl-[268px]">
        <header className="no-print sticky top-0 z-20 flex h-18 items-center justify-between border-b border-border bg-white/95 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-border-strong text-text-secondary transition hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="메뉴 열기"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden text-slate-400 sm:inline">P&M</span>
              <ChevronRight
                size={14}
                className="hidden text-slate-300 sm:inline"
              />
              <b className="text-text-primary">{current}</b>
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <b className="block text-sm text-text-primary">{profile?.name || "이름 미등록"}</b>
            <span className="text-xs text-text-muted">{profile?.role === "admin" ? "관리자" : "직원"}</span>
            <span className="sr-only">조회된 사업부 {businessUnits.length}개</span>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
function AdminOnly({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  return profile?.role === "admin" ? children : <Navigate to="/dashboard" replace />;
}
function NotFound({ loggedIn }: { loggedIn: boolean }) {
  const nav = useNavigate();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
      <p className="text-7xl font-black text-emerald-800">404</p>
      <h1 className="mt-4 text-xl font-bold">페이지를 찾을 수 없습니다.</h1>
      <p className="mt-2 text-sm text-slate-500">주소를 다시 확인해 주세요.</p>
      <Button
        className="mt-6"
        onClick={() => nav(loggedIn ? "/dashboard" : "/login")}
      >
        기본 화면으로 이동
      </Button>
    </main>
  );
}
