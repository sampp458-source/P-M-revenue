import { JOURNAL_CANVAS_ASSET_SOURCES, type JournalAssetSourceId, type JournalAssetSourceMap } from "./journalAssetSources";
import { JOURNAL_REQUIRED_ASSET_IDS, type JournalRequiredAssetId } from "./journalRenderContract";
import {
  JOURNAL_REPORT_TYPOGRAPHY,
  JOURNAL_REPORT_VISUAL_REGIONS,
  JOURNAL_REQUIRED_VISUAL_ELEMENT_IDS,
  journalActivityFontSize,
  journalCommentTypography,
  journalDogNameFontSize,
  journalTeacherCommentDogSlot,
  type JournalReportScene,
  type JournalSceneRect,
} from "./journalReportScene";
import { normalizedJournalBestFriendDisplayTargets, resolveJournalBestFriendLayout } from "./journalBestFriendPresentation";
import type { JournalPreviewOption } from "./journalPreviewViewModel";

export type JournalCanvasRegionFingerprint = { red: number; green: number; blue: number; alpha: number };
export type JournalVisualElementId = keyof typeof JOURNAL_REPORT_VISUAL_REGIONS;
export type JournalTextLandmarkId = "header-title" | "dog-name" | "date" | "condition-heading" | "toilet-heading" | "meal-heading" | "relationship-heading" | "best-friend-intro" | "best-friend-name" | "best-friend-suffix" | "manners-heading" | "manners-activity" | "physical-heading" | "physical-activity" | "comment-heading" | "comment-first-line";
export type JournalCanvasTextLandmark = JournalSceneRect & { centerX: number; centerY: number };
export const JOURNAL_REQUIRED_TEXT_LANDMARK_IDS: JournalTextLandmarkId[] = ["header-title", "dog-name", "date", "condition-heading", "toilet-heading", "meal-heading", "relationship-heading", "best-friend-intro", "best-friend-name", "best-friend-suffix", "manners-heading", "manners-activity", "physical-heading", "physical-activity", "comment-heading", "comment-first-line"];
export type JournalCanvasRenderMetrics = {
  width: number; height: number;
  requiredAssetSlots: number; verifiedAssetSlots: number;
  requiredVisualElements: number; verifiedVisualElements: number;
  requiredTextLandmarks: number; verifiedTextLandmarks: number;
  assetFingerprints: Partial<Record<JournalRequiredAssetId, JournalCanvasRegionFingerprint>>;
  visualFingerprints: Partial<Record<JournalVisualElementId, JournalCanvasRegionFingerprint>>;
  textLandmarks: Record<JournalTextLandmarkId, JournalCanvasTextLandmark>;
};

type LoadedAssets = Record<JournalAssetSourceId, HTMLImageElement>;
type LucideNode = { path?: string; circle?: [number, number, number] };

export const JOURNAL_BINARY_OPTION_GEOMETRY = {
  areaWidth: 104,
  columnGap: 6,
  circleDiameter: 20,
  markCenterOffset: 10,
  labelOffset: 28,
  labelFontSize: 18,
  selectedWeight: 900,
} as const;

const ICONS = {
  sparkles: [
    { path: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" },
    { path: "M20 3v4M22 5h-4M4 17v2M5 18H3" },
  ],
  flower: [
    { path: "M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1" },
    { circle: [12, 8, 2] }, { path: "M12 10v12M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5ZM12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z" },
  ],
  salad: [{ path: "M7 21h10M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9ZM11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1M13 12l4-4M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2" }],
  relationship: [{ path: "M18 20a6 6 0 0 0-12 0" }, { circle: [12, 10, 4] }, { circle: [12, 12, 10] }],
  medal: [
    { path: "M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15M11 12 5.12 2.2M13 12l5.88-9.8M8 7h8" },
    { circle: [12, 17, 5] }, { path: "M12 18v-2h-.5" },
  ],
  dumbbell: [{ path: "M14.4 14.4 9.6 9.6M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829zM21.5 21.5l-1.4-1.4M3.9 3.9 2.5 2.5M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z" }],
  comment: [{ path: "M7.9 20A9 9 0 1 0 4 16.1L2 22ZM15.8 9.2a2.5 2.5 0 0 0-3.5 0l-.3.4-.35-.3a2.42 2.42 0 1 0-3.2 3.6l3.6 3.5 3.6-3.5c1.2-1.2 1.1-2.7.2-3.7" }],
  heart: [{ path: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" }],
  paw: [{ circle: [11, 4, 2] }, { circle: [18, 8, 2] }, { circle: [20, 16, 2] }, { path: "M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z" }],
} as const satisfies Record<string, readonly LucideNode[]>;

const assetCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(id: JournalAssetSourceId, source: string) {
  const cacheKey = `${id}:${source}`;
  const cached = assetCache.get(cacheKey);
  if (cached) return cached;
  const loading = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = async () => {
      try {
        if (typeof image.decode === "function") await image.decode();
        if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error();
        resolve(image);
      } catch { reject(new Error(`JOURNAL_CANVAS_ASSET_DECODE_FAILED:${id}`)); }
    };
    image.onerror = () => reject(new Error(`JOURNAL_CANVAS_ASSET_LOAD_FAILED:${id}`));
    image.src = source;
  }).catch((error) => { assetCache.delete(cacheKey); throw error; });
  assetCache.set(cacheKey, loading);
  return loading;
}

export async function loadJournalCanvasAssets(sources: JournalAssetSourceMap = JOURNAL_CANVAS_ASSET_SOURCES) {
  const ids = [...JOURNAL_REQUIRED_ASSET_IDS, "official-logo"] as JournalAssetSourceId[];
  const entries = await Promise.all(ids.map(async (id) => {
    const source = sources[id];
    if (!source) throw new Error(`JOURNAL_CANVAS_ASSET_SOURCE_MISSING:${id}`);
    return [id, await loadImage(id, source)] as const;
  }));
  return Object.fromEntries(entries) as LoadedAssets;
}

export async function waitForJournalCanvasFonts(fontFamily: string) {
  if (!document.fonts) return;
  await document.fonts.ready;
  await Promise.all([17, 18, 19, 20, 22, 24, 26, 27, 29, 32, 34, 44, 52].flatMap((size) => [400, 600, 700, 800, 900].map((weight) => document.fonts.load(`${weight} ${size}px ${fontFamily}`, "가나다라마바사"))));
  if (![400, 600, 700, 800, 900].every((weight) => document.fonts.check(`${weight} 24px ${fontFamily}`, "가나다라마바사"))) throw new Error("JOURNAL_CANVAS_FONT_NOT_READY");
}

export async function waitForJournalTeacherCommentFont(fontFamily: string) {
  if (!document.fonts) return;
  await document.fonts.ready;
  await document.fonts.load(`400 20px ${fontFamily}`, "한글 ABC 123 ♡ 👏");
  if (!document.fonts.check(`400 20px ${fontFamily}`, "한글 ABC 123 ♡")) throw new Error("JOURNAL_CUSTOM_FONT_NOT_READY");
}

function roundRect(context: CanvasRenderingContext2D, rect: JournalSceneRect, radius: number) {
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  context.beginPath(); context.moveTo(rect.x + r, rect.y);
  context.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height, r);
  context.arcTo(rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height, r);
  context.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y, r);
  context.arcTo(rect.x, rect.y, rect.x + rect.width, rect.y, r); context.closePath();
}

