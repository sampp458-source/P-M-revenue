import { useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Boxes,
  ChevronRight,
  ClipboardPlus,
  Dog,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  Settings,
  UserCog,
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

interface MenuItem { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; adminOnly?: boolean }
const menus: MenuItem[] = [
  { to: "/dashboard", label: "대시보드", icon: LayoutDashboard },
  { to: "/sales/new", label: "매출 등록", icon: ClipboardPlus },
  { to: "/sales", label: "매출 내역", icon: ReceiptText, end: true },
  { to: "/customers", label: "반려견 관리", icon: Dog },
  { to: "/categories", label: "상품 분류 관리", icon: Boxes },
  { to: "/products", label: "상품 관리", icon: Package },
  { to: "/reports", label: "월별 보고서", icon: BarChart3 },
  { to: "/settings", label: "설정", icon: Settings },
  { to: "/staff", label: "직원 관리", icon: UserCog, adminOnly: true },
];
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
        element={
          loggedIn ? <Navigate to="/dashboard" replace /> : <LoginPage />
        }
      />
      <Route path="/signup" element={loggedIn ? <Navigate to="/dashboard" replace /> : <SignupPage />} />
      <Route path="/find-account" element={<FindAccountPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={loggedIn ? <AppLayout /> : <Navigate to="/login" replace />}
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

function LoginPage() {
  const { signIn, authError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
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
    <main className="flex min-h-screen bg-[#f0f3f1]">
      <section className="hidden w-[45%] flex-col justify-between bg-[#1e3a5f] p-12 text-white lg:flex">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-lg font-black text-[#1e3a5f]">
          P&M
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-emerald-200">
            P&M INTERNAL SYSTEM
          </p>
          <h1 className="max-w-md text-4xl font-bold leading-tight">
            매출을 더 정확하게,
            <br />
            업무를 더 간편하게.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-6 text-emerald-100/80">
            상품, 고객, 반려견, 매출 현황을 하나의 내부 프로그램에서 관리합니다.
          </p>
        </div>
        <p className="text-xs text-emerald-100/60">P&M 임직원 전용 프로그램</p>
      </section>
      <section className="flex flex-1 items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1e3a5f] text-sm font-black text-white">
              P&M
            </div>
          </div>
          <h2 className="text-3xl font-bold text-slate-900">로그인</h2>
          <p className="mt-2 text-sm text-slate-500">
            업무 계정으로 로그인해 주세요.
          </p>
          <div className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">이메일</span>
              <Input
                ref={emailRef}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                aria-invalid={Boolean(error && !email)}
                aria-describedby={error ? "login-error" : undefined}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">
                비밀번호
              </span>
              <Input
                ref={passwordRef}
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                aria-invalid={Boolean(error && !password)}
                aria-describedby={error ? "login-error" : undefined}
              />
            </label>
            {(error || authError) && (
              <p id="login-error" role="alert" className="text-sm text-red-600">{error || authError}</p>
            )}
            <Button className="w-full" disabled={submitting}>
              {submitting ? "로그인 중..." : "로그인"}
            </Button>
          </div>
          <p className="mt-5 rounded-lg bg-slate-100 p-3 text-xs leading-5 text-slate-500">
            P&amp;M에서 발급한 내부 업무 계정으로만 로그인할 수 있습니다.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-semibold text-blue-700"><Link className="hover:underline" to="/signup">직원 계정 신청</Link><Link className="hover:underline" to="/find-account">아이디 찾기</Link><Link className="hover:underline" to="/forgot-password">비밀번호 찾기</Link></div>
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
  return (
    <div className="min-h-screen bg-[#f4f6f5]">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#1e3a5f] text-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-18 items-center justify-between border-b border-white/10 px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-xs font-black text-[#1e3a5f]">
              P&M
            </div>
            <div>
              <b className="block text-sm">매출관리</b>
              <span className="text-[11px] text-emerald-100/60">INTERNAL</span>
            </div>
          </div>
          <button
            className="lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="메뉴 닫기"
          >
            <X />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {menus.filter((item) => !item.adminOnly || profile?.role === "admin").map(({ to, label, icon: Icon, end }) => (
            <NavLink
              end={end}
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? "bg-white text-[#1e3a5f]" : "text-emerald-50/80 hover:bg-white/10 hover:text-white"}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <button
            onClick={() => void signOut()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-emerald-50/80 hover:bg-white/10"
          >
            <LogOut size={18} />
            로그아웃
          </button>
        </div>
      </aside>
      {open && (
        <button
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="메뉴 배경 닫기"
        />
      )}
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-18 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border p-2 lg:hidden"
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
              <b>{current}</b>
            </div>
          </div>
          <div className="text-right">
            <b className="block text-sm">
              {profile?.name || "이름 미등록"} · {profile?.role === "admin" ? "관리자" : "직원"}
            </b>
            <span className="text-xs text-slate-500">{user?.email}</span>
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
