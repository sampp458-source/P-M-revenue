import { toCanvas } from "html-to-image";
import { isCurrentJournalTemplateRoot, journalViewModelRevision, JOURNAL_REQUIRED_ASSET_IDS } from "./journalRenderContract";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

export type JournalExportFormat = "png" | "jpg";

export const JOURNAL_EXPORT_WIDTH = 1080;
export const JOURNAL_EXPORT_HEIGHT = 1440;
export const JOURNAL_EXPORT_SUPERSAMPLE = 2;
export type JournalRasterPipeline = "direct" | "supersampled";
const JOURNAL_EXPORT_BACKGROUND = "#fffcf8";
const JOURNAL_JPG_QUALITY = 0.95;
let exportGenerationSequence = 0;
let exportQueue: Promise<void> = Promise.resolve();

type JournalExportGeneration = {
  generationId: string;
  entryId: string;
  viewModelRevision: string;
  host: HTMLDivElement;
  snapshot: HTMLElement;
};

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

async function waitForImage(image: HTMLImageElement) {
  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
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
  if (typeof image.decode === "function") {
    try {
      await image.decode();
    } catch {
      throw new Error("JOURNAL_EXPORT_ASSET_DECODE_FAILED");
    }
  }
  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("JOURNAL_EXPORT_ASSET_LOAD_FAILED");
  }
}

function assertRequiredAssetIdentity(root: HTMLElement, requiredAssetIds: readonly string[]) {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-journal-asset]"));
  const counts = new Map<string, number>();
  images.forEach((image) => {
    const id = image.dataset.journalAsset;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  const invalid = requiredAssetIds.filter((id) => counts.get(id) !== 1);
  if (invalid.length) throw new Error(`JOURNAL_EXPORT_REQUIRED_ASSET_MISSING:${invalid.join(",")}`);
  return images.filter((image) => requiredAssetIds.includes(image.dataset.journalAsset ?? ""));
}

export async function waitForJournalAssets(root: HTMLElement, requiredAssetIds: readonly string[] = []) {
  if (document.fonts) await document.fonts.ready;
  const images = Array.from(root.querySelectorAll("img"));
  const requiredImages = requiredAssetIds.length ? assertRequiredAssetIdentity(root, requiredAssetIds) : [];
  await Promise.all(images.map(waitForImage));
  if (images.some((image) => !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0)) {
    throw new Error("JOURNAL_EXPORT_ASSET_LOAD_FAILED");
  }
  if (requiredAssetIds.length && requiredImages.length !== requiredAssetIds.length) {
    throw new Error("JOURNAL_EXPORT_REQUIRED_ASSET_NOT_READY");
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

export async function inlineJournalSnapshotImages(root: HTMLElement, requiredAssetIds: readonly string[] = []) {
  await waitForJournalAssets(root, requiredAssetIds);
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map(async (image) => {
    const source = image.currentSrc || image.src;
    if (!source || source.startsWith("data:")) return;
    image.src = await loadJournalAssetDataUrl(source);
    image.dataset.journalAssetInlined = "true";
  }));
  await waitForJournalAssets(root, requiredAssetIds);
  if (images.some((image) => !image.src.startsWith("data:"))) {
    throw new Error("JOURNAL_EXPORT_ASSET_INLINE_FAILED");
  }
}

export async function waitForJournalLayoutSettle() {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else resolve();
  });
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else resolve();
  });
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

function nextExportGenerationId() {
  exportGenerationSequence += 1;
  return `journal-export-${exportGenerationSequence}`;
}

function requiredRootIdentity(root: HTMLElement) {
  const entryId = root.dataset.journalEntryId;
  const viewModelRevision = root.dataset.journalViewModelRevision;
  if (!entryId || !viewModelRevision) throw new Error("JOURNAL_EXPORT_SOURCE_IDENTITY_MISSING");
  return { entryId, viewModelRevision };
}

function createCanonicalSnapshot(root: HTMLElement): JournalExportGeneration {
  const { entryId, viewModelRevision } = requiredRootIdentity(root);
  const generationId = nextExportGenerationId();
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dataset.journalExportSnapshot = "true";
  host.dataset.exportGenerationId = generationId;
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
  snapshot.dataset.exportGenerationId = generationId;
  host.appendChild(snapshot);
  document.body.appendChild(host);
  return { generationId, entryId, viewModelRevision, host, snapshot };
}

function assertGenerationIdentity(generation: JournalExportGeneration, node: HTMLElement) {
  if (node !== generation.snapshot) throw new Error("JOURNAL_EXPORT_READY_RASTER_NODE_MISMATCH");
  if (node.dataset.exportGenerationId !== generation.generationId) {
    throw new Error("JOURNAL_EXPORT_GENERATION_IDENTITY_MISMATCH");
  }
  if (node.dataset.journalEntryId !== generation.entryId || node.dataset.journalViewModelRevision !== generation.viewModelRevision) {
    throw new Error("JOURNAL_EXPORT_ENTRY_IDENTITY_MISMATCH");
  }
}

function runSerializedExport<T>(task: () => Promise<T>) {
  const running = exportQueue.then(task, task);
  exportQueue = running.then(() => undefined, () => undefined);
  return running;
}

async function rasterizeJournalGeneration(generation: JournalExportGeneration, pipeline: JournalRasterPipeline) {
  const { host, snapshot } = generation;
  try {
    assertGenerationIdentity(generation, snapshot);
    await waitForJournalLayoutSettle();
    await inlineJournalSnapshotImages(snapshot, JOURNAL_REQUIRED_ASSET_IDS);
    await waitForJournalLayoutSettle();
    assertGenerationIdentity(generation, snapshot);
    await waitForJournalAssets(snapshot, JOURNAL_REQUIRED_ASSET_IDS);
    if (Array.from(snapshot.querySelectorAll<HTMLImageElement>("img[data-journal-asset]")).some((image) => !image.src.startsWith("data:"))) {
      throw new Error("JOURNAL_EXPORT_PRE_RASTER_ASSET_GATE_FAILED");
    }
    const readyNode = snapshot;
    const rasterNode = snapshot;
    if (readyNode !== rasterNode) throw new Error("JOURNAL_EXPORT_READY_RASTER_NODE_MISMATCH");
    assertGenerationIdentity(generation, rasterNode);
    const supersample = pipeline === "supersampled" ? JOURNAL_EXPORT_SUPERSAMPLE : 1;
    const rasterWidth = JOURNAL_EXPORT_WIDTH * supersample;
    const rasterHeight = JOURNAL_EXPORT_HEIGHT * supersample;
    const sourceCanvas = await toCanvas(rasterNode, {
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
  if (!isCurrentJournalTemplateRoot(root)) {
    throw new Error("JOURNAL_RENDER_SOURCE_VERSION_MISMATCH");
  }
  const generation = createCanonicalSnapshot(root);
  const finalCanvas = await runSerializedExport(() => rasterizeJournalGeneration(generation, pipeline));
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
  const rootIdentity = requiredRootIdentity(root);
  if (rootIdentity.entryId !== viewModel.entryId || rootIdentity.viewModelRevision !== journalViewModelRevision(viewModel)) {
    throw new Error("JOURNAL_EXPORT_ENTRY_IDENTITY_MISMATCH");
  }
  const blob = await renderJournalImageBlob(root, format);
  const filename = buildJournalExportFilename(viewModel.dogName, viewModel.businessDate, format);
  downloadJournalBlob(blob, filename);
  return { blob, filename };
}
