// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCanvas } from "html-to-image";
import {
  buildJournalExportFilename,
  exportJournalImage,
  waitForJournalAssets,
} from "./journalExport";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

vi.mock("html-to-image", () => ({ toCanvas: vi.fn() }));

const viewModel = {
  dogName: "크리미",
  businessDate: "2026-08-20",
} as JournalPreviewViewModel;

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

  afterEach(() => vi.restoreAllMocks());

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

  it.each([
    ["png", "image/png", undefined, "P&M_하루일지_크리미_2026-08-20.png"],
    ["jpg", "image/jpeg", 0.95, "P&M_하루일지_크리미_2026-08-20.jpg"],
  ] as const)("exports %s at exactly 1080×1440 and downloads it", async (format, mimeType, quality, filename) => {
    const root = document.createElement("article");
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type?: string, requestedQuality?: number) => {
      expect(type).toBe(mimeType);
      expect(requestedQuality).toBe(quality);
      callback(new Blob([format], { type }));
    });
    const canvas = { width: 2160, height: 2880 } as unknown as HTMLCanvasElement;
    vi.mocked(toCanvas).mockResolvedValue(canvas);

    let clickedFilename = "";
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function click(this: HTMLAnchorElement) {
      clickedFilename = this.download;
    });
    const exported = await exportJournalImage(root, viewModel, format);

    expect(toCanvas).toHaveBeenCalledWith(root, expect.objectContaining({
      width: 1080,
      height: 1440,
      canvasWidth: 2160,
      canvasHeight: 2880,
      pixelRatio: 1,
      backgroundColor: "#fffcf8",
    }));
    expect(exported).toEqual({ blob: expect.objectContaining({ type: mimeType }), filename });
    expect(clickedFilename).toBe(filename);
    expect(document.querySelector(`a[download="${filename}"]`)).toBeNull();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(toBlob).toHaveBeenCalledTimes(1);
    const context = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results[0]?.value as unknown as CanvasRenderingContext2D;
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(context.imageSmoothingQuality).toBe("high");
    expect(context.drawImage).toHaveBeenCalled();
  });

  it("fails closed when the rasterizer returns the wrong dimensions", async () => {
    const root = document.createElement("article");
    vi.mocked(toCanvas).mockResolvedValue({ width: 1080, height: 1440 } as HTMLCanvasElement);
    await expect(exportJournalImage(root, viewModel, "png")).rejects.toThrow("JOURNAL_EXPORT_RASTER_SIZE_MISMATCH");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
