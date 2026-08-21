// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCanvas } from "html-to-image";
import {
  buildJournalExportFilename,
  encodeJournalPreviewBlob,
  exportJournalImage,
  exportJournalPreviewImage,
  inlineJournalSnapshotImages,
  renderJournalImageBlob,
  waitForJournalAssets,
} from "./journalExport";
import {
  buildJournalPreviewRenderKey,
  createCurrentJournalRasterCacheEntry,
  JOURNAL_ASSET_VERSION,
  JOURNAL_RENDERER_VERSION,
  JOURNAL_TEMPLATE_VERSION,
} from "./journalRenderContract";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

vi.mock("html-to-image", () => ({ toCanvas: vi.fn() }));

const viewModel = {
  dogName: "크리미",
  businessDate: "2026-08-20",
} as JournalPreviewViewModel;

function createCurrentTemplateRoot() {
  const root = document.createElement("article");
  root.dataset.journalSource = "typed-view-model";
  root.dataset.journalRendererVersion = JOURNAL_RENDERER_VERSION;
  root.dataset.journalTemplateVersion = JOURNAL_TEMPLATE_VERSION;
  root.dataset.journalAssetVersion = JOURNAL_ASSET_VERSION;
  return root;
}

function createCurrentRaster(blob: Blob) {
  return createCurrentJournalRasterCacheEntry(
    buildJournalPreviewRenderKey(viewModel),
    blob,
    "blob:canonical-preview",
  );
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
      decode: { configurable: true, value: decode },
    });
    root.appendChild(image);
    await waitForJournalAssets(root);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("fails closed before rasterizing when an illustration cannot load", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 0 },
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

  it("fails closed instead of caching a snapshot when an approved asset cannot be embedded", async () => {
    const root = document.createElement("div");
    const image = document.createElement("img");
    image.src = "/assets/missing-approved-illustration.png";
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 320 },
      decode: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
    });
    root.appendChild(image);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(inlineJournalSnapshotImages(root)).rejects.toThrow("JOURNAL_EXPORT_ASSET_INLINE_FAILED");
    expect(toCanvas).not.toHaveBeenCalled();
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

  it("downloads the exact PNG blob displayed by the live preview without rerasterizing", async () => {
    const previewBlob = new Blob(["canonical-preview"], { type: "image/png" });
    const result = await exportJournalPreviewImage(createCurrentRaster(previewBlob), viewModel, "png");
    expect(result.blob).toBe(previewBlob);
    expect(result.filename).toBe("P&M_하루일지_크리미_2026-08-20.png");
    expect(toCanvas).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("encodes JPG from the same 1080×1440 preview bitmap without a resize pass", async () => {
    class MockImage {
      decoding = "async";
      naturalWidth = 1080;
      naturalHeight = 1440;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
      decode = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal("Image", MockImage);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type?: string) => {
      callback(new Blob(["jpg"], { type }));
    });
    const previewBlob = new Blob(["canonical-preview"], { type: "image/png" });
    const jpg = await encodeJournalPreviewBlob(previewBlob, "jpg");
    const context = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results.at(-1)?.value as unknown as CanvasRenderingContext2D;
    expect(jpg.type).toBe("image/jpeg");
    expect(context.drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0);
    expect(toCanvas).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:journal");
  });

  it("rejects an unversioned or stale rendered preview instead of treating it as canonical", async () => {
    const previewBlob = new Blob(["legacy-preview"], { type: "image/png" });
    const staleRaster = {
      ...createCurrentRaster(previewBlob),
      templateVersion: "legacy-template",
    };

    await expect(exportJournalPreviewImage(staleRaster, viewModel, "png"))
      .rejects.toThrow("JOURNAL_PREVIEW_CACHE_VERSION_MISMATCH");
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
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
});
