import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { clearAllSaleDrafts } from "../pages/saleRegistrationDraft";
import { clearModuleSessionState } from "../app/moduleState";
import {
  hasAuthIdentityChanged,
  shouldIgnoreInitialEmptySession,
} from "./authStateLogic";

export interface Profile {
  id: string;
  name: string;
  role: "admin" | "staff";
  isActive: boolean;
  accountStatus: "pending" | "active" | "rejected" | "inactive";
}

export interface BusinessUnit {
  id: string;
  code: "daycare" | "training" | "hotel";
  name: string;
  sortOrder: number;
}

interface AuthValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  businessUnits: BusinessUnit[];
  loading: boolean;
  authError: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, phone: string, email: string, password: string) => Promise<{ emailConfirmationRequired: boolean }>;
  signOut: () => Promise<void>;
}

interface SignupErrorLike {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
}

export function signupFailureMessage(error: SignupErrorLike) {
  const code = error.code?.toLowerCase() ?? "";
  const message = error.message?.toLowerCase() ?? "";
  if (
    error.status === 429 ||
    code.includes("rate_limit") ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  ) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (
    code.includes("email_address_invalid") ||
    message.includes("invalid email")
  ) {
    return "올바른 이메일 주소를 입력해 주세요.";
  }
  if (code.includes("weak_password") || message.includes("password")) {
    return "비밀번호는 8자 이상이어야 합니다.";
  }
  if (
    code.includes("user_already_exists") ||
    message.includes("already registered") ||
    message.includes("already exists")
  ) {
    return "이미 가입되었거나 신청 중인 이메일입니다.";
  }
  if (
    message.includes("휴대폰") ||
    (message.includes("phone") &&
      (message.includes("duplicate") || message.includes("unique")))
  ) {
    return "이미 사용 중인 휴대전화 번호입니다.";
  }
  if (
    code.includes("unexpected_failure") ||
    message.includes("database error saving new user")
  ) {
    return "계정 정보 저장에 실패했습니다. 관리자에게 문의해 주세요.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "네트워크 연결을 확인한 후 다시 시도해 주세요.";
  }
  return `계정 신청을 처리하지 못했습니다. 관리자에게 문의해 주세요.${
    error.code ? ` (오류 코드: ${error.code})` : ""
  }`;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const sessionUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let initialSessionResolved = false;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      initialSessionResolved = true;
      if (error) console.error("세션 확인 실패", error.message);
      sessionUserIdRef.current = data.session?.user.id ?? null;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      if (shouldIgnoreInitialEmptySession(initialSessionResolved, nextUserId)) return;
      const identityChanged = hasAuthIdentityChanged(sessionUserIdRef.current, nextUserId);
      sessionUserIdRef.current = nextUserId;
      setSession(nextSession);
      if (!nextSession) setLoading(false);
      else if (identityChanged) setLoading(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) {
      setProfile(null);
      setBusinessUnits([]);
      setLoading(false);
      return;
    }
    if (typeof window !== "undefined" && window.location.pathname === "/reset-password") {
      setProfile(null);
      setBusinessUnits([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setAuthError("");

    void (async () => {
      try {
        const profileResult = await supabase
            .from("profiles")
            .select("id, name, role, is_active, account_status")
            .eq("id", userId)
            .single();
        if (!active) return;
        if (profileResult.error || !profileResult.data) {
          setAuthError("계정 권한 정보를 불러오지 못했습니다.");
          await supabase.auth.signOut();
          return;
        }
        const accountStatus = profileResult.data.account_status as Profile["accountStatus"];
        const blockedMessage = {
          pending: "관리자 승인 대기 중인 계정입니다.",
          rejected: "승인되지 않은 계정입니다. 관리자에게 문의해주세요.",
          inactive: "사용이 중지된 계정입니다. 관리자에게 문의해주세요.",
        }[accountStatus as "pending" | "rejected" | "inactive"];
        if (accountStatus !== "active" || !profileResult.data.is_active) {
          setAuthError(blockedMessage || "사용이 중지된 계정입니다. 관리자에게 문의해주세요.");
          await supabase.auth.signOut();
          return;
        }
        const unitsResult = await supabase.from("business_units").select("*").order("sort_order");
        if (!active) return;
        if (unitsResult.error) {
          setAuthError("사업부 정보를 불러오지 못했습니다.");
          await supabase.auth.signOut();
          return;
        }
        const expectedUnits = [
          ["daycare", "유치원"],
          ["training", "교육센터"],
          ["hotel", "호텔"],
        ];
        const hasAllBusinessUnits = expectedUnits.every(([code, name]) =>
          unitsResult.data?.some(
            (unit) => unit.code === code && unit.name === name && unit.is_active,
          ),
        );
        if (!hasAllBusinessUnits) {
          setAuthError("필수 사업부 정보를 확인할 수 없습니다. 관리자에게 문의하세요.");
          await supabase.auth.signOut();
          return;
        }

        setProfile({
          id: profileResult.data.id,
          name: profileResult.data.name,
          role: profileResult.data.role as Profile["role"],
          isActive: profileResult.data.is_active,
          accountStatus,
        });
        setBusinessUnits(
          (unitsResult.data ?? []).map((unit) => ({
            id: unit.id,
            code: unit.code as BusinessUnit["code"],
            name: unit.name,
            sortOrder: unit.sort_order,
          })),
        );
        setLoading(false);
      } catch (error) {
        if (!active) return;
        console.error(
          "[Auth Debug] business_units 네트워크 또는 실행 예외:",
          error,
        );
        setAuthError("서버 연결에 실패했습니다. 잠시 후 다시 시도하세요.");
        await supabase.auth.signOut();
      }
    })();

    return () => {
      active = false;
    };
  }, [session?.user.id]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      businessUnits,
      loading,
      authError,
      signIn: async (email, password) => {
        setAuthError("");
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          console.error("[Auth] 로그인 실패:", {
            name: error.name,
            message: error.message,
            status: error.status,
            code: error.code,
          });
          if (error.message.toLowerCase().includes("invalid login credentials")) {
            throw new Error("이메일 또는 비밀번호가 올바르지 않습니다.");
          }
          throw new Error(`로그인 실패: ${error.message}`);
        }
      },
      signUp: async (name, phone, email, password) => {
        setAuthError("");
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name: name.trim(), phone } } });
        if (error) {
          console.error("[Auth] 계정 신청 실패", {
            status: error.status,
            code: error.code,
            name: error.name,
            message: error.message,
          });
          throw new Error(signupFailureMessage(error));
        }
        if (data.user?.identities?.length === 0) {
          console.warn("[Auth] 기존 이메일로 계정 신청이 중복 요청되었습니다.", {
            userId: data.user.id,
          });
          throw new Error("이미 가입되었거나 신청 중인 이메일입니다.");
        }
        const emailConfirmationRequired = !data.session;
        if (data.session && data.user) {
          const profileResult = await supabase
            .from("profiles")
            .select("id")
            .eq("id", data.user.id)
            .maybeSingle();
          if (profileResult.error || !profileResult.data) {
            console.error("[Auth] Auth 생성 후 Profile 확인 실패", {
              userId: data.user.id,
              status: profileResult.status,
              code: profileResult.error?.code,
              message: profileResult.error?.message,
              details: profileResult.error?.details,
            });
            await supabase.auth.signOut();
            throw new Error(
              "인증 계정은 생성됐지만 계정 정보 저장을 확인하지 못했습니다. 관리자에게 문의해 주세요.",
            );
          }
          await supabase.auth.signOut();
        }
        return { emailConfirmationRequired };
      },
      signOut: async () => {
        const userId = session?.user.id;
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        if (userId) clearModuleSessionState(userId);
        try {
          clearAllSaleDrafts(window.sessionStorage);
        } catch {
          // Session storage restrictions must not prevent logout.
        }
      },
    }),
    [authError, businessUnits, loading, profile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider가 필요합니다.");
  return value;
}
