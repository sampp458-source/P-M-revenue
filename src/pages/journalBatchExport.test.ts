// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildJournalBatchZipFilename,
  buildUniqueJournalPngFilenames,
  createJournalBatchZip,
  downloadJournalBatchZip,
} from "./journalBatchExport";

const readStoredEntries = async (blob: Blob) => {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as ArrayBuffer), { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsArrayBuffer(blob);
  });
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer);
  const entries: Array<{ name: string; data: string }> = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({
      name: new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength)),
      data: new TextDecoder().decode(bytes.slice(dataStart, dataStart + size)),
    });
    offset = dataStart + size;
  }
  return entries;
};

describe("Journal completed PNG batch archive", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:journal-batch") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("uses the selected date and deterministic friendly suffixes for duplicate Dog names", () => {
    expect(buildJournalBatchZipFilename("2026-08-21")).toBe("P&M_하루일지_2026-08-21.zip");
    expect(buildUniqueJournalPngFilenames([
      { dogName: "몽이", businessDate: "2026-08-21" },
      { dogName: "크리미", businessDate: "2026-08-21" },
      { dogName: "몽이", businessDate: "2026-08-21" },
    ])).toEqual([
      "P&M_하루일지_몽이_2026-08-21.png",
      "P&M_하루일지_크리미_2026-08-21.png",
      "P&M_하루일지_몽이_2026-08-21_2.png",
    ]);
  });

  it("creates one flat UTF-8 ZIP entry per PNG in stable input order", async () => {
    const zip = await createJournalBatchZip([
      { filename: "P&M_하루일지_몽이_2026-08-21.png", blob: new Blob(["png-one"], { type: "image/png" }) },
      { filename: "P&M_하루일지_크리미_2026-08-21.png", blob: new Blob(["png-two"], { type: "image/png" }) },
    ]);
    expect(zip.type).toBe("application/zip");
    expect(await readStoredEntries(zip)).toEqual([
      { name: "P&M_하루일지_몽이_2026-08-21.png", data: "png-one" },
      { name: "P&M_하루일지_크리미_2026-08-21.png", data: "png-two" },
    ]);
  });

  it("fails closed for an empty target set and downloads only the completed archive", async () => {
    await expect(createJournalBatchZip([])).rejects.toThrow("JOURNAL_BATCH_EMPTY");
    const result = await downloadJournalBatchZip([
      { filename: "P&M_하루일지_몽이_2026-08-21.png", blob: new Blob(["png"], { type: "image/png" }) },
    ], "2026-08-21");
    expect(result.filename).toBe("P&M_하루일지_2026-08-21.zip");
    expect(result.blob.type).toBe("application/zip");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });
});
