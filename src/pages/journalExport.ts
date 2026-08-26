import { renderJournalReportToCanvas, validateJournalEncodedBlob, type JournalCanvasRenderMetrics } from "./journalCanvasRenderer";
import { buildJournalReportScene, JOURNAL_REPORT_HEIGHT, JOURNAL_REPORT_WIDTH } from "./journalReportScene";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

export type JournalExportFormat = "png" | "jpg";

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

export async function renderJournalImageBlob(viewModel: JournalPreviewViewModel, format: JournalExportFormat) {
  return runSerializedExport(async () => {
    const scene = buildJournalReportScene(viewModel);
    const { canvas, metrics } = await renderJournalReportToCanvas(scene);
    if (canvas.width !== JOURNAL_EXPORT_WIDTH || canvas.height !== JOURNAL_EXPORT_HEIGHT) {
      throw new Error("JOURNAL_EXPORT_SIZE_MISMATCH");
    }
    if (metrics.verifiedAssetSlots !== metrics.requiredAssetSlots || metrics.requiredAssetSlots !== 7) {
      throw new Error("JOURNAL_EXPORT_ASSET_PIXEL_VALIDATION_FAILED");
    }
    const blob = await canvasToBlob(canvas, format);
    await validateJournalEncodedBlob(blob, scene, metrics);
    canvas.width = 1;
    canvas.height = 1;
    return blob;
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
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

export async function exportJournalImage(viewModel: JournalPreviewViewModel, format: JournalExportFormat) {
  const blob = await renderJournalImageBlob(viewModel, format);
  const filename = buildJournalExportFilename(viewModel.dogName, viewModel.businessDate, format);
  downloadJournalBlob(blob, filename);
  return { blob, filename };
}

export type { JournalCanvasRenderMetrics };
