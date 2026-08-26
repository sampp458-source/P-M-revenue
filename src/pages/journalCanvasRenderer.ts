import { JOURNAL_CANVAS_ASSET_SOURCES, type JournalAssetSourceId, type JournalAssetSourceMap } from "./journalAssetSources";
import { JOURNAL_REQUIRED_ASSET_IDS, type JournalRequiredAssetId } from "./journalRenderContract";
import {
  journalActivityFontSize,
  journalBestFriendFontSize,
  journalCommentTypography,
  journalDogNameFontSize,
  type JournalReportScene,
  type JournalSceneRect,
} from "./journalReportScene";
import type { JournalPreviewOption } from "./journalPreviewViewModel";

export type JournalCanvasRenderMetrics = {
  width: number;
  height: number;
  requiredAssetSlots: number;
  verifiedAssetSlots: number;
  assetFingerprints: Partial<Record<JournalRequiredAssetId, JournalCanvasRegionFingerprint>>;
};

export type JournalCanvasRegionFingerprint = { red: number; green: number; blue: number; alpha: number };

type LoadedAssets = Record<JournalAssetSourceId, HTMLImageElement>;

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
      } catch {
        reject(new Error(`JOURNAL_CANVAS_ASSET_DECODE_FAILED:${id}`));
      }
    };
    image.onerror = () => reject(new Error(`JOURNAL_CANVAS_ASSET_LOAD_FAILED:${id}`));
    image.src = source;
  }).catch((error) => {
    assetCache.delete(cacheKey);
    throw error;
  });
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
  await Promise.all([19, 24, 34, 52].map((size) => document.fonts.load(`700 ${size}px ${fontFamily}`, "가나다라마바사")));
  if (!document.fonts.check(`700 24px ${fontFamily}`, "가나다라마바사")) {
    throw new Error("JOURNAL_CANVAS_FONT_NOT_READY");
  }
}

function roundRect(context: CanvasRenderingContext2D, rect: JournalSceneRect, radius: number) {
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  context.beginPath();
  context.moveTo(rect.x + r, rect.y);
  context.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height, r);
  context.arcTo(rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height, r);
  context.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y, r);
  context.arcTo(rect.x, rect.y, rect.x + rect.width, rect.y, r);
  context.closePath();
}

function fillRounded(context: CanvasRenderingContext2D, rect: JournalSceneRect, radius: number, fill: string, stroke?: string, width = 1) {
  roundRect(context, rect, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = width;
    context.stroke();
  }
}

function fitImage(context: CanvasRenderingContext2D, image: HTMLImageElement, slot: JournalSceneRect) {
  const scale = Math.min(slot.width / image.naturalWidth, slot.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, slot.x + (slot.width - width) / 2, slot.y + (slot.height - height) / 2, width, height);
}

function regionSignature(context: CanvasRenderingContext2D, slot: JournalSceneRect) {
  const x = Math.max(0, Math.floor(slot.x));
  const y = Math.max(0, Math.floor(slot.y));
  const width = Math.max(1, Math.min(context.canvas.width - x, Math.ceil(slot.width)));
  const height = Math.max(1, Math.min(context.canvas.height - y, Math.ceil(slot.height)));
  const data = context.getImageData(x, y, width, height).data;
  let signature = 2166136261;
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  for (let index = 0; index < data.length; index += 4) {
    signature ^= data[index] + (data[index + 1] << 8) + (data[index + 2] << 16) + (data[index + 3] << 24);
    signature = Math.imul(signature, 16777619);
    red += data[index];
    green += data[index + 1];
    blue += data[index + 2];
    alpha += data[index + 3];
  }
  const pixels = data.length / 4;
  return {
    signature: signature >>> 0,
    fingerprint: { red: red / pixels, green: green / pixels, blue: blue / pixels, alpha: alpha / pixels },
  };
}

function drawVerifiedAsset(context: CanvasRenderingContext2D, image: HTMLImageElement, slot: JournalSceneRect, id: string) {
  const before = regionSignature(context, slot);
  fitImage(context, image, slot);
  const after = regionSignature(context, slot);
  if (before.signature === after.signature) {
    throw new Error(`JOURNAL_CANVAS_ASSET_PIXEL_VALIDATION_FAILED:${id}`);
  }
  return after.fingerprint;
}

function setFont(context: CanvasRenderingContext2D, size: number, weight: number, family: string) {
  context.font = `${weight} ${size}px ${family}`;
  context.textBaseline = "middle";
}