function fillRounded(context: CanvasRenderingContext2D, rect: JournalSceneRect, radius: number, fill: string, stroke?: string, width = 1) {
  roundRect(context, rect, radius); context.fillStyle = fill; context.fill();
  if (stroke) { context.strokeStyle = stroke; context.lineWidth = width; context.stroke(); }
}

function fillSplitRounded(context: CanvasRenderingContext2D, rect: JournalSceneRect, radius: number, split: number, left: string, right: string) {
  context.save(); roundRect(context, rect, radius); context.clip();
  context.fillStyle = left; context.fillRect(rect.x, rect.y, rect.width * split, rect.height);
  context.fillStyle = right; context.fillRect(rect.x + rect.width * split, rect.y, rect.width * (1 - split), rect.height); context.restore();
}

function fitImage(context: CanvasRenderingContext2D, image: HTMLImageElement, slot: JournalSceneRect) {
  const scale = Math.min(slot.width / image.naturalWidth, slot.height / image.naturalHeight);
  const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
  context.drawImage(image, slot.x + (slot.width - width) / 2, slot.y + (slot.height - height) / 2, width, height);
}

function drawTintedImage(context: CanvasRenderingContext2D, image: HTMLImageElement, slot: JournalSceneRect, color: string) {
  const surface = document.createElement("canvas"); surface.width = Math.ceil(slot.width); surface.height = Math.ceil(slot.height);
  const paint = surface.getContext("2d"); if (!paint) throw new Error("JOURNAL_CANVAS_LOGO_CONTEXT_UNAVAILABLE");
  fitImage(paint, image, { x: 0, y: 0, width: surface.width, height: surface.height });
  paint.globalCompositeOperation = "source-in"; paint.fillStyle = color; paint.fillRect(0, 0, surface.width, surface.height);
  context.drawImage(surface, slot.x, slot.y, slot.width, slot.height); surface.width = 1; surface.height = 1;
}

function regionSignature(context: CanvasRenderingContext2D, slot: JournalSceneRect) {
  const x = Math.max(0, Math.floor(slot.x)); const y = Math.max(0, Math.floor(slot.y));
  const width = Math.max(1, Math.min(context.canvas.width - x, Math.ceil(slot.width)));
  const height = Math.max(1, Math.min(context.canvas.height - y, Math.ceil(slot.height)));
  const data = context.getImageData(x, y, width, height).data;
  let signature = 2166136261; let red = 0; let green = 0; let blue = 0; let alpha = 0;
  for (let index = 0; index < data.length; index += 4) {
    signature ^= data[index] + (data[index + 1] << 8) + (data[index + 2] << 16) + (data[index + 3] << 24); signature = Math.imul(signature, 16777619);
    red += data[index]; green += data[index + 1]; blue += data[index + 2]; alpha += data[index + 3];
  }
  const pixels = data.length / 4;
  return { signature: signature >>> 0, fingerprint: { red: red / pixels, green: green / pixels, blue: blue / pixels, alpha: alpha / pixels } };
}

function verifyDrawing(context: CanvasRenderingContext2D, slot: JournalSceneRect, id: string, draw: () => void) {
  const before = regionSignature(context, slot); draw(); const after = regionSignature(context, slot);
  if (before.signature === after.signature) throw new Error(`JOURNAL_CANVAS_VISUAL_ELEMENT_MISSING:${id}`);
  return after.fingerprint;
}

