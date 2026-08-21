import { toCanvas } from "html-to-image";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

export type JournalExportFormat = "png" | "jpg";

export const JOURNAL_EXPORT_WIDTH = 1080;
export const JOURNAL_EXPORT_HEIGHT = 1440;
export const JOURNAL_EXPORT_SUPERSAMPLE = 2;
const JOURNAL_EXPORT_BACKGROUND = "#fffcf8";
const JOURNAL_JPG_QUALITY = 0.95;

const invalidFilenameCharacters = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

function sanitizeFilenamePart(value: string) {
  return Array.from(value.normalize("NFC"), (character) =>
    invalidFilenameCharacters.has(character) || character.charCodeAt(0) < 32 ? " " : character
  ).join("").trim().replace(/\s+/g, "_");
}

export function buildJournalExportFilename(
  dogName: string,
  businessDate: string,
  format: JournalExportFormat,
) {
  const safeDogName = Array.from(sanitizeFilenamePart(dogName))
    .slice(0, 32).join("").replace(/[. ]+$/g, "") || "반려견";
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(businessDate) ? businessDate : "날짜미정";
  return `P&M_하루일지_${safeDogName}_${safeDate}.${format}`;
}

function waitForImage(image: HTMLImageElement) {
  if (image.complete && image.naturalWidth > 0) {
    return typeof image.decode === "function" ? image.decode() : Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      image.removeEventListener("load", loaded);
      image.removeEventListener("error", failed);
    };
    const loaded = () => { done(); resolve(); };
    const failed = () => { done(); reject(new Error("JOURNAL_EXPORT_ASSET_LOAD_FAILED")); };
    image.addEventListener("load", loaded, { once: true });
    image.addEventListener("error", failed, { once: true });
  });
}

export async function waitForJournalAssets(root: HTMLElement) {
  if (document.fonts) await document.fonts.ready;
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map(waitForImage));
  if (images.some((image) => !image.complete || image.naturalWidth <= 0)) {
    throw new Error("JOURNAL_EXPORT_ASSET_LOAD_FAILED");
  }
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

function createFinalCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = JOURNAL_EXPORT_WIDTH;
  canvas.height = JOURNAL_EXPORT_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("JOURNAL_EXPORT_CANVAS_UNAVAILABLE");
  context.fillStyle = JOURNAL_EXPORT_BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, source.width, source.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function renderJournalImageBlob(
  root: HTMLElement,
  format: JournalExportFormat,
  supersample = JOURNAL_EXPORT_SUPERSAMPLE,
) {
  await waitForJournalAssets(root);
  const rasterWidth = JOURNAL_EXPORT_WIDTH * supersample;
  const rasterHeight = JOURNAL_EXPORT_HEIGHT * supersample;
  const sourceCanvas = await toCanvas(root, {
    width: JOURNAL_EXPORT_WIDTH,
    height: JOURNAL_EXPORT_HEIGHT,
    canvasWidth: rasterWidth,
    canvasHeight: rasterHeight,
    pixelRatio: 1,
    backgroundColor: JOURNAL_EXPORT_BACKGROUND,
    cacheBust: true,
    skipAutoScale: true,
  });
  if (sourceCanvas.width !== rasterWidth || sourceCanvas.height !== rasterHeight) {
    throw new Error("JOURNAL_EXPORT_RASTER_SIZE_MISMATCH");
  }
  const finalCanvas = createFinalCanvas(sourceCanvas);
  sourceCanvas.width = 1;
  sourceCanvas.height = 1;
  if (finalCanvas.width !== JOURNAL_EXPORT_WIDTH || finalCanvas.height !== JOURNAL_EXPORT_HEIGHT) {
    throw new Error("JOURNAL_EXPORT_SIZE_MISMATCH");
  }
  return canvasToBlob(finalCanvas, format);
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

export async function exportJournalImage(
  root: HTMLElement,
  viewModel: JournalPreviewViewModel,
  format: JournalExportFormat,
) {
  const blob = await renderJournalImageBlob(root, format);
  const filename = buildJournalExportFilename(viewModel.dogName, viewModel.businessDate, format);
  downloadJournalBlob(blob, filename);
  return { blob, filename };
}
