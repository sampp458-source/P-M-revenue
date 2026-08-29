// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildJournalExportFilename, exportJournalImage, renderJournalImageBlob } from "./journalExport";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

const mocks = vi.hoisted(() => ({ renderCanvas: vi.fn(), validateBlob: vi.fn() }));

vi.mock("./journalCanvasRenderer", () => ({
  renderJournalReportToCanvas: mocks.renderCanvas,
  validateJournalEncodedBlob: mocks.validateBlob,
}));

const viewModel = {
  entryId: "entry-creamy",
  businessDate: "2026-08-20",
  displayDate: "2026.08.20",
  dogName: "크리미",
  customerName: "보호자",
  status: "COMPLETED",
  conditionOptions: [],
  urinationOptions: [],
  defecationOptions: [],
  stoolOptions: [],
  mealOptions: [],
  teacherRelationshipOptions: [],
  friendRelationshipOptions: [],
  bestFriendName: null,
  manners: { title: "예절교육", activityName: "기다려", options: [] },
  physical: { title: "체육 시간", activityName: "공놀이", options: [] },
  teacherComment: "즐거운 하루였어요.",
} satisfies JournalPreviewViewModel;

function renderedCanvas(type = "image/png") {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1440;
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(new Blob(["image"], { type })));
  return canvas;
}

const readyMetrics = (overrides: Record<string, number> = {}) => ({
  width: 1080,
  height: 1440,
  requiredAssetSlots: 7,
  verifiedAssetSlots: 7,
  requiredVisualElements: 13,
  verifiedVisualElements: 13,
  requiredTextLandmarks: 16,
  verifiedTextLandmarks: 16,
  ...overrides,
});

