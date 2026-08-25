// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCanvas } from "html-to-image";
import {
  buildJournalExportFilename,
  exportJournalImage,
  inlineJournalSnapshotImages,
  renderJournalImageBlob,
  waitForJournalAssets,
} from "./journalExport";
import {
  journalViewModelRevision,
  JOURNAL_ASSET_VERSION,
  JOURNAL_REQUIRED_ASSET_IDS,
  JOURNAL_RENDERER_VERSION,
  JOURNAL_TEMPLATE_VERSION,
} from "./journalRenderContract";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

vi.mock("html-to-image", () => ({ toCanvas: vi.fn() }));

const viewModel = {
  entryId: "entry-creamy",
  dogName: "크리미",
  businessDate: "2026-08-20",
} as JournalPreviewViewModel;

function createCurrentTemplateRoot(model: JournalPreviewViewModel = viewModel) {
  const root = document.createElement("article");
  root.dataset.journalSource = "typed-view-model";
  root.dataset.journalRendererVersion = JOURNAL_RENDERER_VERSION;
  root.dataset.journalTemplateVersion = JOURNAL_TEMPLATE_VERSION;
  root.dataset.journalAssetVersion = JOURNAL_ASSET_VERSION;
  root.dataset.journalEntryId = model.entryId;
  root.dataset.journalViewModelRevision = journalViewModelRevision(model);
  JOURNAL_REQUIRED_ASSET_IDS.forEach((assetId) => {
    const image = document.createElement("img");
    image.dataset.journalAsset = assetId;
    image.src = `data:image/png;base64,${btoa(assetId)}`;
    root.appendChild(image);
  });
  return root;
}

const originalImageComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
const originalImageNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth");
const originalImageNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalHeight");
const originalImageDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");

function restoreImageProperty(name: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(HTMLImageElement.prototype, name, descriptor);
  else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[name];
}