function drawCenteredText(context: CanvasRenderingContext2D, text: string, x: number, y: number) {
  context.textAlign = "center";
  context.fillText(text, x, y);
}

function drawWrappedCenteredText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  centerY: number,
  maxWidth: number,
  maxLines: number,
  lineHeight: number,
) {
  const lines = wrapLines(context, text, maxWidth, maxLines);
  const firstY = centerY - ((lines.length - 1) * lineHeight) / 2;
  context.textAlign = "center";
  context.textBaseline = "middle";
  lines.forEach((line, index) => context.fillText(line, x, firstY + index * lineHeight));
}

function wrapLines(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const paragraphs = value.replaceAll("\r\n", "\n").split("\n");
  const lines: string[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    let current = "";
    Array.from(paragraph).forEach((character) => {
      const next = current + character;
      if (current && context.measureText(next).width > maxWidth) {
        lines.push(current);
        current = character;
      } else current = next;
    });
    if (current || paragraph === "") lines.push(current);
    if (paragraphIndex < paragraphs.length - 1 && !current) lines.push("");
  });
  if (lines.length > maxLines) throw new Error("JOURNAL_CANVAS_TEXT_OVERFLOW");
  return lines;
}

function drawOptions(
  context: CanvasRenderingContext2D,
  options: JournalPreviewOption[],
  area: JournalSceneRect,
  columns: number,
  family: string,
  highlight: string,
  size = 19,
) {
  const rows = Math.ceil(options.length / columns);
  const cellWidth = area.width / columns;
  const cellHeight = area.height / Math.max(rows, 1);
  options.forEach((option, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = area.x + column * cellWidth;
    const y = area.y + row * cellHeight;
    if (option.selected) fillRounded(context, { x: x + 2, y: y + 3, width: cellWidth - 4, height: cellHeight - 6 }, 10, highlight);
    context.strokeStyle = option.selected ? "#ff9da2" : "#aebdc8";
    context.lineWidth = option.selected ? 2 : 1.5;
    context.beginPath();
    context.arc(x + 15, y + cellHeight / 2, 10, 0, Math.PI * 2);
    context.stroke();
    if (option.selected) {
      context.strokeStyle = "#ff646a";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(x + 10, y + cellHeight / 2);
      context.lineTo(x + 14, y + cellHeight / 2 + 4);
      context.lineTo(x + 21, y + cellHeight / 2 - 5);
      context.stroke();
    }
    setFont(context, size, option.selected ? 900 : 600, family);
    context.fillStyle = option.selected ? "#25384a" : "#667786";
    context.textAlign = "left";
    context.fillText(option.label, x + 31, y + cellHeight / 2 + 1, cellWidth - 35);
  });
}

function heading(context: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, family: string, size = 26) {
  setFont(context, size, 900, family);
  context.fillStyle = color;
  context.textAlign = "left";
  context.fillText(text, x, y);
}

