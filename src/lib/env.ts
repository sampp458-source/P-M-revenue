const envErrorMessage = {
  VITE_SUPABASE_URL: "Supabase 프로젝트 주소가 설정되지 않았습니다. 환경변수 VITE_SUPABASE_URL을 확인해 주세요.",
  VITE_SUPABASE_ANON_KEY: "Supabase 공개 키가 설정되지 않았습니다. 환경변수 VITE_SUPABASE_ANON_KEY를 확인해 주세요.",
} as const;

function requiredEnv(name: keyof typeof envErrorMessage) {
  const value = import.meta.env[name]?.trim();
  if (!value) {
    throw new Error(envErrorMessage[name]);
  }
  return value;
}

export const env = {
  supabaseUrl: requiredEnv("VITE_SUPABASE_URL"),
  supabaseAnonKey: requiredEnv("VITE_SUPABASE_ANON_KEY"),
  siteUrl: (import.meta.env.VITE_SITE_URL?.trim() || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, ""),
} as const;