describe("Journal image export", () => {
  beforeEach(() => {
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:journal") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    } as unknown as CanvasRenderingContext2D);
    Object.defineProperties(HTMLImageElement.prototype, {
      complete: { configurable: true, get: () => true },
      naturalWidth: { configurable: true, get: () => 320 },
      naturalHeight: { configurable: true, get: () => 240 },
      decode: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    restoreImageProperty("complete", originalImageComplete);
    restoreImageProperty("naturalWidth", originalImageNaturalWidth);
    restoreImageProperty("naturalHeight", originalImageNaturalHeight);
    restoreImageProperty("decode", originalImageDecode);
  });

  it("keeps Korean names, uses the journal date, and sanitizes unsafe or long names", () => {
    expect(buildJournalExportFilename("크리미", "2026-08-20", "png"))
      .toBe("P&M_하루일지_크리미_2026-08-20.png");
    expect(buildJournalExportFilename("  크리미 / 별이:*  ", "2026-08-20", "jpg"))
      .toBe("P&M_하루일지_크리미_별이_2026-08-20.jpg");
    const longName = "가".repeat(80);
    expect(buildJournalExportFilename(longName, "invalid", "png"))
      .toBe(`P&M_하루일지_${"가".repeat(32)}_날짜미정.png`);
  });

  it("waits for fonts and every bundled image decode before rasterizing", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    const decode = vi.fn().mockResolvedValue(undefined);
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 120 },
      naturalHeight: { configurable: true, value: 80 },
      decode: { configurable: true, value: decode },
    });
    root.appendChild(image);
    await waitForJournalAssets(root);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("waits for delayed load and delayed decode before resolving asset readiness", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    let complete = false;
    let decodeReady!: () => void;
    const decode = vi.fn(() => new Promise<void>((resolve) => { decodeReady = resolve; }));
    Object.defineProperties(image, {
      complete: { configurable: true, get: () => complete },
      naturalWidth: { configurable: true, get: () => complete ? 120 : 0 },
      naturalHeight: { configurable: true, get: () => complete ? 80 : 0 },
      decode: { configurable: true, value: decode },
    });
    root.appendChild(image);
    let resolved = false;
    const readiness = waitForJournalAssets(root).then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    complete = true;
    image.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(decode).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
    decodeReady();
    await readiness;
    expect(resolved).toBe(true);
  });

  it("fails closed when decode rejects or either natural dimension is zero", async () => {
    const decodeFailure = document.createElement("img");
    Object.defineProperties(decodeFailure, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 120 },
      naturalHeight: { configurable: true, value: 80 },
      decode: { configurable: true, value: vi.fn().mockRejectedValue(new Error("decode")) },
    });
    const decodeRoot = document.createElement("div");
    decodeRoot.appendChild(decodeFailure);
    await expect(waitForJournalAssets(decodeRoot)).rejects.toThrow("JOURNAL_EXPORT_ASSET_DECODE_FAILED");

    const zeroHeight = document.createElement("img");
    Object.defineProperties(zeroHeight, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 120 },
      naturalHeight: { configurable: true, value: 0 },
      decode: { configurable: true, value: undefined },
    });
    const dimensionRoot = document.createElement("div");
    dimensionRoot.appendChild(zeroHeight);
    await expect(waitForJournalAssets(dimensionRoot)).rejects.toThrow("JOURNAL_EXPORT_ASSET_LOAD_FAILED");
    expect(toCanvas).not.toHaveBeenCalled();
  });

  it("uses the dimensions fallback when Safari does not expose img.decode", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 120 },
      naturalHeight: { configurable: true, value: 80 },
      decode: { configurable: true, value: undefined },
    });
    root.appendChild(image);
    await expect(waitForJournalAssets(root)).resolves.toBeUndefined();
  });

  it("fails closed before rasterizing when an illustration cannot load", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 0 },
      naturalHeight: { configurable: true, value: 0 },
    });
    root.appendChild(image);
    const readiness = waitForJournalAssets(root);
    await Promise.resolve();
    image.dispatchEvent(new Event("error"));
    await expect(readiness).rejects.toThrow("JOURNAL_EXPORT_ASSET_LOAD_FAILED");
    expect(toCanvas).not.toHaveBeenCalled();
  });

  it("inlines every decoded illustration before the canonical snapshot is rasterized", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    image.src = "/assets/journal-approved-illustration.png";
    const decode = vi.fn().mockResolvedValue(undefined);
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 320 },
      naturalHeight: { configurable: true, value: 240 },
      decode: { configurable: true, value: decode },
    });
    root.appendChild(image);
    const originalSource = image.src;
    const fetchAsset = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["approved-image"], { type: "image/png" }) });
    vi.stubGlobal("fetch", fetchAsset);

    await inlineJournalSnapshotImages(root);

    expect(fetchAsset).toHaveBeenCalledWith(originalSource, expect.anything());
    expect(image.src).toMatch(/^data:image\/png;base64,/);
    expect(image.dataset.journalAssetInlined).toBe("true");
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("reuses an approved asset payload across repeated preview snapshots", async () => {
    const createRoot = () => {
      const root = document.createElement("div");
      const image = document.createElement("img");
      image.src = "/assets/journal-preview-cache-contract.png";
      Object.defineProperties(image, {
        complete: { configurable: true, value: true },
        naturalWidth: { configurable: true, value: 320 },
        naturalHeight: { configurable: true, value: 240 },
        decode: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
      });
      root.appendChild(image);
      return root;
    };
    const fetchAsset = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["approved-image"], { type: "image/png" }) });
    vi.stubGlobal("fetch", fetchAsset);
    await inlineJournalSnapshotImages(createRoot());
    await inlineJournalSnapshotImages(createRoot());
    expect(fetchAsset).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of caching a snapshot when an approved asset cannot be embedded", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    image.src = "/assets/missing-approved-illustration.png";
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 320 },
      naturalHeight: { configurable: true, value: 240 },
      decode: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
    });
    root.appendChild(image);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(inlineJournalSnapshotImages(root)).rejects.toThrow("JOURNAL_EXPORT_ASSET_INLINE_FAILED");
    expect(toCanvas).not.toHaveBeenCalled();
  });

  it("requires every approved illustration identity exactly once before rasterizing", async () => {
    const root = createCurrentTemplateRoot();
    root.querySelector('[data-journal-asset="physical"]')?.remove();
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    vi.mocked(toCanvas).mockResolvedValue(canvas);
    await expect(renderJournalImageBlob(root, "png")).rejects.toThrow("JOURNAL_EXPORT_REQUIRED_ASSET_MISSING:physical");
    expect(toCanvas).not.toHaveBeenCalled();
  });

  it("performs no asset fetch during rasterization and rejects any non-embedded image", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    vi.mocked(toCanvas).mockResolvedValue(canvas);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type?: string) => callback(new Blob(["png"], { type })));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await renderJournalImageBlob(createCurrentTemplateRoot(), "png");
    expect(fetchSpy).not.toHaveBeenCalled();

    const nonEmbedded = createCurrentTemplateRoot();
    const logo = document.createElement("img");
    logo.src = "/assets/pm-logo.png";
    nonEmbedded.appendChild(logo);
    await expect(renderJournalImageBlob(nonEmbedded, "png"))
      .rejects.toThrow("JOURNAL_EXPORT_PRE_RASTER_ASSET_GATE_FAILED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never rasterizes before all required images decode and removes the snapshot only after rasterization", async () => {
    let releaseDecode!: () => void;
    const decodeBarrier = new Promise<void>((resolve) => { releaseDecode = resolve; });
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: vi.fn(() => decodeBarrier),
    });
    let releaseRaster!: (canvas: HTMLCanvasElement) => void;
    vi.mocked(toCanvas).mockImplementation(() => new Promise<HTMLCanvasElement>((resolve) => { releaseRaster = resolve; }));
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type?: string) => callback(new Blob(["png"], { type })));

    const exporting = renderJournalImageBlob(createCurrentTemplateRoot(), "png");
    await Promise.resolve();
    await Promise.resolve();
    expect(toCanvas).not.toHaveBeenCalled();
    expect(document.querySelector("[data-journal-export-snapshot='true']")).not.toBeNull();
    releaseDecode();
    await vi.waitFor(() => expect(toCanvas).toHaveBeenCalledTimes(1));
    expect(document.querySelector("[data-journal-export-snapshot='true']")).not.toBeNull();
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    releaseRaster(canvas);
    await exporting;
    expect(document.querySelector("[data-journal-export-snapshot='true']")).toBeNull();
  });

  it.each([
    ["png", "image/png", undefined, "P&M_하루일지_크리미_2026-08-20.png"],
    ["jpg", "image/jpeg", 0.95, "P&M_하루일지_크리미_2026-08-20.jpg"],
  ] as const)("exports %s at exactly 1080×1440 and downloads it", async (format, mimeType, quality, filename) => {
    const root = createCurrentTemplateRoot();
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type?: string, requestedQuality?: number) => {
      expect(type).toBe(mimeType);
      expect(requestedQuality).toBe(quality);
      callback(new Blob([format], { type }));
    });
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    vi.mocked(toCanvas).mockResolvedValue(canvas);

    let clickedFilename = "";
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function click(this: HTMLAnchorElement) {
      clickedFilename = this.download;
    });
    const exported = await exportJournalImage(root, viewModel, format);

    const rasterizedRoot = vi.mocked(toCanvas).mock.calls[0][0] as HTMLElement;
    expect(rasterizedRoot).not.toBe(root);
    expect(rasterizedRoot.dataset.journalCanonicalSnapshot).toBe("true");
    expect(toCanvas).toHaveBeenCalledWith(rasterizedRoot, expect.objectContaining({
      width: 1080,
      height: 1440,
      canvasWidth: 1080,
      canvasHeight: 1440,
      pixelRatio: 1,
      backgroundColor: "#fffcf8",
    }));
    expect(exported).toEqual({ blob: expect.objectContaining({ type: mimeType }), filename });
    expect(clickedFilename).toBe(filename);
    expect(document.querySelector(`a[download="${filename}"]`)).toBeNull();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(toBlob).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-journal-export-snapshot='true']")).toBeNull();
  });

  it("keeps the supersampled candidate available for visual QA without selecting it for production", async () => {
    const root = createCurrentTemplateRoot();
    const source = { width: 2160, height: 2880 } as HTMLCanvasElement;
    vi.mocked(toCanvas).mockResolvedValue(source);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type?: string) => {
      callback(new Blob(["png"], { type }));
    });
    await renderJournalImageBlob(root, "png", "supersampled");
    expect(toCanvas).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
      canvasWidth: 2160,
      canvasHeight: 2880,
    }));
    const context = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results[0]?.value as unknown as CanvasRenderingContext2D;
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(context.imageSmoothingQuality).toBe("high");
    expect(context.drawImage).toHaveBeenCalled();
  });

  it("rejects a rendered DOM snapshot without the current renderer contract", async () => {
    const legacyRoot = document.createElement("article");
    await expect(renderJournalImageBlob(legacyRoot, "png"))
      .rejects.toThrow("JOURNAL_RENDER_SOURCE_VERSION_MISMATCH");
    expect(toCanvas).not.toHaveBeenCalled();
  });

  it("fails closed when the rasterizer returns the wrong dimensions", async () => {
    const root = createCurrentTemplateRoot();
    vi.mocked(toCanvas).mockResolvedValue({ width: 2160, height: 2880 } as HTMLCanvasElement);
    await expect(exportJournalImage(root, viewModel, "png")).rejects.toThrow("JOURNAL_EXPORT_RASTER_SIZE_MISMATCH");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("fails closed when the clicked ViewModel does not own the rendered entry root", async () => {
    const root = createCurrentTemplateRoot();
    await expect(exportJournalImage(root, { ...viewModel, entryId: "entry-autumn", dogName: "가을" }, "png"))
      .rejects.toThrow("JOURNAL_EXPORT_ENTRY_IDENTITY_MISMATCH");
    expect(toCanvas).not.toHaveBeenCalled();
  });

  it("serializes overlapping entry generations and rasterizes each captured same-node snapshot", async () => {
    const dust = { ...viewModel, entryId: "entry-dust", dogName: "먼지" };
    const autumn = { ...viewModel, entryId: "entry-autumn", dogName: "가을" };
    let releaseFirst!: (canvas: HTMLCanvasElement) => void;
    const firstCanvas = new Promise<HTMLCanvasElement>((resolve) => { releaseFirst = resolve; });
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    vi.mocked(toCanvas).mockImplementationOnce(() => firstCanvas).mockResolvedValue(canvas);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type?: string) => callback(new Blob(["image"], { type })));

    const first = renderJournalImageBlob(createCurrentTemplateRoot(dust), "png");
    const second = renderJournalImageBlob(createCurrentTemplateRoot(autumn), "png");
    await vi.waitFor(() => expect(toCanvas).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll("[data-journal-export-snapshot='true']")).toHaveLength(2);
    const dustNode = vi.mocked(toCanvas).mock.calls[0][0] as HTMLElement;
    expect(dustNode.dataset.journalEntryId).toBe("entry-dust");
    releaseFirst(canvas);
    await vi.waitFor(() => expect(toCanvas).toHaveBeenCalledTimes(2));
    const autumnNode = vi.mocked(toCanvas).mock.calls[1][0] as HTMLElement;
    expect(autumnNode.dataset.journalEntryId).toBe("entry-autumn");
    expect(autumnNode).not.toBe(dustNode);
    expect(autumnNode.dataset.exportGenerationId).not.toBe(dustNode.dataset.exportGenerationId);
    await Promise.all([first, second]);
    expect(document.querySelectorAll("[data-journal-export-snapshot='true']")).toHaveLength(0);
  });

  it("rechecks entry identity immediately before rasterization", async () => {
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: vi.fn(function decode(this: HTMLImageElement) {
        const root = this.closest<HTMLElement>("[data-journal-canonical-snapshot='true']");
        if (root) root.dataset.journalEntryId = "entry-wrong";
        return Promise.resolve();
      }),
    });
    await expect(renderJournalImageBlob(createCurrentTemplateRoot(), "png"))
      .rejects.toThrow("JOURNAL_EXPORT_ENTRY_IDENTITY_MISMATCH");
    expect(toCanvas).not.toHaveBeenCalled();
    expect(document.querySelectorAll("[data-journal-export-snapshot='true']")).toHaveLength(0);
  });

  it("keeps 20 alternating entry generations isolated and complete", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    vi.mocked(toCanvas).mockResolvedValue(canvas);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type?: string) => callback(new Blob(["image"], { type })));
    const models = Array.from({ length: 20 }, (_, index) => index % 2 === 0
      ? { ...viewModel, entryId: "entry-dust", dogName: "먼지" }
      : { ...viewModel, entryId: "entry-autumn", dogName: "가을" });
    await Promise.all(models.map((model) => renderJournalImageBlob(createCurrentTemplateRoot(model), "png")));
    const rasterNodes = vi.mocked(toCanvas).mock.calls.map(([node]) => node as HTMLElement);
    expect(rasterNodes).toHaveLength(20);
    expect(rasterNodes.map((node) => node.dataset.journalEntryId))
      .toEqual(models.map((model) => model.entryId));
    expect(new Set(rasterNodes.map((node) => node.dataset.exportGenerationId)).size).toBe(20);
    rasterNodes.forEach((node) => {
      expect(node.querySelectorAll("img[data-journal-asset]")).toHaveLength(7);
      expect(Array.from(node.querySelectorAll<HTMLImageElement>("img[data-journal-asset]")).every((image) => image.src.startsWith("data:"))).toBe(true);
    });
  });
});