function renderScene(context: CanvasRenderingContext2D, scene: JournalReportScene, assets: LoadedAssets) {
  const { viewModel: vm, layout, palette: colors, fontFamily: family, assetSlots } = scene;
  context.save();
  context.fillStyle = colors.background;
  context.fillRect(0, 0, scene.width, scene.height);
  fillRounded(context, layout.outerBorder, layout.outerBorder.radius, colors.background, "#e6eef4", 3);

  fillRounded(context, layout.header, 52, "#ffffff", "#dbeaf4", 3);
  context.globalAlpha = 0.52;
  fillRounded(context, { x: 72, y: 70, width: 150, height: 150 }, 75, colors.coral.highlight);
  context.globalAlpha = 0.78;
  fillRounded(context, { x: 836, y: 74, width: 174, height: 144 }, 48, "#e8f4fc");
  context.globalAlpha = 1;
  const assetFingerprints: Partial<Record<JournalRequiredAssetId, JournalCanvasRegionFingerprint>> = {};
  assetFingerprints["header-dog-a"] = drawVerifiedAsset(context, assets["header-dog-a"], assetSlots["header-dog-a"], "header-dog-a");
  assetFingerprints["header-dog-b"] = drawVerifiedAsset(context, assets["header-dog-b"], assetSlots["header-dog-b"], "header-dog-b");
  context.save();
  context.filter = "brightness(0) saturate(100%) invert(32%) sepia(22%) saturate(1195%) hue-rotate(158deg) brightness(92%) contrast(90%)";
  fitImage(context, assets["official-logo"], assetSlots["official-logo"]);
  context.restore();
  setFont(context, 52, 900, family);
  context.fillStyle = colors.blue;
  drawCenteredText(context, "하루 일지", 540, 170);
  setFont(context, journalDogNameFontSize(vm.dogName.length), 900, family);
  drawWrappedCenteredText(context, vm.dogName, 189, 250, 240, 2, journalDogNameFontSize(vm.dogName.length) * 1.08);
  setFont(context, 24, 700, family);
  context.fillStyle = "#718395";
  drawCenteredText(context, vm.displayDate, 909, 252);

  fillRounded(context, layout.daily, 38, colors.coral.surface);
  context.fillStyle = colors.green.surface;
  context.fillRect(490, layout.daily.y, 544, layout.daily.height);
  heading(context, "오늘의 컨디션", 78, 326, colors.coral.accent, family);
  drawOptions(context, vm.conditionOptions, { x: 72, y: 342, width: 392, height: 108 }, 2, family, colors.coral.highlight);
  heading(context, "배변 상태", 540, 326, colors.green.accent, family);
  setFont(context, 18, 800, family);
  context.fillStyle = "#52697c";
  context.textAlign = "left";
  context.fillText("소변", 540, 358);
  context.fillText("대변", 650, 358);
  context.fillText("대변 상태", 760, 358);
  drawOptions(context, vm.urinationOptions, { x: 535, y: 371, width: 105, height: 65 }, 2, family, colors.green.highlight, 18);
  drawOptions(context, vm.defecationOptions, { x: 645, y: 371, width: 105, height: 65 }, 2, family, colors.green.highlight, 18);
  drawOptions(context, vm.stoolOptions, { x: 755, y: 355, width: 255, height: 96 }, 2, family, colors.green.highlight, 17);

  const meal = { x: 55, y: 475, width: 350, height: 206 };
  fillRounded(context, meal, 34, colors.amber.surface);
  heading(context, "유치원에서 먹은 것", 74, 510, colors.amber.accent, family, 24);
  assetFingerprints.meal = drawVerifiedAsset(context, assets.meal, assetSlots.meal, "meal");
  drawOptions(context, vm.mealOptions, { x: 70, y: 545, width: 312, height: 115 }, 2, family, colors.amber.highlight, 18);
  const relationship = { x: 427, y: 475, width: 598, height: 206 };
  fillRounded(context, relationship, 38, colors.lavender.surface);
  heading(context, "오늘의 관계", 452, 510, colors.lavender.accent, family);
  setFont(context, 18, 800, family);
  context.fillStyle = "#52697c";
  context.fillText("선생님과", 454, 544);
  context.fillText("친구들과", 750, 544);
  drawOptions(context, vm.teacherRelationshipOptions, { x: 445, y: 552, width: 276, height: 112 }, 1, family, colors.lavender.highlight, 17);
  drawOptions(context, vm.friendRelationshipOptions, { x: 742, y: 552, width: 270, height: 112 }, 1, family, colors.lavender.highlight, 17);

  fillRounded(context, { x: 229, y: 704, width: 610, height: 90 }, 45, "#f5fbff");
  assetFingerprints["best-friend-duo"] = drawVerifiedAsset(context, assets["best-friend-duo"], assetSlots["best-friend-duo"], "best-friend-duo");
  setFont(context, 20, 900, family);
  context.fillStyle = "#607488";
  drawCenteredText(context, "오늘의 제일 친한 친구는", 630, 724);
  setFont(context, journalBestFriendFontSize((vm.bestFriendName ?? "").length), 900, family);
  context.fillStyle = colors.blue;
  drawWrappedCenteredText(context, vm.bestFriendName || " ", 610, 770, 350, 2, journalBestFriendFontSize((vm.bestFriendName ?? "").length) * 1.08);
  setFont(context, 20, 800, family);
  context.fillStyle = "#607488";
  context.textAlign = "left";
  context.fillText("예요 ♡", 748, 773);

  fillRounded(context, { x: 54, y: 821, width: 474, height: 170 }, 38, colors.coral.surface);
  fillRounded(context, { x: 552, y: 821, width: 474, height: 170 }, 38, colors.green.surface);
  assetFingerprints.manners = drawVerifiedAsset(context, assets.manners, assetSlots.manners, "manners");
  assetFingerprints.physical = drawVerifiedAsset(context, assets.physical, assetSlots.physical, "physical");
  heading(context, vm.manners.title, 120, 850, colors.coral.accent, family);
  heading(context, vm.physical.title, 580, 850, colors.green.accent, family);
  setFont(context, journalActivityFontSize(vm.manners.activityName.length), 900, family);
  context.fillStyle = colors.ink;
  drawWrappedCenteredText(context, vm.manners.activityName || " ", 291, 898, 360, 2, journalActivityFontSize(vm.manners.activityName.length) * 1.2);
  setFont(context, journalActivityFontSize(vm.physical.activityName.length), 900, family);
  drawWrappedCenteredText(context, vm.physical.activityName || " ", 789, 898, 360, 2, journalActivityFontSize(vm.physical.activityName.length) * 1.2);
  drawOptions(context, vm.manners.options, { x: 80, y: 928, width: 420, height: 56 }, 2, family, colors.coral.highlight, 16);
  drawOptions(context, vm.physical.options, { x: 578, y: 928, width: 420, height: 56 }, 2, family, colors.green.highlight, 16);

  fillRounded(context, layout.comment, 44, "#ffffff", colors.coral.border, 3);
  heading(context, "선생님의 한마디", 82, 1042, colors.blue, family, 27);
  const commentStyle = journalCommentTypography(vm.teacherComment.length);
  setFont(context, commentStyle.size, 400, family);
  context.fillStyle = colors.ink;
  context.textAlign = "left";
  context.textBaseline = "top";
  const commentArea = { x: 108, y: 1080, width: 730, height: 275 };
  const lineHeight = commentStyle.size * commentStyle.lineHeight;
  const lines = wrapLines(context, vm.teacherComment, commentArea.width, Math.floor(commentArea.height / lineHeight));
  lines.forEach((line, index) => context.fillText(line, commentArea.x, commentArea.y + index * lineHeight));
  assetFingerprints["teacher-comment-dog"] = drawVerifiedAsset(context, assets["teacher-comment-dog"], assetSlots["teacher-comment-dog"], "teacher-comment-dog");
  context.restore();
  return assetFingerprints;
}

