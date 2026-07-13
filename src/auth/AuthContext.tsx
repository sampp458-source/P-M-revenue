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
import { hasAuthIdentityChanged } from "./authStateLogic";

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
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) console.error("세션 확인 실패", error.message);
      sessionUserIdRef.current = data.session?.user.id ?? null;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
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
          if (/already registered|already exists/i.test(error.message)) throw new Error("이미 신청된 이메일입니다.");
          if (/phone|휴대폰|duplicate|unique|database error saving new user/i.test(error.message)) throw new Error("이미 사용 중인 휴대폰 번호입니다.");
          throw new Error("계정 신청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.");
        }
        const emailConfirmationRequired = !data.session;
        if (data.session) await supabase.auth.signOut();
        return { emailConfirmationRequired };
      },
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
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
