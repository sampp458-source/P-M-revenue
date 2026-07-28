import type { CSSProperties } from "react";

export type DashboardThemeCode = "all" | "daycare" | "training" | "hotel";

type DashboardTheme = {
  code: DashboardThemeCode;
  label: string;
  accent: string;
  accentRgb: string;
  tint1: string;
  tint2: string;
  tint3: string;
  tint4: string;
};

export const dashboardThemeMap: Record<DashboardThemeCode, DashboardTheme> = {
  all: {
    code: "all",
    label: "전체",
    accent: "#274c77",
    accentRgb: "39 76 119",
    tint1: "#f2f6f9",
    tint2: "#e6eff5",
    tint3: "#d5e5ef",
    tint4: "#bfd9e8",
  },
  daycare: {
    code: "daycare",
    label: "유치원",
    accent: "#258db5",
    accentRgb: "37 141 181",
    tint1: "#f1f9fb",
    tint2: "#e2f3f8",
    tint3: "#cdeaf2",
    tint4: "#b2dfea",
  },
  training: {
    code: "training",
    label: "교육센터",
    accent: "#3f5fa8",
    accentRgb: "63 95 168",
    tint1: "#f3f5fb",
    tint2: "#e8edf8",
    tint3: "#d8e0f3",
    tint4: "#c3d0ea",
  },
  hotel: {
    code: "hotel",
    label: "호텔",
    accent: "#b67b2e",
    accentRgb: "182 123 46",
    tint1: "#fbf7f0",
    tint2: "#f6eddd",
    tint3: "#efdfc4",
    tint4: "#e5cfaa",
  },
};

export function dashboardThemeCode(
  code?: string | null,
  name?: string | null,
): DashboardThemeCode {
  if (code === "daycare" || name?.includes("유치원")) return "daycare";
  if (code === "training" || name?.includes("교육")) return "training";
  if (code === "hotel" || name?.includes("호텔")) return "hotel";
  return "all";
}

type DashboardThemeStyle = CSSProperties & {
  "--pm-theme-accent": string;
  "--pm-theme-rgb": string;
  "--pm-theme-tint-1": string;
  "--pm-theme-tint-2": string;
  "--pm-theme-tint-3": string;
  "--pm-theme-tint-4": string;
};

export function dashboardThemeStyle(
  code?: string | null,
  name?: string | null,
): DashboardThemeStyle {
  const theme = dashboardThemeMap[dashboardThemeCode(code, name)];
  return {
    "--pm-theme-accent": theme.accent,
    "--pm-theme-rgb": theme.accentRgb,
    "--pm-theme-tint-1": theme.tint1,
    "--pm-theme-tint-2": theme.tint2,
    "--pm-theme-tint-3": theme.tint3,
    "--pm-theme-tint-4": theme.tint4,
  };
}
