// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { JOURNAL_REQUIRED_ASSET_IDS } from "./journalRenderContract";

describe("Journal embedded export asset sources", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("prepares all seven approved illustrations and the official logo once per asset version", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { loadEmbeddedJournalAssetSources } = await import("./journalAssetSources");

    const cold = await loadEmbeddedJournalAssetSources();
    const warm = await loadEmbeddedJournalAssetSources();
    expect(warm).toBe(cold);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(JOURNAL_REQUIRED_ASSET_IDS.every((id) => cold[id].startsWith("data:image/png"))).toBe(true);
    expect(cold["official-logo"].startsWith("data:image/png")).toBe(true);
  });

  it("fails closed without caching a failed fetch or an invalid MIME type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    const { loadEmbeddedJournalAssetSources } = await import("./journalAssetSources");

    await expect(loadEmbeddedJournalAssetSources()).rejects.toThrow("JOURNAL_EXPORT_ASSET_FETCH_FAILED");
    fetchMock.mockImplementation(() => Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(["bad"], { type: "image/jpeg" })),
    }));
    await expect(loadEmbeddedJournalAssetSources()).rejects.toThrow("JOURNAL_EXPORT_ASSET_MIME_INVALID");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(8);
  });
});
