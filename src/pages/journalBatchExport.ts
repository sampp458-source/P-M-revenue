import { buildJournalExportFilename, downloadJournalBlob } from "./journalExport";

export type JournalBatchFile = {
  filename: string;
  blob: Blob;
};

export type JournalBatchArchiveObserver = (event: {
  stage: "ZIP" | "DOWNLOAD";
  state: "START" | "ACK";
  encodedByteSize?: number;
}) => void;

const utf8 = new TextEncoder();
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DOS_DATE_1980_01_01 = 0x0021;

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1);
  }
  return current >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size: number) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

function readBlob(blob: Blob) {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as ArrayBuffer), { once: true });
    reader.addEventListener("error", () => reject(new Error("JOURNAL_BATCH_BLOB_READ_FAILED")), { once: true });
    reader.readAsArrayBuffer(blob);
  });
}

export function buildJournalBatchZipFilename(businessDate: string) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(businessDate) ? businessDate : "날짜미정";
  return `P&M_하루일지_${safeDate}.zip`;
}

export function buildUniqueJournalPngFilenames(
  entries: Array<{ dogName: string; businessDate: string }>,
) {
  const counts = new Map<string, number>();
  return entries.map(({ dogName, businessDate }) => {
    const filename = buildJournalExportFilename(dogName, businessDate, "png");
    const count = (counts.get(filename) ?? 0) + 1;
    counts.set(filename, count);
    if (count === 1) return filename;
    return `${filename.slice(0, -4)}_${count}.png`;
  });
}

export async function createJournalBatchZip(files: JournalBatchFile[]) {
  if (!files.length) throw new Error("JOURNAL_BATCH_EMPTY");
  const localParts: BlobPart[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = utf8.encode(file.filename.normalize("NFC"));
    const data = new Uint8Array(await readBlob(file.blob));
    if (name.byteLength > 0xffff || data.byteLength > 0xffffffff) {
      throw new Error("JOURNAL_BATCH_ZIP_LIMIT_EXCEEDED");
    }
    const checksum = crc32(data);
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, ZIP_UTF8_FLAG, true);
    local.view.setUint16(8, ZIP_STORE_METHOD, true);
    local.view.setUint16(10, 0, true);
    local.view.setUint16(12, ZIP_DOS_DATE_1980_01_01, true);
    local.view.setUint32(14, checksum, true);
    local.view.setUint32(18, data.byteLength, true);
    local.view.setUint32(22, data.byteLength, true);
    local.view.setUint16(26, name.byteLength, true);
    local.view.setUint16(28, 0, true);
    // Retain the original Blob as the ZIP payload. The temporary Uint8Array is
    // needed only for CRC calculation and is released before the next entry.
    localParts.push(local.bytes, name, file.blob);

    const central = header(46);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, ZIP_UTF8_FLAG, true);
    central.view.setUint16(10, ZIP_STORE_METHOD, true);
    central.view.setUint16(12, 0, true);
    central.view.setUint16(14, ZIP_DOS_DATE_1980_01_01, true);
    central.view.setUint32(16, checksum, true);
    central.view.setUint32(20, data.byteLength, true);
    central.view.setUint32(24, data.byteLength, true);
    central.view.setUint16(28, name.byteLength, true);
    central.view.setUint16(30, 0, true);
    central.view.setUint16(32, 0, true);
    central.view.setUint16(34, 0, true);
    central.view.setUint16(36, 0, true);
    central.view.setUint32(38, 0, true);
    central.view.setUint32(42, offset, true);
    centralParts.push(central.bytes, name);
    offset += local.bytes.byteLength + name.byteLength + data.byteLength;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(4, 0, true);
  end.view.setUint16(6, 0, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);
  end.view.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, end.bytes], { type: "application/zip" });
}

export async function downloadJournalBatchZip(
  files: JournalBatchFile[],
  businessDate: string,
  onStage?: JournalBatchArchiveObserver,
) {
  onStage?.({ stage: "ZIP", state: "START" });
  const blob = await createJournalBatchZip(files);
  onStage?.({ stage: "ZIP", state: "ACK", encodedByteSize: blob.size });
  const filename = buildJournalBatchZipFilename(businessDate);
  onStage?.({ stage: "DOWNLOAD", state: "START", encodedByteSize: blob.size });
  downloadJournalBlob(blob, filename);
  onStage?.({ stage: "DOWNLOAD", state: "ACK", encodedByteSize: blob.size });
  return { blob, filename };
}
