import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Boxes,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  Clock3,
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
  WalletCards,
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
import { useModule } from "./app/ModuleContext";
import { AppSwitcher as AppSwitcherMenu } from "./app/AppSwitcher";
import type { AppModule } from "./app/moduleState";
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
import { OperationsSettingsPage } from "./pages/OperationsSettings";
import { FindAccountPage, ForgotPasswordPage, ResetPasswordPage } from "./pages/AccountRecoveryPages";
import pmLogo from "./assets/pm-logo.png";

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
interface OperationsMenuItem { to: string; label: string; icon: typeof CalendarDays; end?: boolean }
const operationsMenus: OperationsMenuItem[] = [
  { to: "/operations/today", label: "오늘", icon: Clock3 },
  { to: "/operations/calendar", label: "캘린더", icon: CalendarDays },
  { to: "/operations/settings", label: "일정 설정", icon: Settings },
];
const savedEmailKey = "pm-saved-login-email";
const autoLoginPreferenceKey = "pm-auto-login-enabled";
const appVersion = `v${__APP_VERSION__}`;

function BrandLogo({
  className = "",
  imageClassName = "h-[150px] w-[150px]",
}: {
  className?: string;
  imageClassName?: string;
}) {
  return (
    <span
      className={`relative block shrink-0 ${className}`}
    >
      <img
        src={pmLogo}
        alt="P&M"
        className={`pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 object-contain ${imageClassName}`}
      />
    </span>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const loggedIn = Boolean(user);
  if (loading) return <AuthLoadingScreen />;
  return (
    <Routes>
      <Route
        path="/login"
        element={<LoginRoute loggedIn={loggedIn} />}
      />
      <Route path="/signup" element={loggedIn ? <Navigate to="/select-module" replace /> : <SignupPage />} />
      <Route path="/find-account" element={<FindAccountPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/select-module"
        element={<ModuleGateRoute loggedIn={loggedIn} />}
      />
      <Route
        element={<ProtectedLayout loggedIn={loggedIn} module="finance" />}
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
      <Route
        path="operations"
        element={<ProtectedLayout loggedIn={loggedIn} module="operations" />}
      >
        <Route index element={<Navigate to="/operations/today" replace />} />
        <Route
          path="today"
          element={
            <OperationsStubPage
              eyebrow="TODAY"
              title="오늘"
              description="오늘의 수업과 회사 일정을 한눈에 확인하는 화면을 준비하고 있습니다."
            />
          }
        />
        <Route
          path="calendar"
          element={
            <OperationsStubPage
              eyebrow="CALENDAR"
              title="캘린더"
              description="유치원·교육센터·호텔과 공통 일정을 함께 보는 캘린더를 준비하고 있습니다."
            />
          }
        />
        <Route
          path="settings"
          element={<OperationsSettingsPage />}
        />
        <Route path="*" element={<Navigate to="/operations/today" replace />} />
      </Route>
      <Route path="*" element={<NotFound loggedIn={loggedIn} />} />
    </Routes>
  );
}

function AuthLoadingScreen() {
  return (
    <main className="auth-loading-screen flex min-h-[100dvh] items-center justify-center bg-app-background px-6">
      <div
        className="auth-loading-content flex flex-col items-center text-center"
        role="status"
        aria-live="polite"
      >
        <BrandLogo
          className="h-[68px] w-[150px]"
          imageClassName="module-gate-logo h-[176px] w-[176px]"
        />
        <span
          className="auth-loading-track mt-5 h-1 w-24 overflow-hidden rounded-full bg-primary/10"
          aria-hidden="true"
        >
          <span className="auth-loading-bar block h-full w-1/2 rounded-full bg-primary" />
        </span>
        <p className="mt-4 text-sm font-medium text-text-secondary">
          P&amp;M OS를 준비하고 있습니다
        </p>
      </div>
    </main>
  );
}

function LoginRoute({ loggedIn }: { loggedIn: boolean }) {
  const location = useLocation();
  const returnTo = safeReturnTo(
    (location.state as { returnTo?: unknown } | null)?.returnTo,
  );
  return loggedIn ? (
    <Navigate
      to="/select-module"
      replace
      state={{ pendingReturnTo: returnTo }}
    />
  ) : (
    <LoginPage />
  );
}

function ProtectedLayout({
  loggedIn,
  module,
}: {
  loggedIn: boolean;
  module: AppModule;
}) {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const { gateCompleted } = useModule();
  if (!loggedIn) return <Navigate to="/login" replace state={{ returnTo }} />;
  if (!gateCompleted) return <ModuleGateRedirect returnTo={returnTo} />;
  return module === "finance" ? <AppLayout /> : <OperationsAppLayout />;
}

function ModuleGateRedirect({ returnTo }: { returnTo: string }) {
  const { rememberPendingReturnTo } = useModule();
  useEffect(() => {
    rememberPendingReturnTo(returnTo);
  }, [rememberPendingReturnTo, returnTo]);
  return (
    <Navigate
      to="/select-module"
      replace
      state={{ pendingReturnTo: returnTo }}
    />
  );
}

function ModuleGateRoute({ loggedIn }: { loggedIn: boolean }) {
  const location = useLocation();
  const { rememberPendingReturnTo } = useModule();
  const pendingReturnTo = (
    location.state as { pendingReturnTo?: unknown } | null
  )?.pendingReturnTo;
  useEffect(() => {
    if (loggedIn && pendingReturnTo) {
      rememberPendingReturnTo(pendingReturnTo);
    }
  }, [loggedIn, pendingReturnTo, rememberPendingReturnTo]);
  if (!loggedIn) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: "/select-module" }}
      />
    );
  }
  return <ModuleGatePage pendingReturnTo={pendingReturnTo} />;
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
    <main className="login-shell flex min-h-[100dvh] overflow-x-hidden bg-app-background">
      <section className="login-brand-panel relative hidden w-[54%] flex-col justify-between overflow-hidden px-10 py-9 text-white lg:flex xl:px-14 xl:py-11 2xl:px-20">
        <div className="relative z-10 flex items-center gap-3">
          <BrandLogo
            className="h-[62px] w-[136px]"
            imageClassName="h-[174px] w-[174px]"
          />
          <span className="h-6 w-px bg-white/15" aria-hidden="true" />
          <span className="text-[15px] font-semibold tracking-[0.08em] text-blue-50/82">
            P&amp;M OS
          </span>
        </div>
        <div className="login-brand-content relative z-10 max-w-[640px] pb-4 lg:-top-3">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#a8d4ed]">
            P&amp;M Operating System
          </p>
          <h1 className="mt-5 text-[clamp(2.9rem,4.35vw,4.9rem)] font-bold leading-[1.08] tracking-[-0.055em] text-white">
            회사 운영을
            <br />
            하나의 시스템으로
          </h1>
          <p className="mt-6 max-w-lg text-[15px] leading-7 text-blue-100/72 xl:text-base">
            스케줄부터 회계와 고객 정보까지
            <br className="hidden xl:block" /> P&amp;M의 모든 업무를 하나에서
            연결합니다.
          </p>
          <div className="login-capabilities mt-10 grid max-w-xl grid-cols-3">
            <BrandCapability
              icon={CalendarRange}
              title="운영"
              description="스케줄과 오늘의 업무"
            />
            <BrandCapability
              icon={WalletCards}
              title="회계"
              description="매출·수납·미수·환불"
            />
            <BrandCapability
              icon={UserRound}
              title="고객"
              description="보호자와 반려견 정보"
            />
          </div>
        </div>
        <div className="relative z-10 flex items-center justify-between text-[11px] tracking-[0.02em] text-blue-100/48">
          <span>© 2026 P&amp;M</span>
          <span>{appVersion}</span>
        </div>
      </section>
      <section className="login-form-side relative flex flex-1 items-center justify-center px-5 py-7 sm:px-8 sm:py-10 lg:px-12">
        <div className="login-form-glow" aria-hidden="true" />
        <form
          onSubmit={submit}
          className="login-form-panel relative z-10 w-full max-w-[440px] rounded-[30px] border border-white/80 bg-white/92 p-6 shadow-[0_28px_80px_rgba(23,36,58,0.11)] backdrop-blur-xl sm:p-9 lg:border-transparent lg:bg-transparent lg:p-2 lg:shadow-none lg:backdrop-blur-none"
        >
          <div className="login-mobile-brand mb-7 lg:hidden">
            <div className="flex items-center justify-between">
              <BrandLogo
                className="h-[54px] w-[120px]"
                imageClassName="module-gate-logo h-[156px] w-[156px]"
              />
              <span className="text-[11px] font-medium text-text-muted">
                {appVersion}
              </span>
            </div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
              P&amp;M OS
            </p>
            <p className="mt-1.5 text-[17px] font-semibold tracking-[-0.025em] text-text-primary">
              회사 운영을 하나의 시스템으로
            </p>
          </div>
          <div className="mb-8">
            <h2 className="text-[2rem] font-bold tracking-[-0.045em] text-text-primary sm:text-[2.2rem]">
              로그인
            </h2>
            <p className="mt-2 text-[15px] leading-6 text-text-secondary">
              오늘의 업무를 시작하세요
            </p>
          </div>
          <div className="login-form-fields space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-text-primary">
                이메일
              </span>
              <div className="login-input-wrap relative">
                <Mail
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-4 text-text-muted transition-colors"
                  size={18}
                />
                <Input
                  ref={emailRef}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  placeholder="name@company.com"
                  className="login-input h-[50px] rounded-[14px] pl-12"
                  disabled={submitting}
                  aria-invalid={Boolean((error && !email) || authError)}
                  aria-describedby={
                    error || authError ? "login-error" : undefined
                  }
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-text-primary">
                비밀번호
              </span>
              <div className="login-input-wrap relative">
                <LockKeyhole
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-4 text-text-muted transition-colors"
                  size={18}
                />
                <Input
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="비밀번호 입력"
                  className="login-input h-[50px] rounded-[14px] pl-12 pr-24"
                  disabled={submitting}
                  aria-invalid={Boolean((error && !password) || authError)}
                  aria-describedby={
                    error || authError ? "login-error" : undefined
                  }
                />
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowPassword((value) => !value)}
                  className="login-password-toggle absolute right-10 top-0.5 flex h-[46px] w-[46px] items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={
                    showPassword ? "비밀번호 숨기기" : "비밀번호 보기"
                  }
                >
                  {showPassword ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
            </label>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-text-secondary">
              <label className="login-check-label flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1">
                <input
                  type="checkbox"
                  checked={rememberEmail}
                  disabled={submitting}
                  onChange={(event) => setRememberEmail(event.target.checked)}
                  className="login-checkbox h-[17px] w-[17px] rounded border-border-strong accent-primary"
                />
                아이디 저장
              </label>
              <label className="login-check-label flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  disabled={submitting}
                  onChange={(event) => setKeepSignedIn(event.target.checked)}
                  className="login-checkbox h-[17px] w-[17px] rounded border-border-strong accent-primary"
                />
                자동 로그인 유지
              </label>
            </div>
            {(error || authError) && (
              <div
                id="login-error"
                role="alert"
                className="rounded-[14px] border border-error/15 bg-error-soft px-4 py-3 text-sm leading-5 text-error"
              >
                {error || authError}
              </div>
            )}
            <Button
              className="login-submit group h-[50px] w-full rounded-[14px] text-[15px]"
              disabled={submitting}
              aria-busy={submitting}
            >
              <span className="login-submit-content inline-flex items-center gap-2">
                {submitting ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={18}
                  />
                ) : null}
                {submitting ? "로그인 중..." : "로그인"}
              </span>
            </Button>
          </div>
          <nav
            className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-3 text-[13px] font-semibold text-primary"
            aria-label="계정 도움말"
          >
            <Link
              className="rounded transition-colors hover:text-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              to="/signup"
            >
              직원 계정 신청
            </Link>
            <Link
              className="rounded transition-colors hover:text-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              to="/find-account"
            >
              아이디 찾기
            </Link>
            <Link
              className="rounded transition-colors hover:text-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              to="/forgot-password"
            >
              비밀번호 찾기
            </Link>
          </nav>
          <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs leading-5 text-text-muted">
            <ShieldCheck aria-hidden="true" size={14} />
            승인된 P&amp;M 구성원만 이용할 수 있습니다.
          </p>
        </form>
      </section>
    </main>
  );
}

