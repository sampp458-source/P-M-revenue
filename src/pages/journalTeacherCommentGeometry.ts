import { normalizeJournalTeacherComment } from "./journalTextNormalization";
import {
  JOURNAL_TEACHER_COMMENT_FONT_SIZES,
  journalCommentTypography,
  type JournalTeacherCommentFontSize,
} from "./journalReportScene";

export type JournalTeacherCommentGeometry = {
  available: boolean;
  lineCount: number;
  maxLines: number;
  requiredHeight: number;
  availableHeight: number;
  bottomRemaining: number;
  overflow: boolean;
  dogCollision: boolean;
  recommendedSize: JournalTeacherCommentFontSize | null;
};

function wrapLineCount(context: CanvasRenderingContext2D, value: string, width: number) {
  let count = 0;
  normalizeJournalTeacherComment(value).split("\n").forEach((paragraph) => {
    let current = "";
    Array.from(paragraph).forEach((character) => {
      const next = current + character;
      if (current && context.measureText(next).width > width) {
        count += 1;
        current = character;
      } else {
        current = next;
      }
    });
    if (current || paragraph === "") count += 1;
  });
  return count;
}

function contextFor(fontFamily: string, size: JournalTeacherCommentFontSize) {
  if (typeof document === "undefined") return null;
  if (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) return null;
  let context: CanvasRenderingContext2D | null = null;
  try { context = document.createElement("canvas").getContext("2d"); } catch { return null; }
  if (!context) return null;
  const typography = journalCommentTypography(0, size);
  context.font = `400 ${size}px ${fontFamily}`;
  (context as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${typography.letterSpacing}px`;
  return context;
}

function measured(value: string, fontFamily: string, size: JournalTeacherCommentFontSize) {
  const typography = journalCommentTypography(value.length, size);
  const context = contextFor(fontFamily, size);
  const normalized = normalizeJournalTeacherComment(value);
  const lineCount = context
    ? wrapLineCount(context, normalized, typography.textWidth)
    : typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")
      ? normalized.split("\n").reduce((count, paragraph) => count + Math.max(1, Math.ceil(Array.from(paragraph).length * size * 0.92 / typography.textWidth)), 0)
      : 0;
  if (!context && lineCount === 0) return null;
  const maxLines = Math.floor(typography.availableHeight / (size * typography.lineHeight));
  const requiredHeight = lineCount * size * typography.lineHeight;
  return {
    lineCount,
    maxLines,
    requiredHeight,
    availableHeight: typography.availableHeight,
    bottomRemaining: typography.availableHeight - requiredHeight,
    overflow: lineCount > maxLines,
  };
}

export function measureJournalTeacherCommentGeometry(
  value: string,
  fontFamily: string,
  size: JournalTeacherCommentFontSize,
): JournalTeacherCommentGeometry {
  const result = measured(value, fontFamily, size);
  if (!result) {
    return {
      available: false,
      lineCount: 0,
      maxLines: 0,
      requiredHeight: 0,
      availableHeight: journalCommentTypography(value.length, size).availableHeight,
      bottomRemaining: 0,
      overflow: true,
      dogCollision: true,
      recommendedSize: null,
    };
  }
  const recommendedSize = result.overflow
    ? [...JOURNAL_TEACHER_COMMENT_FONT_SIZES]
      .reverse()
      .find((candidate) => candidate < size && measured(value, fontFamily, candidate)?.overflow === false) ?? null
    : size;
  return {
    available: true,
    ...result,
    dogCollision: result.overflow,
    recommendedSize,
  };
}

export function assertJournalTeacherCommentGeometry(
  value: string,
  fontFamily: string,
  size: JournalTeacherCommentFontSize,
) {
  const geometry = measureJournalTeacherCommentGeometry(value, fontFamily, size);
  if (!geometry.available) throw new Error("JOURNAL_TEACHER_COMMENT_GEOMETRY_UNAVAILABLE");
  if (geometry.overflow) throw new Error("JOURNAL_TEACHER_COMMENT_OVERFLOW");
  return geometry;
}