describe("Journal Canvas export", () => {
  it("resolves the device-local Teacher Comment font before building the Canvas scene", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/journalExport.ts"), "utf8");
    expect(source).toContain("await ensureActiveJournalTeacherCommentPresentation()");
    expect(source).toContain("assertJournalTeacherCommentGeometry(viewModel.teacherComment, presentation.fontFamily, presentation.fontSize)");
    expect(source).toContain("buildJournalReportScene(viewModel, presentation.fontFamily, presentation.fontSize)");
  });
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:journal") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mocks.renderCanvas.mockResolvedValue({
      canvas: renderedCanvas(),
      metrics: readyMetrics(),
    });
    mocks.validateBlob.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps Korean names, uses the journal date, and sanitizes unsafe or long names", () => {
    expect(buildJournalExportFilename("크리미", "2026-08-20", "png")).toBe("P&M_하루일지_크리미_2026-08-20.png");
    expect(buildJournalExportFilename("  크리미 / 별이:*  ", "2026-08-20", "jpg")).toBe("P&M_하루일지_크리미_별이_2026-08-20.jpg");
    expect(buildJournalExportFilename("가".repeat(80), "invalid", "png"))
      .toBe(`P&M_하루일지_${"가".repeat(32)}_날짜미정.png`);
  });

  it.each([
    ["png", "image/png", undefined, "P&M_하루일지_크리미_2026-08-20.png"],
    ["jpg", "image/jpeg", 0.95, "P&M_하루일지_크리미_2026-08-20.jpg"],
  ] as const)("exports %s from the typed ViewModel at exactly 1080×1440", async (format, mimeType, quality, filename) => {
    const canvas = renderedCanvas(mimeType);
    const toBlob = vi.mocked(canvas.toBlob);
    mocks.renderCanvas.mockResolvedValueOnce({ canvas, metrics: readyMetrics() });
    const result = await exportJournalImage(viewModel, format);
    expect(mocks.renderCanvas).toHaveBeenCalledWith(expect.objectContaining({ viewModel, width: 1080, height: 1440 }));
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), mimeType, quality);
    expect(result.filename).toBe(filename);
    expect(result.blob.type).toBe(mimeType);
    expect(mocks.validateBlob).toHaveBeenCalledWith(result.blob, expect.objectContaining({ viewModel }), expect.objectContaining({ verifiedAssetSlots: 7 }));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("fails closed when any approved illustration pixel slot is unverified", async () => {
    const canvas = renderedCanvas();
    mocks.renderCanvas.mockResolvedValueOnce({
      canvas,
      metrics: readyMetrics({ verifiedAssetSlots: 6 }),
    });
    await expect(renderJournalImageBlob(viewModel, "png")).rejects.toThrow("JOURNAL_EXPORT_ASSET_PIXEL_VALIDATION_FAILED");
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("reports render, encode, and validation boundaries in order", async () => {
    const events: string[] = [];
    const blob = await renderJournalImageBlob(viewModel, "png", (event) => {
      events.push(`${event.stage}_${event.state}`);
    });
    expect(blob.size).toBeGreaterThan(0);
    expect(events).toEqual([
      "RENDER_START", "RENDER_ACK",
      "ENCODE_START", "ENCODE_ACK",
      "VALIDATION_START", "VALIDATION_ACK",
    ]);
  });

  it("releases the render canvas when encoding fails", async () => {
    const canvas = renderedCanvas();
    vi.mocked(canvas.toBlob).mockImplementationOnce((callback) => callback(null));
    mocks.renderCanvas.mockResolvedValueOnce({ canvas, metrics: readyMetrics() });
    await expect(renderJournalImageBlob(viewModel, "png")).rejects.toThrow("JOURNAL_EXPORT_ENCODING_FAILED");
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
  });

  it("releases the render canvas when encoded validation fails", async () => {
    const canvas = renderedCanvas();
    mocks.renderCanvas.mockResolvedValueOnce({ canvas, metrics: readyMetrics() });
    mocks.validateBlob.mockRejectedValueOnce(new Error("JOURNAL_EXPORT_DECODE_FAILED"));
    await expect(renderJournalImageBlob(viewModel, "png")).rejects.toThrow("JOURNAL_EXPORT_DECODE_FAILED");
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
  });

  it("fails closed when the logo or any required decoration is unverified", async () => {
    mocks.renderCanvas.mockResolvedValueOnce({
      canvas: renderedCanvas(),
      metrics: readyMetrics({ verifiedVisualElements: 12 }),
    });
    await expect(renderJournalImageBlob(viewModel, "png")).rejects.toThrow("JOURNAL_EXPORT_VISUAL_COMPLETENESS_FAILED");
    expect(mocks.validateBlob).not.toHaveBeenCalled();
  });

  it("fails closed when any required text landmark is missing", async () => {
    mocks.renderCanvas.mockResolvedValueOnce({
      canvas: renderedCanvas(),
      metrics: readyMetrics({ verifiedTextLandmarks: 15 }),
    });
    await expect(renderJournalImageBlob(viewModel, "png")).rejects.toThrow("JOURNAL_EXPORT_TEXT_LANDMARKS_MISSING");
    expect(mocks.validateBlob).not.toHaveBeenCalled();
  });

  it("fails closed on a non-canonical raster size", async () => {
    const canvas = renderedCanvas();
    canvas.width = 1079;
    mocks.renderCanvas.mockResolvedValueOnce({
      canvas,
      metrics: readyMetrics({ width: 1079 }),
    });
    await expect(renderJournalImageBlob(viewModel, "png")).rejects.toThrow("JOURNAL_EXPORT_SIZE_MISMATCH");
  });

  it("serializes overlapping exports while keeping each captured ViewModel isolated", async () => {
    let releaseFirst!: () => void;
    const firstBarrier = new Promise<void>((resolve) => { releaseFirst = resolve; });
    mocks.renderCanvas
      .mockImplementationOnce(async (scene) => {
        await firstBarrier;
        return { canvas: renderedCanvas(), metrics: readyMetrics(), scene };
      })
      .mockResolvedValueOnce({ canvas: renderedCanvas(), metrics: readyMetrics() });
    const first = renderJournalImageBlob({ ...viewModel, entryId: "entry-dust", dogName: "먼지" }, "png");
    const second = renderJournalImageBlob({ ...viewModel, entryId: "entry-autumn", dogName: "가을" }, "png");
    await vi.waitFor(() => expect(mocks.renderCanvas).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([first, second]);
    expect(mocks.renderCanvas).toHaveBeenCalledTimes(2);
    expect(mocks.renderCanvas.mock.calls.map(([scene]) => scene.viewModel.entryId)).toEqual(["entry-dust", "entry-autumn"]);
  });
});
