import { toCanvas } from "html-to-image";
import { buildJournalPreviewRenderKey, isCurrentJournalRasterCacheEntry, isCurrentJournalTemplateRoot, type JournalRasterCacheEntry } from "./journalRenderContract";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

export type JournalExportFormat = "png" | "jpg";

export const JOURNAL_EXPORT_WIDTH = 1080;
export const JOURNAL_EXPORT_HEIGHT = 1440;
export const JOURNAL_EXPORT_SUPERSAMPLE = 2;
export type JournalRasterPipeline = "direct" | "supersampled";
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
  if (image.complete) {
    if (image.naturalWidth <= 0) return Promise.reject(new Error("JOURNAL_EXPORT_ASSET_LOAD_FAILED"));
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

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("JOURNAL_EXPORT_ASSET_INLINE_FAILED"));
    reader.readAsDataURL(blob);
  });
}

const journalAssetDataUrlCache = new Map<string, Promise<string>>();

function loadJournalAssetDataUrl(source: string) {
  const cached = journalAssetDataUrlCache.get(source);
  if (cached) return cached;
  const loading = fetch(source, { cache: "force-cache", credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) throw new Error("JOURNAL_EXPORT_ASSET_INLINE_FAILED");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("JOURNAL_EXPORT_ASSET_INLINE_FAILED");
      return blobToDataUrl(blob);
    })
    .catch((error) => {
      journalAssetDataUrlCache.delete(source);
      throw error;
    });
  journalAssetDataUrlCache.set(source, loading);
  return loading;
}

export async function inlineJournalSnapshotImages(root: HTMLElement) {
  await waitForJournalAssets(root);
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map(async (image) => {
    const source = image.currentSrc || image.src;
    if (!source || source.startsWith("data:")) return;
    image.src = await loadJournalAssetDataUrl(source);
    image.dataset.journalAssetInlined = "true";
  }));
  await waitForJournalAssets(root);
  if (images.some((image) => !image.src.startsWith("data:"))) {
    throw new Error("JOURNAL_EXPORT_ASSET_INLINE_FAILED");
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

export async function encodeJournalPreviewBlob(pngBlob: Blob, format: JournalExportFormat) {
  if (format === "png") return pngBlob;
  const canvas = document.createElement("canvas");
  canvas.width = JOURNAL_EXPORT_WIDTH;
  canvas.height = JOURNAL_EXPORT_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("JOURNAL_EXPORT_CANVAS_UNAVAILABLE");
  context.fillStyle = JOURNAL_EXPORT_BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const objectUrl = URL.createObjectURL(pngBlob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("JOURNAL_EXPORT_DECODE_FAILED"));
    });
    if (typeof image.decode === "function") await image.decode();
    if (image.naturalWidth !== JOURNAL_EXPORT_WIDTH || image.naturalHeight !== JOURNAL_EXPORT_HEIGHT) {
      throw new Error("JOURNAL_EXPORT_SOURCE_SIZE_MISMATCH");
    }
    context.drawImage(image, 0, 0);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return canvasToBlob(canvas, "jpg");
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

function createCanonicalSnapshot(root: HTMLElement) {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dataset.journalExportSnapshot = "true";
  Object.assign(host.style, {
    position: "fixed",
    left: "-12000px",
    top: "0",
    width: `${JOURNAL_EXPORT_WIDTH}px`,
    height: `${JOURNAL_EXPORT_HEIGHT}px`,
    overflow: "hidden",
    pointerEvents: "none",
  });
  const snapshot = root.cloneNode(true) as HTMLElement;
  snapshot.dataset.journalCanonicalSnapshot = "true";
  host.appendChild(snapshot);
  document.body.appendChild(host);
  return { host, snapshot };
}

async function rasterizeJournalSnapshot(root: HTMLElement, pipeline: JournalRasterPipeline) {
  if (!isCurrentJournalTemplateRoot(root)) {
    throw new Error("JOURNAL_RENDER_SOURCE_VERSION_MISMATCH");
  }
  const { host, snapshot } = createCanonicalSnapshot(root);
  try {
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
      else resolve();
    });
    await inlineJournalSnapshotImages(snapshot);
    const supersample = pipeline === "supersampled" ? JOURNAL_EXPORT_SUPERSAMPLE : 1;
    const rasterWidth = JOURNAL_EXPORT_WIDTH * supersample;
    const rasterHeight = JOURNAL_EXPORT_HEIGHT * supersample;
    const sourceCanvas = await toCanvas(snapshot, {
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
    if (pipeline === "direct") return sourceCanvas;
    const finalCanvas = createFinalCanvas(sourceCanvas);
    sourceCanvas.width = 1;
    sourceCanvas.height = 1;
    return finalCanvas;
  } finally {
    host.remove();
  }
}

export async function renderJournalImageBlob(
  root: HTMLElement,
  format: JournalExportFormat,
  pipeline: JournalRasterPipeline = "direct",
) {
  const finalCanvas = await rasterizeJournalSnapshot(root, pipeline);
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

export async function exportJournalPreviewImage(
  raster: JournalRasterCacheEntry,
  viewModel: JournalPreviewViewModel,
  format: JournalExportFormat,
) {
  if (!isCurrentJournalRasterCacheEntry(raster, buildJournalPreviewRenderKey(viewModel))) {
    throw new Error("JOURNAL_PREVIEW_CACHE_VERSION_MISMATCH");
  }
  const blob = await encodeJournalPreviewBlob(raster.blob, format);
  const filename = buildJournalExportFilename(viewModel.dogName, viewModel.businessDate, format);
  downloadJournalBlob(blob, filename);
  return { blob, filename };
}