function drawVerifiedAsset(context: CanvasRenderingContext2D, image: HTMLImageElement, slot: JournalSceneRect, id: string) {
  return verifyDrawing(context, slot, id, () => fitImage(context, image, slot));
}

function setFont(context: CanvasRenderingContext2D, size: number, weight: number, family: string, letterSpacing = 0) {
  context.font = `${weight} ${size}px ${family}`; context.textBaseline = "alphabetic";
  (context as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${letterSpacing}px`;
}

function textBaselineForCenter(context: CanvasRenderingContext2D, text: string, centerY: number) {
  const metrics = context.measureText(text || "가"); return centerY + ((metrics.actualBoundingBoxAscent || 0) - (metrics.actualBoundingBoxDescent || 0)) / 2;
}

function textLandmarkAtBaseline(context: CanvasRenderingContext2D, text: string, x: number, baseline: number): JournalCanvasTextLandmark {
  const metrics = context.measureText(text || "가");
  const left = x - metrics.actualBoundingBoxLeft;
  const top = baseline - metrics.actualBoundingBoxAscent;
  const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  return { x: left, y: top, width, height, centerX: left + width / 2, centerY: top + height / 2 };
}

function drawTextAtVisualCenter(context: CanvasRenderingContext2D, text: string, x: number, centerY: number, align: CanvasTextAlign = "center", maxWidth?: number) {
  context.textAlign = align; const baseline = textBaselineForCenter(context, text, centerY);
  if (maxWidth) context.fillText(text, x, baseline, maxWidth); else context.fillText(text, x, baseline);
  return textLandmarkAtBaseline(context, text, x, baseline);
}

function wrapLines(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  value.replaceAll("\r\n", "\n").split("\n").forEach((paragraph) => {
    let current = "";
    Array.from(paragraph).forEach((character) => {
      const next = current + character;
      if (current && context.measureText(next).width > maxWidth) { lines.push(current); current = character; } else current = next;
    });
    if (current || paragraph === "") lines.push(current);
  });
  if (lines.length > maxLines) throw new Error("JOURNAL_CANVAS_TEXT_OVERFLOW"); return lines;
}

function drawWrappedCenteredText(context: CanvasRenderingContext2D, text: string, x: number, centerY: number, maxWidth: number, maxLines: number, lineHeight: number) {
  const lines = wrapLines(context, text, maxWidth, maxLines); const firstCenterY = centerY - ((lines.length - 1) * lineHeight) / 2;
  const landmarks = lines.map((line, index) => drawTextAtVisualCenter(context, line, x, firstCenterY + index * lineHeight));
  const left = Math.min(...landmarks.map((landmark) => landmark.x)); const top = Math.min(...landmarks.map((landmark) => landmark.y));
  const right = Math.max(...landmarks.map((landmark) => landmark.x + landmark.width)); const bottom = Math.max(...landmarks.map((landmark) => landmark.y + landmark.height));
  return { x: left, y: top, width: right - left, height: bottom - top, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
}

function drawLucide(context: CanvasRenderingContext2D, nodes: readonly LucideNode[], rect: JournalSceneRect, color: string, strokeWidth = 2) {
  context.save(); context.translate(rect.x, rect.y); context.scale(rect.width / 24, rect.height / 24);
  context.strokeStyle = color; context.lineWidth = strokeWidth * (24 / Math.max(rect.width, rect.height)); context.lineCap = "round"; context.lineJoin = "round";
  nodes.forEach((node) => {
    if (node.path) context.stroke(new Path2D(node.path));
    else if (node.circle) { context.beginPath(); context.arc(...node.circle, 0, Math.PI * 2); context.stroke(); }
  });
  context.restore();
}

function drawIconBadge(context: CanvasRenderingContext2D, rect: JournalSceneRect, nodes: readonly LucideNode[], color: string, size = 24) {
  fillRounded(context, rect, rect.width === 40 ? 16 : 15, rect.width === 40 ? "#ffe9ed" : "#f6f9fb");
  const inset = (rect.width - size) / 2; drawLucide(context, nodes, { x: rect.x + inset, y: rect.y + inset, width: size, height: size }, color);
}

function drawHeading(context: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, family: string, icon: readonly LucideNode[], visualId: JournalVisualElementId) {
  const rect = { x, y, width: 36, height: 36 };
  verifyDrawing(context, JOURNAL_REPORT_VISUAL_REGIONS[visualId], visualId, () => drawIconBadge(context, rect, icon, color));
  const typography = JOURNAL_REPORT_TYPOGRAPHY.heading; setFont(context, typography.size, typography.weight, family, typography.letterSpacing);
  context.fillStyle = color; return drawTextAtVisualCenter(context, text, x + 44, y + 18, "left");
}

function drawSelectedBrush(context: CanvasRenderingContext2D, rect: JournalSceneRect, color: string, variant: number) {
  const angles = [-4, 1, -3]; const centers = [0.67, 0.655, 0.685]; context.save(); context.translate(rect.x + rect.width / 2, rect.y + rect.height * centers[variant % centers.length]);
  context.rotate((angles[variant % angles.length] * Math.PI) / 180); context.globalAlpha = 0.9;
  fillRounded(context, { x: -rect.width / 2, y: -rect.height * 0.2, width: rect.width, height: rect.height * 0.42 }, 5, color); context.restore();
}

function drawOptionCell(context: CanvasRenderingContext2D, option: JournalPreviewOption, rect: JournalSceneRect, family: string, highlight: string, compact: boolean, variant: number) {
  if (option.selected) drawSelectedBrush(context, rect, highlight, variant);
  const markX = rect.x + 15.5; const markY = rect.y + rect.height / 2;
  const markAngles = [-7, 4, -2]; context.save(); context.translate(markX, markY); context.rotate((markAngles[variant % markAngles.length] * Math.PI) / 180);
  context.strokeStyle = option.selected ? "#ff9da2" : "#aebdc8"; context.lineWidth = option.selected ? 2 : 1.5;
  roundRect(context, { x: -11.5, y: -11.5, width: 23, height: 23 }, 10.5); context.stroke();
  if (option.selected) {
    context.strokeStyle = "#ff646a"; context.lineWidth = 3.4; context.lineCap = "round"; context.lineJoin = "round";
    context.rotate(-4 * Math.PI / 180); context.beginPath(); context.moveTo(-6, 0); context.lineTo(-1, 5); context.lineTo(7, -5); context.stroke();
  }
  context.restore();
  const typography = compact ? JOURNAL_REPORT_TYPOGRAPHY.compactOption : JOURNAL_REPORT_TYPOGRAPHY.option;
  setFont(context, typography.size, option.selected ? typography.selectedWeight : typography.weight, family);
  context.fillStyle = option.selected ? "#25384a" : "#667786";
  drawTextAtVisualCenter(context, option.label, rect.x + 33, rect.y + rect.height / 2, "left", rect.width - 37);
}

function drawOptionGrid(context: CanvasRenderingContext2D, options: JournalPreviewOption[], area: JournalSceneRect, columns: number, family: string, highlight: string, compact = false, gapX = 3, gapY = 2) {
  const cellHeight = compact ? 31 : 36; const cellWidth = (area.width - gapX * (columns - 1)) / columns;
  options.forEach((option, index) => {
    const column = index % columns; const row = Math.floor(index / columns);
    drawOptionCell(context, option, { x: area.x + column * (cellWidth + gapX), y: area.y + row * (cellHeight + gapY), width: cellWidth, height: cellHeight }, family, highlight, compact, index);
  });
}

function drawBinaryOptionGrid(context: CanvasRenderingContext2D, options: JournalPreviewOption[], area: JournalSceneRect, family: string, highlight: string) {
  const geometry = JOURNAL_BINARY_OPTION_GEOMETRY;
  const cellWidth = (area.width - geometry.columnGap) / 2;
  options.forEach((option, index) => {
    const rect = { x: area.x + index * (cellWidth + geometry.columnGap), y: area.y, width: cellWidth, height: area.height };
    if (option.selected) drawSelectedBrush(context, rect, highlight, index);
    const markX = rect.x + geometry.markCenterOffset;
    const markY = rect.y + rect.height / 2;
    context.save();
    context.translate(markX, markY);
    context.rotate(([-7, 4][index % 2] * Math.PI) / 180);
    context.strokeStyle = option.selected ? "#ff9da2" : "#aebdc8";
    context.lineWidth = option.selected ? 2 : 1.5;
    const radius = geometry.circleDiameter / 2;
    roundRect(context, { x: -radius, y: -radius, width: geometry.circleDiameter, height: geometry.circleDiameter }, radius - 1);
    context.stroke();
    if (option.selected) {
      context.strokeStyle = "#ff646a";
      context.lineWidth = 3;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.rotate(-4 * Math.PI / 180);
      context.beginPath();
      context.moveTo(-5, 0);
      context.lineTo(-1, 4);
      context.lineTo(6, -5);
      context.stroke();
    }
    context.restore();
    setFont(context, geometry.labelFontSize, option.selected ? geometry.selectedWeight : 600, family);
    context.fillStyle = option.selected ? "#25384a" : "#667786";
    // O/X must retain its natural glyph aspect ratio. Do not pass maxWidth.
    drawTextAtVisualCenter(context, option.label, rect.x + geometry.labelOffset, rect.y + rect.height / 2, "left");
  });
}

function drawRelationshipOptions(context: CanvasRenderingContext2D, options: JournalPreviewOption[], x: number, y: number, width: number, family: string, highlight: string) {
  options.forEach((option, index) => drawOptionCell(context, option, { x, y: y + index * 32, width, height: 31 }, family, highlight, true, index));
}

function drawActivityOptions(context: CanvasRenderingContext2D, options: JournalPreviewOption[], x: number, y: number, width: number, family: string, highlight: string) {
  const left = (width - 3) * (0.9 / 2.45); const right = width - 3 - left;
  if (options[0]) drawOptionCell(context, options[0], { x, y, width: left, height: 31 }, family, highlight, true, 0);
  if (options[1]) drawOptionCell(context, options[1], { x: x + left + 3, y, width: right, height: 31 }, family, highlight, true, 1);
  if (options[2]) drawOptionCell(context, options[2], { x, y: y + 33, width: Math.min(width, Math.max(left, context.measureText(options[2].label).width + 45)), height: 31 }, family, highlight, true, 2);
}

function drawDottedDivider(context: CanvasRenderingContext2D, x: number, y: number, height: number, color: string) {
  context.save(); context.strokeStyle = color; context.lineWidth = 2; context.setLineDash([2, 6]);
  context.beginPath(); context.moveTo(x, y); context.lineTo(x, y + height); context.stroke(); context.restore();
}

function renderScene(context: CanvasRenderingContext2D, scene: JournalReportScene, assets: LoadedAssets) {
  const { viewModel: vm, layout, palette: colors, fontFamily: family, teacherCommentFontFamily, assetSlots } = scene;
  const assetFingerprints: Partial<Record<JournalRequiredAssetId, JournalCanvasRegionFingerprint>> = {};
  const visualFingerprints: Partial<Record<JournalVisualElementId, JournalCanvasRegionFingerprint>> = {};
  const textLandmarks = {} as Record<JournalTextLandmarkId, JournalCanvasTextLandmark>;
  context.save(); context.fillStyle = colors.background; context.fillRect(0, 0, scene.width, scene.height);
  fillRounded(context, layout.outerBorder, layout.outerBorder.radius, colors.background, "#e6eef4", 3);

  fillRounded(context, layout.header, 52, "#ffffff", "#dbeaf4", 3);
  context.globalAlpha = 0.52; fillRounded(context, { x: 72, y: 70, width: 150, height: 150 }, 75, colors.coral.highlight);
  context.globalAlpha = 0.78; fillRounded(context, { x: 836, y: 74, width: 174, height: 144 }, 48, "#e8f4fc"); context.globalAlpha = 1;
  assetFingerprints["header-dog-a"] = drawVerifiedAsset(context, assets["header-dog-a"], assetSlots["header-dog-a"], "header-dog-a");
  assetFingerprints["header-dog-b"] = drawVerifiedAsset(context, assets["header-dog-b"], assetSlots["header-dog-b"], "header-dog-b");
  visualFingerprints["official-logo"] = verifyDrawing(context, JOURNAL_REPORT_VISUAL_REGIONS["official-logo"], "official-logo", () => drawTintedImage(context, assets["official-logo"], assetSlots["official-logo"], colors.blue));
  visualFingerprints["header-underline"] = verifyDrawing(context, JOURNAL_REPORT_VISUAL_REGIONS["header-underline"], "header-underline", () => {
    context.save(); context.translate(540, 213); context.rotate(-Math.PI / 180); context.globalAlpha = 0.42;
    fillRounded(context, { x: -133, y: -7.5, width: 266, height: 15 }, 8, colors.coral.accent); context.restore();
  });
  setFont(context, 52, 900, family, -2.86); context.fillStyle = colors.blue; textLandmarks["header-title"] = drawTextAtVisualCenter(context, "하루 일지", 540.27, 178);
  const dogSize = journalDogNameFontSize(vm.dogName.length); setFont(context, dogSize, 900, family, -dogSize * 0.045);
  context.fillStyle = colors.blue; textLandmarks["dog-name"] = drawWrappedCenteredText(context, vm.dogName, 191.58, 249.66, 240, 2, dogSize * 1.1);
  setFont(context, 24, 700, family); context.fillStyle = "#718395"; textLandmarks.date = drawTextAtVisualCenter(context, vm.displayDate, 907, 246);

  fillSplitRounded(context, layout.daily, 40, 0.45, colors.coral.surface, colors.green.surface);
  context.globalAlpha = 0.62; fillRounded(context, { x: 36, y: 305, width: 96, height: 58 }, 29, colors.coral.highlight);
  context.globalAlpha = 0.72; fillRounded(context, { x: 898, y: 424, width: 118, height: 38 }, 19, colors.green.highlight); context.globalAlpha = 1;
  textLandmarks["condition-heading"] = drawHeading(context, "오늘의 컨디션", 70, 301, colors.coral.accent, family, ICONS.sparkles, "condition-icon");
  drawOptionGrid(context, vm.conditionOptions, { x: 70, y: 342, width: 395, height: 64 }, 2, family, colors.coral.highlight, true);
  context.globalAlpha = 0.32; fillRounded(context, { x: 112, y: 454, width: 144, height: 5 }, 3, "#ffb8bc"); context.globalAlpha = 1;
  drawDottedDivider(context, 493, 319, 104, colors.green.border);
  textLandmarks["toilet-heading"] = drawHeading(context, "배변 상태", 523, 301, colors.green.accent, family, ICONS.flower, "toilet-icon");
  const small = JOURNAL_REPORT_TYPOGRAPHY.smallLabel; setFont(context, small.size, small.weight, family); context.fillStyle = "#52697c";
  drawTextAtVisualCenter(context, "소변", 523, 353.25, "left"); drawTextAtVisualCenter(context, "대변", 635, 353.25, "left"); drawTextAtVisualCenter(context, "대변 상태", 747, 353.25, "left");
  drawBinaryOptionGrid(context, vm.urinationOptions, { x: 523, y: 366, width: 104, height: 31 }, family, colors.green.highlight);
  drawBinaryOptionGrid(context, vm.defecationOptions, { x: 635, y: 366, width: 104, height: 31 }, family, colors.green.highlight);
  drawOptionGrid(context, vm.stoolOptions, { x: 747, y: 366, width: 263, height: 64 }, 2, family, colors.green.highlight, true);

  const meal = { x: 55, y: 475, width: 351, height: 206 }; fillRounded(context, meal, 38, colors.amber.surface);
  context.globalAlpha = 0.38; fillRounded(context, { x: 47, y: 492, width: 116, height: 132 }, 55, colors.amber.highlight); context.globalAlpha = 1;
  assetFingerprints.meal = drawVerifiedAsset(context, assets.meal, assetSlots.meal, "meal");
  textLandmarks["meal-heading"] = drawHeading(context, "유치원에서 먹은 것", 72, 487, colors.amber.accent, family, ICONS.salad, "meal-icon");
  context.globalAlpha = 0.72; fillRounded(context, { x: 114, y: 528, width: 126, height: 5 }, 3, colors.amber.border); context.globalAlpha = 1;
  drawOptionGrid(context, vm.mealOptions, { x: 72, y: 538, width: 317, height: 74 }, 2, family, colors.amber.highlight);

  const relationship = { x: 428, y: 475, width: 597, height: 206 }; fillRounded(context, relationship, 40, colors.lavender.surface);
  context.globalAlpha = 0.72; fillRounded(context, { x: 899, y: 483, width: 92, height: 50 }, 25, colors.lavender.highlight); context.globalAlpha = 1;
  drawLucide(context, ICONS.heart, { x: 934, y: 495, width: 22, height: 22 }, colors.coral.accent);
  textLandmarks["relationship-heading"] = drawHeading(context, "오늘의 관계", 446.76, 487, colors.lavender.accent, family, ICONS.relationship, "relationship-icon");
  drawDottedDivider(context, 726, 530, 102, colors.lavender.border);
  setFont(context, small.size, small.weight, family); context.fillStyle = "#52697c";
  drawTextAtVisualCenter(context, "선생님과", 453.76, 542.25, "left"); drawLucide(context, ICONS.heart, { x: 688, y: 526, width: 18, height: 18 }, colors.coral.accent);
  drawTextAtVisualCenter(context, "친구들과", 737.55, 542.25, "left"); drawLucide(context, ICONS.paw, { x: 978, y: 525, width: 20, height: 20 }, "#5d9ac2");
  drawRelationshipOptions(context, vm.teacherRelationshipOptions, 453.76, 556, 239.79, family, colors.lavender.highlight);
  drawRelationshipOptions(context, vm.friendRelationshipOptions, 737.55, 556, 261.45, family, colors.lavender.highlight);

  context.globalAlpha = 0.88; fillRounded(context, { x: 229, y: 704, width: 610, height: 90 }, 45, "#f5fbff");
  context.globalAlpha = 0.55; visualFingerprints["best-friend-pink-accent"] = verifyDrawing(context, JOURNAL_REPORT_VISUAL_REGIONS["best-friend-pink-accent"], "best-friend-pink-accent", () => fillRounded(context, JOURNAL_REPORT_VISUAL_REGIONS["best-friend-pink-accent"], 29, colors.coral.highlight));
  context.globalAlpha = 0.48; visualFingerprints["best-friend-blue-underline"] = verifyDrawing(context, JOURNAL_REPORT_VISUAL_REGIONS["best-friend-blue-underline"], "best-friend-blue-underline", () => fillRounded(context, JOURNAL_REPORT_VISUAL_REGIONS["best-friend-blue-underline"], 4, "#b9dced")); context.globalAlpha = 1;
  assetFingerprints["best-friend-duo"] = drawVerifiedAsset(context, assets["best-friend-duo"], assetSlots["best-friend-duo"], "best-friend-duo");
  setFont(context, 20, 900, family, -0.4); context.fillStyle = "#607488"; textLandmarks["best-friend-intro"] = drawTextAtVisualCenter(context, "오늘의 제일 친한 친구는", 656, 722.62);
  const friendTargets = normalizedJournalBestFriendDisplayTargets(vm);
  const bestFriendLayout = resolveJournalBestFriendLayout(friendTargets);
  const friendLines = bestFriendLayout.lines.length > 0 ? bestFriendLayout.lines : [" "];
  const bestFriendSize = bestFriendLayout.fontSize;
  setFont(context, bestFriendSize, 900, family, -bestFriendSize * 0.05); context.fillStyle = colors.blue;
  if (friendLines.some((line) => context.measureText(line).width > bestFriendLayout.maxTextWidth)) throw new Error("JOURNAL_CANVAS_BEST_FRIEND_TEXT_OVERFLOW");
  const bestFriendLineHeight = bestFriendLayout.lineHeight;
  const firstY = bestFriendLayout.centerY - ((friendLines.length - 1) * bestFriendLineHeight) / 2;
  const bestFriendBounds = friendLines.map((line, index) => drawTextAtVisualCenter(context, line, 656, firstY + index * bestFriendLineHeight));
  const bestFriendLeft = Math.min(...bestFriendBounds.map((bounds) => bounds.x));
  const bestFriendTop = Math.min(...bestFriendBounds.map((bounds) => bounds.y));
  const bestFriendRight = Math.max(...bestFriendBounds.map((bounds) => bounds.x + bounds.width));
  const bestFriendBottom = Math.max(...bestFriendBounds.map((bounds) => bounds.y + bounds.height));
  textLandmarks["best-friend-name"] = {
    x: bestFriendLeft,
    y: bestFriendTop,
    width: bestFriendRight - bestFriendLeft,
    height: bestFriendBottom - bestFriendTop,
    centerX: (bestFriendLeft + bestFriendRight) / 2,
    centerY: (bestFriendTop + bestFriendBottom) / 2,
  };
  textLandmarks["best-friend-suffix"] = textLandmarks["best-friend-name"];
  const underlineWidth = Math.min(410, Math.max(24, ...friendLines.map((line) => context.measureText(line).width)) + 24);
  context.globalAlpha = 0.38; fillRounded(context, { x: 656 - underlineWidth / 2, y: 784, width: underlineWidth, height: 8 }, 4, colors.coral.accent); context.globalAlpha = 1;

  fillSplitRounded(context, layout.activities, 38, 0.49, colors.coral.surface, colors.green.surface); drawDottedDivider(context, 540, 845, 118, "#dbe7ef");
  assetFingerprints.manners = drawVerifiedAsset(context, assets.manners, assetSlots.manners, "manners"); assetFingerprints.physical = drawVerifiedAsset(context, assets.physical, assetSlots.physical, "physical");
  textLandmarks["manners-heading"] = drawHeading(context, vm.manners.title, 129, 825, colors.coral.accent, family, ICONS.medal, "manners-icon");
  textLandmarks["physical-heading"] = drawHeading(context, vm.physical.title, 552.95, 825, colors.green.accent, family, ICONS.dumbbell, "physical-icon");
  const mannersSize = journalActivityFontSize(vm.manners.activityName.length); setFont(context, mannersSize, 900, family); context.fillStyle = colors.ink;
  textLandmarks["manners-activity"] = drawWrappedCenteredText(context, vm.manners.activityName || " ", 279.97, 887.95, 390, 2, mannersSize * 1.2);
  const physicalSize = journalActivityFontSize(vm.physical.activityName.length); setFont(context, physicalSize, 900, family);
  textLandmarks["physical-activity"] = drawWrappedCenteredText(context, vm.physical.activityName || " ", 781.98, 887.95, 410, 2, physicalSize * 1.2);
  context.globalAlpha = 0.75; fillRounded(context, { x: 169, y: 916, width: 270, height: 4 }, 2, colors.coral.border); fillRounded(context, { x: 665, y: 916, width: 276, height: 4 }, 2, colors.green.border); context.globalAlpha = 1;
  drawActivityOptions(context, vm.manners.options, 71, 918, 417.95, family, colors.coral.highlight); drawActivityOptions(context, vm.physical.options, 552.95, 918, 456.04, family, colors.green.highlight);

  fillRounded(context, layout.comment, 42, "#ffffff", colors.coral.border, 3);
  context.globalAlpha = 0.66; context.fillStyle = colors.coral.highlight; context.beginPath(); context.moveTo(902, 1003); context.lineTo(1034, 1003); context.lineTo(1034, 1091); context.closePath(); context.fill(); context.globalAlpha = 1;
  visualFingerprints["comment-icon"] = verifyDrawing(context, JOURNAL_REPORT_VISUAL_REGIONS["comment-icon"], "comment-icon", () => drawIconBadge(context, JOURNAL_REPORT_VISUAL_REGIONS["comment-icon"], ICONS.comment, colors.coral.accent, 27));
  const commentHeading = JOURNAL_REPORT_TYPOGRAPHY.commentHeading; setFont(context, commentHeading.size, commentHeading.weight, family, commentHeading.letterSpacing); context.fillStyle = colors.blue;
  textLandmarks["comment-heading"] = drawTextAtVisualCenter(context, "선생님의 한마디", 133.61, 1042, "left");
  visualFingerprints["comment-quote"] = verifyDrawing(context, JOURNAL_REPORT_VISUAL_REGIONS["comment-quote"], "comment-quote", () => {
    setFont(context, 50, 900, family); context.globalAlpha = 0.58; context.fillStyle = "#ffb8bc"; drawTextAtVisualCenter(context, "“", 76, 1087, "left"); context.globalAlpha = 1;
  });
  const commentStyle = journalCommentTypography(vm.teacherComment.length); setFont(context, commentStyle.size, 400, teacherCommentFontFamily, -commentStyle.size * 0.01); context.fillStyle = colors.ink;
  const commentArea = { x: 110.32, y: 1081.89, width: commentStyle.textWidth, height: commentStyle.availableHeight }; const lineHeight = commentStyle.size * commentStyle.lineHeight;
  const lines = wrapLines(context, vm.teacherComment, commentArea.width, Math.floor(commentArea.height / lineHeight));
  lines.forEach((line, index) => { const metrics = context.measureText(line || "가"); const ascent = metrics.actualBoundingBoxAscent || commentStyle.size * 0.8; const baseline = commentArea.y + ascent + index * lineHeight; context.textAlign = "left"; context.fillText(line, commentArea.x, baseline); if (index === 0) textLandmarks["comment-first-line"] = textLandmarkAtBaseline(context, line, commentArea.x, baseline); });
  const commentDogSlot = journalTeacherCommentDogSlot(vm.teacherComment.length);
  verifyDrawing(context, commentDogSlot, "teacher-comment-dog", () => fitImage(context, assets["teacher-comment-dog"], commentDogSlot));
  assetFingerprints["teacher-comment-dog"] = regionSignature(context, assetSlots["teacher-comment-dog"]).fingerprint;

  const selectedCount = [...vm.conditionOptions, ...vm.urinationOptions, ...vm.defecationOptions, ...vm.stoolOptions, ...vm.mealOptions, ...vm.teacherRelationshipOptions, ...vm.friendRelationshipOptions, ...vm.manners.options, ...vm.physical.options].filter((option) => option.selected).length;
  if (selectedCount <= 0) throw new Error("JOURNAL_CANVAS_SELECTED_MARKS_MISSING");
  visualFingerprints["selected-option-marks"] = regionSignature(context, JOURNAL_REPORT_VISUAL_REGIONS["selected-option-marks"]).fingerprint;
  for (const id of JOURNAL_REQUIRED_VISUAL_ELEMENT_IDS) visualFingerprints[id] = regionSignature(context, JOURNAL_REPORT_VISUAL_REGIONS[id]).fingerprint;
  for (const id of JOURNAL_REQUIRED_ASSET_IDS) assetFingerprints[id] = regionSignature(context, assetSlots[id]).fingerprint;
  context.restore(); return { assetFingerprints, visualFingerprints, textLandmarks };
}

function fingerprintDistance(left: JournalCanvasRegionFingerprint, right: JournalCanvasRegionFingerprint) {
  return Math.max(Math.abs(left.red - right.red), Math.abs(left.green - right.green), Math.abs(left.blue - right.blue), Math.abs(left.alpha - right.alpha));
}

async function decodeJournalBlob(blob: Blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = objectUrl;
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("JOURNAL_EXPORT_DECODE_FAILED")); });
    if (typeof image.decode === "function") await image.decode(); return image;
  } finally { URL.revokeObjectURL(objectUrl); }
}

export async function validateJournalEncodedBlob(blob: Blob, scene: JournalReportScene, metrics: JournalCanvasRenderMetrics) {
  const decoded = await decodeJournalBlob(blob);
  const canvas = document.createElement("canvas"); canvas.width = scene.width; canvas.height = scene.height;
  try {
    if (decoded.width !== scene.width || decoded.height !== scene.height) throw new Error("JOURNAL_EXPORT_DECODE_SIZE_MISMATCH");
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("JOURNAL_EXPORT_VALIDATION_CONTEXT_UNAVAILABLE");
    context.drawImage(decoded, 0, 0);
    JOURNAL_REQUIRED_ASSET_IDS.forEach((id) => {
      const expected = metrics.assetFingerprints[id]; if (!expected) throw new Error(`JOURNAL_EXPORT_ENCODED_ASSET_MISSING:${id}`);
      const tolerance = blob.type === "image/jpeg" ? 20 : 5;
      if (fingerprintDistance(expected, regionSignature(context, scene.assetSlots[id]).fingerprint) > tolerance) throw new Error(`JOURNAL_EXPORT_ENCODED_ASSET_MISSING:${id}`);
    });
    JOURNAL_REQUIRED_VISUAL_ELEMENT_IDS.forEach((id) => {
      const expected = metrics.visualFingerprints[id]; if (!expected) throw new Error(`JOURNAL_EXPORT_ENCODED_VISUAL_MISSING:${id}`);
      const tolerance = blob.type === "image/jpeg" ? 20 : 5;
      if (fingerprintDistance(expected, regionSignature(context, JOURNAL_REPORT_VISUAL_REGIONS[id]).fingerprint) > tolerance) throw new Error(`JOURNAL_EXPORT_ENCODED_VISUAL_MISSING:${id}`);
    });
  } finally {
    if ("close" in decoded && typeof decoded.close === "function") decoded.close();
    else if ("src" in decoded) decoded.src = "";
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function renderJournalReportToCanvas(scene: JournalReportScene, sources: JournalAssetSourceMap = JOURNAL_CANVAS_ASSET_SOURCES) {
  await waitForJournalCanvasFonts(scene.fontFamily);
  if (scene.teacherCommentFontFamily !== scene.fontFamily) await waitForJournalTeacherCommentFont(scene.teacherCommentFontFamily);
  const assets = await loadJournalCanvasAssets(sources);
  const canvas = document.createElement("canvas"); canvas.width = scene.width; canvas.height = scene.height;
  try {
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true }); if (!context) throw new Error("JOURNAL_CANVAS_CONTEXT_UNAVAILABLE");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    const { assetFingerprints, visualFingerprints, textLandmarks } = renderScene(context, scene, assets);
    const metrics: JournalCanvasRenderMetrics = {
      width: canvas.width, height: canvas.height,
      requiredAssetSlots: JOURNAL_REQUIRED_ASSET_IDS.length, verifiedAssetSlots: Object.keys(assetFingerprints).length,
      requiredVisualElements: JOURNAL_REQUIRED_VISUAL_ELEMENT_IDS.length, verifiedVisualElements: Object.keys(visualFingerprints).length,
      requiredTextLandmarks: JOURNAL_REQUIRED_TEXT_LANDMARK_IDS.length, verifiedTextLandmarks: Object.keys(textLandmarks).length,
      assetFingerprints, visualFingerprints, textLandmarks,
    };
    if (metrics.verifiedAssetSlots !== metrics.requiredAssetSlots || metrics.verifiedVisualElements !== metrics.requiredVisualElements || metrics.verifiedTextLandmarks !== metrics.requiredTextLandmarks) throw new Error("JOURNAL_CANVAS_VISUAL_COMPLETENESS_FAILED");
    return { canvas, metrics };
  } catch (error) {
    canvas.width = 1;
    canvas.height = 1;
    throw error;
  }
}