function BrandCapability({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof CalendarRange;
  title: string;
  description: string;
}) {
  return (
    <div className="login-capability px-4 py-1">
      <Icon
        aria-hidden="true"
        className="text-[#a8d4ed]"
        size={20}
        strokeWidth={1.8}
      />
      <strong className="mt-4 block text-sm font-semibold text-white">
        {title}
      </strong>
      <span className="mt-1 block text-[11px] leading-5 text-blue-100/66">
        {description}
      </span>
    </div>
  );
}

function ModuleGatePage({
  pendingReturnTo,
}: {
  pendingReturnTo?: unknown;
}) {
  const { chooseModule } = useModule();
  const modules = [
    {
      id: "operations" as const,
      title: "스케줄 관리",
      description: "수업과 회사 일정을 관리합니다",
      icon: CalendarRange,
      accent: "from-[#e9f5fb] to-[#f7fbfd]",
      iconStyle: "bg-[#d9eef8] text-[#276d91]",
    },
    {
      id: "finance" as const,
      title: "매출 관리",
      description: "매출·수납·미수·환불을 관리합니다",
      icon: WalletCards,
      accent: "from-[#edf3f8] to-[#fafcfd]",
      iconStyle: "bg-[#dfeaf3] text-primary",
    },
  ];
  return (
    <main className="module-gate-shell relative flex min-h-[100dvh] items-center justify-center overflow-x-hidden bg-app-background px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
      <div className="module-gate-orb module-gate-orb-one" aria-hidden="true" />
      <div className="module-gate-orb module-gate-orb-two" aria-hidden="true" />
      <section className="relative z-10 w-full max-w-[1080px]">
        <div className="mb-8 text-center sm:mb-11">
          <BrandLogo
            className="mx-auto mb-3 h-[76px] w-[164px]"
            imageClassName="module-gate-logo h-[184px] w-[184px]"
          />
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
            P&amp;M OS
          </p>
          <h1 className="mt-2 text-[clamp(1.75rem,5vw,2.5rem)] font-bold tracking-[-0.04em] text-text-primary">
            어떤 업무를 시작할까요?
          </h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            스케줄 관리와 매출 관리 중 필요한 업무를 선택하세요
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:gap-6">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <button
                key={module.id}
                type="button"
                onClick={() => chooseModule(module.id, pendingReturnTo)}
                className={`module-gate-card group relative min-h-[190px] overflow-hidden rounded-[26px] border border-border bg-gradient-to-br ${module.accent} p-6 text-left shadow-[0_12px_36px_rgba(23,36,58,0.055)] transition duration-200 hover:-translate-y-1 hover:border-primary/35 hover:shadow-[0_20px_48px_rgba(23,36,58,0.11)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 sm:min-h-[230px] sm:p-9`}
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl ${module.iconStyle}`}
                >
                  <Icon size={24} strokeWidth={1.9} />
                </div>
                <div className="mt-9 flex items-end justify-between gap-5">
                  <div>
                    <h2 className="text-xl font-bold tracking-[-0.025em] text-text-primary">
                      {module.title}
                    </h2>
                    <p className="mt-1.5 text-sm text-text-secondary">
                      {module.description}
                    </p>
                  </div>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-strong bg-white/75 text-primary transition group-hover:translate-x-0.5 group-hover:border-primary/30 group-hover:bg-white">
                    <ChevronRight size={19} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function AppSwitcher({ module }: { module: AppModule }) {
  const { switchModule } = useModule();
  return <AppSwitcherMenu module={module} onSwitch={switchModule} />;
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
        className={`app-sidebar fixed inset-y-0 left-0 z-40 flex w-[268px] flex-col text-white shadow-2xl shadow-slate-950/10 transition-transform duration-200 ease-out lg:w-64 lg:translate-x-0 lg:shadow-none ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-[68px] shrink-0 items-center justify-start border-b border-white/[0.035]">
          <BrandLogo className="h-[68px] w-[140px] translate-x-px" imageClassName="h-32 w-32" />
          <button
            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-xl text-blue-100/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="메뉴 닫기"
          >
            <X />
          </button>
        </div>
        <div className="shrink-0 px-3 pb-2 pt-4">
          <AppSwitcher module="finance" />
        </div>
        <nav className="app-sidebar-nav flex-1 overflow-y-auto px-3 pb-2 pt-0.5">
          {(["업무", "관리", "분석"] as const).map((group) => <div key={group} className="mb-4 last:mb-0"><p className="mb-1.5 px-3 text-[9px] font-medium uppercase leading-none tracking-[0.16em] text-blue-100/55">{group}</p><div className="space-y-0.5">{visibleMenus.filter((item) => item.group === group).map(({ to, label, icon: Icon, end }) => (
              <NavLink end={end} key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `app-sidebar-link group relative flex min-h-9 items-center gap-3.5 rounded-[11px] px-3 py-1 text-sm font-medium transition-[color,background-color,transform] duration-150 ${isActive ? "is-active bg-white/[0.075] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" : "text-blue-50/68 hover:translate-x-0.5 hover:bg-white/[0.04] hover:text-white"}`}>
                {({ isActive }) => <><span className={`absolute inset-y-2.5 left-0 w-0.5 rounded-full transition-colors ${isActive ? "bg-[#8fc1e8]" : "bg-transparent"}`} /><Icon size={18} strokeWidth={isActive ? 2.2 : 1.75} /><span>{label}</span></>}
              </NavLink>
            ))}</div></div>)}
        </nav>
        <div className="shrink-0 border-t border-white/[0.055] p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <div className="app-sidebar-profile mb-4 flex items-center gap-1.5 rounded-xl border border-white/[0.045] px-1.5 py-0.5"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-blue-50"><UserRound size={14} /></div><div className="min-w-0 flex-1"><b className="block truncate text-xs text-white">{profile?.name || "이름 미등록"}</b><span className="mt-0.5 block truncate text-[10px] text-blue-100/52">{profile?.role === "admin" ? "관리자" : "직원"} · {user?.email}</span></div></div>
          <button
            onClick={() => void signOut()}
            className="flex min-h-10 w-full items-center gap-3 rounded-[13px] px-2.5 py-2 text-sm text-blue-50/60 transition hover:bg-white/[0.055] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
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
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-[52px] items-center justify-between border-b border-border/80 bg-white/95 px-4 backdrop-blur-md sm:px-6">
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
        <main className={`mx-auto max-w-[1600px] ${location.pathname === "/dashboard" ? "p-4 sm:p-5 lg:p-5" : "p-4 sm:p-6 lg:p-8"}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function OperationsAppLayout() {
  const { signOut, user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current =
    operationsMenus.find((item) =>
      item.end
        ? location.pathname === item.to
        : location.pathname.startsWith(item.to),
    )?.label || "스케줄 관리";
  return (
    <div className="min-h-screen bg-app-background">
      <aside
        className={`app-sidebar fixed inset-y-0 left-0 z-40 flex w-[268px] flex-col text-white shadow-2xl shadow-slate-950/10 transition-transform duration-200 ease-out lg:w-64 lg:translate-x-0 lg:shadow-none ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-[68px] shrink-0 items-center justify-start border-b border-white/[0.035]">
          <BrandLogo
            className="h-[68px] w-[140px] translate-x-px"
            imageClassName="h-32 w-32"
          />
          <button
            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-xl text-blue-100/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="메뉴 닫기"
          >
            <X />
          </button>
        </div>
        <div className="shrink-0 px-3 pb-2 pt-4">
          <AppSwitcher module="operations" />
        </div>
        <nav className="app-sidebar-nav flex-1 overflow-y-auto px-3 pb-2 pt-0.5">
          <div className="mb-4">
            <p className="mb-1.5 px-3 text-[9px] font-medium uppercase leading-none tracking-[0.16em] text-blue-100/55">
              일정
            </p>
            <div className="space-y-0.5">
              {operationsMenus.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  end={end}
                  key={to}
                  to={to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `app-sidebar-link group relative flex min-h-9 items-center gap-3.5 rounded-[11px] px-3 py-1 text-sm font-medium transition-[color,background-color,transform] duration-150 ${
                      isActive
                        ? "is-active bg-white/[0.1] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]"
                        : "text-blue-50/68 hover:translate-x-0.5 hover:bg-white/[0.04] hover:text-white"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`absolute inset-y-2.5 left-0 w-0.5 rounded-full transition-colors ${
                          isActive
                            ? "bg-[#9bd0ec] shadow-[0_0_10px_rgba(155,208,236,0.28)]"
                            : "bg-transparent"
                        }`}
                      />
                      <Icon
                        size={18}
                        strokeWidth={isActive ? 2.2 : 1.75}
                      />
                      <span>{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>
        <div className="shrink-0 border-t border-white/[0.055] p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <div className="app-sidebar-profile mb-4 flex items-center gap-1.5 rounded-xl border border-white/[0.045] px-1.5 py-0.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-blue-50">
              <UserRound size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <b className="block truncate text-xs text-white">
                {profile?.name || "이름 미등록"}
              </b>
              <span className="mt-0.5 block truncate text-[10px] text-blue-100/52">
                {profile?.role === "admin" ? "관리자" : "직원"} · {user?.email}
              </span>
            </div>
          </div>
          <button
            onClick={() => void signOut()}
            className="flex min-h-10 w-full items-center gap-3 rounded-[13px] px-2.5 py-2 text-sm text-blue-50/60 transition hover:bg-white/[0.055] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
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
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-[46px] items-center justify-between border-b border-border/80 bg-white/95 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-strong text-text-secondary transition hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="메뉴 열기"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden text-slate-400 sm:inline">스케줄 관리</span>
              <ChevronRight
                size={14}
                className="hidden text-slate-300 sm:inline"
              />
              <b className="text-text-primary">{current}</b>
            </div>
          </div>
          <div className="hidden items-center gap-2.5 sm:flex">
            <b className="text-sm leading-none text-text-primary">
              {profile?.name || "이름 미등록"}
            </b>
            <span className="rounded-full bg-surface-secondary px-2 py-1 text-[10px] font-medium leading-none text-text-muted">
              {profile?.role === "admin" ? "관리자" : "직원"}
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function OperationsStubPage({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="operations-stub mx-auto max-w-3xl">
      <div className="mb-4">
        <p className="text-[11px] font-bold tracking-[0.17em] text-primary">
          {eyebrow}
        </p>
        <h1 className="mt-1.5 text-2xl font-bold tracking-[-0.035em] text-text-primary sm:text-[1.75rem]">
          {title}
        </h1>
      </div>
      <div className="relative overflow-hidden rounded-[22px] border border-border/80 bg-white px-5 py-10 shadow-[0_8px_24px_rgba(23,36,58,0.035)] sm:px-8 sm:py-12">
        <div className="mx-auto max-w-lg text-center">
          <h2 className="text-lg font-bold tracking-[-0.025em] text-text-primary">
            준비 중
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            {description}
          </p>
        </div>
      </div>
    </section>
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
