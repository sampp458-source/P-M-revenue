import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

export const JOURNAL_REPORT_WIDTH = 1080;
export const JOURNAL_REPORT_HEIGHT = 1440;

export const JOURNAL_REPORT_FONT_FAMILY = 'Pretendard, "Noto Sans KR", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const JOURNAL_REPORT_PALETTE = {
  background: "#fffcf8",
  ink: "#25384a",
  blue: "#2f6284",
  muted: "#667786",
  coral: { surface: "#fffafb", accent: "#ff7f82", border: "#ffd9df", highlight: "#ffe9ed" },
  green: { surface: "#fbfffd", accent: "#62b98a", border: "#cfeede", highlight: "#e6f7ef" },
  amber: { surface: "#fffef8", accent: "#d3a82f", border: "#f5e39d", highlight: "#fff3bc" },
  lavender: { surface: "#fdfcff", accent: "#8a75bc", border: "#ddd4fa", highlight: "#f1ebff" },
} as const;

export type JournalSceneRect = { x: number; y: number; width: number; height: number };

export const JOURNAL_REPORT_LAYOUT = {
  pagePadding: 46,
  outerBorder: { x: 17, y: 17, width: 1046, height: 1406, radius: 52, stroke: 3 },
  header: { x: 46, y: 46, width: 988, height: 235 },
  mainGap: 8,
  daily: { x: 46, y: 297, width: 988, height: 170 },
  mealRelationship: { x: 46, y: 475, width: 988, height: 206 },
  bestFriend: { x: 46, y: 689, width: 988, height: 120 },
  activities: { x: 46, y: 817, width: 988, height: 178 },
  comment: { x: 46, y: 1003, width: 988, height: 391 },
} as const;

export const JOURNAL_REPORT_ASSET_SLOTS = {
  "header-dog-a": { x: 96, y: 52, width: 150, height: 150 },
  "header-dog-b": { x: 821, y: 87, width: 205, height: 142 },
  meal: { x: 293, y: 462, width: 120, height: 90 },
  "best-friend-duo": { x: 182, y: 701, width: 224, height: 108 },
  manners: { x: 52, y: 812, width: 76, height: 52 },
  physical: { x: 934, y: 808, width: 94, height: 62 },
  "teacher-comment-dog": { x: 865, y: 1210, width: 158, height: 174 },
  "official-logo": { x: 430, y: 59, width: 220, height: 86 },
} as const satisfies Record<string, JournalSceneRect>;

export type JournalReportScene = {
  width: typeof JOURNAL_REPORT_WIDTH;
  height: typeof JOURNAL_REPORT_HEIGHT;
  viewModel: JournalPreviewViewModel;
  layout: typeof JOURNAL_REPORT_LAYOUT;
  assetSlots: typeof JOURNAL_REPORT_ASSET_SLOTS;
  palette: typeof JOURNAL_REPORT_PALETTE;
  fontFamily: typeof JOURNAL_REPORT_FONT_FAMILY;
};

export function buildJournalReportScene(viewModel: JournalPreviewViewModel): JournalReportScene {
  return {
    width: JOURNAL_REPORT_WIDTH,
    height: JOURNAL_REPORT_HEIGHT,
    viewModel,
    layout: JOURNAL_REPORT_LAYOUT,
    assetSlots: JOURNAL_REPORT_ASSET_SLOTS,
    palette: JOURNAL_REPORT_PALETTE,
    fontFamily: JOURNAL_REPORT_FONT_FAMILY,
  };
}

export function journalCommentTypography(length: number) {
  if (length <= 120) return { density: "hero", size: 34, lineHeight: 1.58 } as const;
  if (length <= 220) return { density: "large", size: 29, lineHeight: 1.52 } as const;
  if (length <= 320) return { density: "standard", size: 24, lineHeight: 1.45 } as const;
  if (length <= 420) return { density: "compact", size: 21, lineHeight: 1.38 } as const;
  return { density: "minimum-safe", size: 19, lineHeight: 1.32 } as const;
}

export function journalDogNameFontSize(length: number) {
  return length > 20 ? 17 : length > 8 ? 20 : 32;
}

export function journalBestFriendFontSize(length: number) {
  return length > 18 ? 22 : length > 10 ? 30 : 44;
}

export function journalActivityFontSize(length: number) {
  return length > 50 ? 17 : length > 28 ? 21 : 28;
}
