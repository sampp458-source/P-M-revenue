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
  physical: { x: 940, y: 808, width: 94, height: 62 },
  "teacher-comment-dog": { x: 865, y: 1210, width: 158, height: 174 },
  "official-logo": { x: 430, y: 66, width: 220, height: 86 },
} as const satisfies Record<string, JournalSceneRect>;

export const JOURNAL_REPORT_VISUAL_REGIONS = {
  "official-logo": JOURNAL_REPORT_ASSET_SLOTS["official-logo"],
  "header-underline": { x: 407, y: 202, width: 266, height: 22 },
  "condition-icon": { x: 70, y: 301, width: 36, height: 36 },
  "toilet-icon": { x: 523, y: 301, width: 36, height: 36 },
  "meal-icon": { x: 72, y: 487, width: 36, height: 36 },
  "relationship-icon": { x: 447, y: 487, width: 36, height: 36 },
  "manners-icon": { x: 129, y: 825, width: 36, height: 36 },
  "physical-icon": { x: 562, y: 825, width: 36, height: 36 },
  "comment-icon": { x: 80, y: 1019, width: 40, height: 40 },
  "comment-quote": { x: 76, y: 1064, width: 32, height: 52 },
  "best-friend-blue-underline": { x: 398, y: 792, width: 286, height: 7 },
  "best-friend-pink-accent": { x: 288, y: 708, width: 68, height: 58 },
  "selected-option-marks": { x: 70, y: 342, width: 940, height: 642 },
} as const satisfies Record<string, JournalSceneRect>;

export const JOURNAL_REQUIRED_VISUAL_ELEMENT_IDS = Object.keys(JOURNAL_REPORT_VISUAL_REGIONS) as Array<keyof typeof JOURNAL_REPORT_VISUAL_REGIONS>;

export const JOURNAL_REPORT_TYPOGRAPHY = {
  heading: { size: 26, weight: 900, lineHeight: 36, letterSpacing: -0.65 },
  smallLabel: { size: 18, weight: 800, lineHeight: 23, letterSpacing: 0 },
  option: { size: 22, weight: 600, selectedWeight: 900, lineHeight: 25.08, letterSpacing: 0 },
  compactOption: { size: 19, weight: 600, selectedWeight: 900, lineHeight: 21.66, letterSpacing: 0 },
  commentHeading: { size: 27, weight: 900, lineHeight: 40, letterSpacing: -0.675 },
} as const;

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
  const bands = [
    { limit: 120, density: "hero", size: 34, lineHeight: 1.58 },
    { limit: 220, density: "large", size: 28, lineHeight: 1.5 },
    { limit: 320, density: "standard", size: 23, lineHeight: 1.42 },
    { limit: 420, density: "compact", size: 20.5, lineHeight: 1.36 },
    { limit: 500, density: "minimum-safe", size: 19, lineHeight: 1.32 },
  ] as const;
  const bandIndex = bands.findIndex((band) => length <= band.limit);
  const resolvedIndex = bandIndex === -1 ? bands.length - 1 : bandIndex;
  const band = bands[resolvedIndex];
  if (resolvedIndex === bands.length - 1 && length > bands[bands.length - 2].limit) {
    return { density: band.density, size: band.size, lineHeight: band.lineHeight };
  }
  const next = bands[resolvedIndex + 1];
  const transitionStart = band.limit - 29;
  if (!next || length < transitionStart) return band;
  const progress = Math.min(1, Math.max(0, (length - transitionStart) / (band.limit - transitionStart)));
  return {
    density: band.density,
    size: Math.round((band.size + (next.size - band.size) * progress) * 100) / 100,
    lineHeight: Math.round((band.lineHeight + (next.lineHeight - band.lineHeight) * progress) * 1000) / 1000,
  };
}

export function journalDogNameFontSize(length: number) {
  return length > 20 ? 17 : length > 8 ? 20 : 32;
}

export function journalBestFriendFontSize(length: number) {
  return length > 24 ? 24 : length > 18 ? 28 : length > 10 ? 30 : 44;
}

export function journalActivityFontSize(length: number) {
  return length > 50 ? 17 : length > 28 ? 21 : 28;
}

export function journalTeacherCommentDogSlot(length: number): JournalSceneRect {
  const density = journalCommentTypography(length).density;
  const size = density === "minimum-safe" ? { width: 72, height: 80 }
    : density === "compact" ? { width: 90, height: 98 }
      : density === "standard" ? { width: 112, height: 124 }
        : density === "large" ? { width: 145, height: 160 }
          : { width: 158, height: 174 };
  return { x: 1023 - size.width, y: 1387 - size.height, ...size };
}
