import { renderJournalReportToCanvas, validateJournalEncodedBlob, type JournalCanvasRenderMetrics } from "./journalCanvasRenderer";
import { buildJournalReportScene, JOURNAL_REPORT_HEIGHT, JOURNAL_REPORT_WIDTH } from "./journalReportScene";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";
import { resolveJournalTeacherCommentPresentation, type JournalTeacherCommentPresentation } from "./journalCustomFont";
import { assertJournalTeacherCommentGeometry } from "./journalTeacherCommentGeometry";

export type JournalExportFormat = "png" | "jpg";
export type JournalImageRenderStage = "RENDER" | "ENCODE" | "VALIDATION";
export type JournalImageRenderObserver = (event: {
  stage: JournalImageRenderStage;
  state: "START" | "ACK";
  canvasWidth?: number;
  canvasHeight?: number;
  encodedByteSize?: number;
}) => void;

export const JOURNAL_EXPORT_WIDTH = JOURNAL_REPORT_WIDTH;
export const JOURNAL_EXPORT_HEIGHT = JOURNAL_REPORT_HEIGHT;
const JOURNAL_JPG_QUALITY = 0.95;
let exportQueue: Promise<void> = Promise.resolve();

const invalidFilenameCharacters = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

function sanitizeFilenamePart(value: string) {
  return Array.from(value.normalize("NFC"), (character) =>
    invalidFilenameCharacters.has(character) || character.charCodeAt(0) < 32 ? " " : character
  ).join("").trim().replace(/\s+/g, "_");
}

export function buildJournalExportFilename(dogName: string, businessDate: string, format: JournalExportFormat) {
  const safeDogName = Array.from(sanitizeFilenamePart(dogName))
    .slice(0, 32).join("").replace(/[. ]+$/g, "") || "반려견";
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(businessDate) ? businessDate : "날짜미정";
  return `P&M_하루일지_${safeDogName}_${safeDate}.${format}`;
}

function runSerializedExport<T>(task: () => Promise<T>) {
  const running = exportQueue.then(task, task);
  exportQueue = running.then(() => undefined, () => undefined);
  return running;
}

function canvasToBlob(canvas: HTMLCanvasElement, format: JournalExportFormat) {
  const mimeType = format === "png" ? "image/png" : "image/jpeg";
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("JOURNAL_EXPORT_ENCODING_FAILED")),
      mimeType,
      format === "jpg" ? JOURNAL_JPG_QUALITY : undefined,
    );
  });
}

export async function renderJournalImageBlob(
  viewModel: JournalPreviewViewModel,
  format: JournalExportFormat,
  onStage?: JournalImageRenderObserver,
  resolvedPresentation?: JournalTeacherCommentPresentation,
) {
  return runSerializedExport(async () => {
    const presentation = resolvedPresentation ?? await resolveJournalTeacherCommentPresentation(viewModel.entryId);
    assertJournalTeacherCommentGeometry(viewModel.teacherComment, presentation.fontFamily, presentation.fontSize);
    const scene = buildJournalReportScene(viewModel, presentation.fontFamily, presentation.fontSize);
    let canvas: HTMLCanvasElement | null = null;
    try {
      onStage?.({ stage: "RENDER", state: "START" });
      const rendered = await renderJournalReportToCanvas(scene);
      canvas = rendered.canvas;
      const { metrics } = rendered;
      if (canvas.width !== JOURNAL_EXPORT_WIDTH || canvas.height !== JOURNAL_EXPORT_HEIGHT) {
        throw new Error("JOURNAL_EXPORT_SIZE_MISMATCH");
      }
      if (metrics.verifiedAssetSlots !== metrics.requiredAssetSlots || metrics.requiredAssetSlots !== 7) {
        throw new Error("JOURNAL_EXPORT_ASSET_PIXEL_VALIDATION_FAILED");
      }
      if (metrics.verifiedVisualElements !== metrics.requiredVisualElements || metrics.requiredVisualElements <= 0) {
        throw new Error("JOURNAL_EXPORT_VISUAL_COMPLETENESS_FAILED");
      }
      if (metrics.verifiedTextLandmarks !== metrics.requiredTextLandmarks || metrics.requiredTextLandmarks <= 0) {
        throw new Error("JOURNAL_EXPORT_TEXT_LANDMARKS_MISSING");
      }
      onStage?.({ stage: "RENDER", state: "ACK", canvasWidth: canvas.width, canvasHeight: canvas.height });

      onStage?.({ stage: "ENCODE", state: "START", canvasWidth: canvas.width, canvasHeight: canvas.height });
      const blob = await canvasToBlob(canvas, format);
      onStage?.({ stage: "ENCODE", state: "ACK", canvasWidth: canvas.width, canvasHeight: canvas.height, encodedByteSize: blob.size });

      onStage?.({ stage: "VALIDATION", state: "START", canvasWidth: canvas.width, canvasHeight: canvas.height, encodedByteSize: blob.size });
      await validateJournalEncodedBlob(blob, scene, metrics);
      onStage?.({ stage: "VALIDATION", state: "ACK", canvasWidth: canvas.width, canvasHeight: canvas.height, encodedByteSize: blob.size });
      return blob;
    } finally {
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
    }
  });
}

export function downloadJournalBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}

export async function exportJournalImage(viewModel: JournalPreviewViewModel, format: JournalExportFormat) {
  const blob = await renderJournalImageBlob(viewModel, format);
  const filename = buildJournalExportFilename(viewModel.dogName, viewModel.businessDate, format);
  downloadJournalBlob(blob, filename);
  return { blob, filename };
}

export type { JournalCanvasRenderMetrics };