function fingerprintDistance(left: JournalCanvasRegionFingerprint, right: JournalCanvasRegionFingerprint) {
  return Math.max(
    Math.abs(left.red - right.red),
    Math.abs(left.green - right.green),
    Math.abs(left.blue - right.blue),
    Math.abs(left.alpha - right.alpha),
  );
}

async function decodeJournalBlob(blob: Blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("JOURNAL_EXPORT_DECODE_FAILED"));
    });
    if (typeof image.decode === "function") await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function validateJournalEncodedBlob(blob: Blob, scene: JournalReportScene, metrics: JournalCanvasRenderMetrics) {
  const decoded = await decodeJournalBlob(blob);
  if (decoded.width !== scene.width || decoded.height !== scene.height) {
    if ("close" in decoded && typeof decoded.close === "function") decoded.close();
    throw new Error("JOURNAL_EXPORT_DECODE_SIZE_MISMATCH");
  }
  const canvas = document.createElement("canvas");
  canvas.width = scene.width;
  canvas.height = scene.height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("JOURNAL_EXPORT_VALIDATION_CONTEXT_UNAVAILABLE");
  context.drawImage(decoded, 0, 0);
  try {
    JOURNAL_REQUIRED_ASSET_IDS.forEach((id) => {
      const expected = metrics.assetFingerprints[id];
      if (!expected) throw new Error(`JOURNAL_EXPORT_ENCODED_ASSET_MISSING:${id}`);
      const actual = regionSignature(context, scene.assetSlots[id]).fingerprint;
      const tolerance = blob.type === "image/jpeg" ? 20 : 5;
      if (fingerprintDistance(expected, actual) > tolerance) {
        throw new Error(`JOURNAL_EXPORT_ENCODED_ASSET_MISSING:${id}`);
      }
    });
  } finally {
    if ("close" in decoded && typeof decoded.close === "function") decoded.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function renderJournalReportToCanvas(
  scene: JournalReportScene,
  sources: JournalAssetSourceMap = JOURNAL_CANVAS_ASSET_SOURCES,
) {
  await waitForJournalCanvasFonts(scene.fontFamily);
  const assets = await loadJournalCanvasAssets(sources);
  const canvas = document.createElement("canvas");
  canvas.width = scene.width;
  canvas.height = scene.height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("JOURNAL_CANVAS_CONTEXT_UNAVAILABLE");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const assetFingerprints = renderScene(context, scene, assets);
  const metrics: JournalCanvasRenderMetrics = {
    width: canvas.width,
    height: canvas.height,
    requiredAssetSlots: JOURNAL_REQUIRED_ASSET_IDS.length,
    verifiedAssetSlots: JOURNAL_REQUIRED_ASSET_IDS.length,
    assetFingerprints,
  };
  return { canvas, metrics };
}
