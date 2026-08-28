import { useEffect, useSyncExternalStore } from "react";
import {
  JOURNAL_REPORT_FONT_FAMILY,
  JOURNAL_TEACHER_COMMENT_FIXED_TYPOGRAPHY,
} from "./journalReportScene";

export const JOURNAL_CUSTOM_FONT_MAX_FILE_SIZE = 20 * 1024 * 1024;
export const JOURNAL_CUSTOM_FONT_MAX_COUNT = 5;
export const JOURNAL_CUSTOM_FONT_ACCEPT = ".ttf,.otf,.woff,.woff2";

const DATABASE_NAME = "pnm-journal-local-preferences";
const DATABASE_VERSION = 1;
const FONT_STORE = "teacher-comment-fonts";
const PREFERENCE_STORE = "preferences";
const ACTIVE_FONT_KEY = "active-teacher-comment-font";
const SUPPORTED_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);
const SUPPORTED_MIME_TYPES = new Set([
  "",
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/font-sfnt",
  "application/font-woff",
  "application/x-font-ttf",
  "application/x-font-opentype",
  "application/octet-stream",
]);

export type JournalCustomFontMetadata = {
  id: string;
  displayName: string;
  family: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
};

type JournalCustomFontRecord = JournalCustomFontMetadata & { data: Blob };
type JournalCustomFontStatus = "loading" | "ready" | "unsupported";
type JournalCustomFontSnapshot = {
  status: JournalCustomFontStatus;
  fonts: JournalCustomFontMetadata[];
  activeFontId: string | null;
  activeFontFamily: string;
  error: string;
};

const defaultSnapshot: JournalCustomFontSnapshot = {
  status: "loading",
  fonts: [],
  activeFontId: null,
  activeFontFamily: JOURNAL_REPORT_FONT_FAMILY,
  error: "",
};

let snapshot = defaultSnapshot;
let initialization: Promise<void> | null = null;
const listeners = new Set<() => void>();
const loadedFaces = new Map<string, FontFace>();

function emit(next: JournalCustomFontSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FONT_STORE)) database.createObjectStore(FONT_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(PREFERENCE_STORE)) database.createObjectStore(PREFERENCE_STORE);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("JOURNAL_CUSTOM_FONT_STORAGE_OPEN_FAILED")));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("JOURNAL_CUSTOM_FONT_STORAGE_REQUEST_FAILED")));
  });
}

async function readStoredState() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([FONT_STORE, PREFERENCE_STORE], "readonly");
    const recordsRequest = transaction.objectStore(FONT_STORE).getAll();
    const activeFontRequest = transaction.objectStore(PREFERENCE_STORE).get(ACTIVE_FONT_KEY);
    const [records, activeFontId] = await Promise.all([
      requestResult(recordsRequest) as Promise<JournalCustomFontRecord[]>,
      requestResult(activeFontRequest) as Promise<string | undefined>,
    ]);
    return { records, activeFontId: activeFontId ?? null };
  } finally {
    database.close();
  }
}

async function writeFont(record: JournalCustomFontRecord) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(FONT_STORE, "readwrite");
    await requestResult(transaction.objectStore(FONT_STORE).put(record));
  } finally {
    database.close();
  }
}

async function writeActiveFontId(activeFontId: string | null) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PREFERENCE_STORE, "readwrite");
    const store = transaction.objectStore(PREFERENCE_STORE);
    if (activeFontId) await requestResult(store.put(activeFontId, ACTIVE_FONT_KEY));
    else await requestResult(store.delete(ACTIVE_FONT_KEY));
  } finally {
    database.close();
  }
}

async function removeStoredFont(id: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(FONT_STORE, "readwrite");
    await requestResult(transaction.objectStore(FONT_STORE).delete(id));
  } finally {
    database.close();
  }
}

export function journalCustomFontDisplayName(value: string) {
  return value
    .replace(/\.(ttf|otf|woff2?)$/i, "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "사용자 글꼴";
}

function fontMetadata(record: JournalCustomFontRecord): JournalCustomFontMetadata {
  return {
    id: record.id,
    displayName: record.displayName,
    family: record.family,
    fileName: record.fileName,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    createdAt: record.createdAt,
  };
}

export function validateJournalCustomFontFile(file: Pick<File, "name" | "type" | "size">) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!SUPPORTED_EXTENSIONS.has(extension) || !SUPPORTED_MIME_TYPES.has(file.type.toLowerCase())) {
    throw new Error("지원하는 폰트 파일(.ttf, .otf, .woff, .woff2)을 선택해 주세요.");
  }
  if (file.size <= 0 || file.size > JOURNAL_CUSTOM_FONT_MAX_FILE_SIZE) {
    throw new Error("폰트 파일은 20MB 이하만 등록할 수 있습니다.");
  }
}

async function sha256(value: ArrayBuffer) {
  if (!crypto.subtle) throw new Error("이 브라우저에서는 안전한 폰트 식별을 사용할 수 없습니다.");
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function journalCustomFontInternalFamily(hash: string) {
  return `pnm-journal-user-font-${hash.slice(0, 20)}`;
}

export function journalTeacherCommentFontFamily(family?: string | null) {
  return family ? `"${family}", ${JOURNAL_REPORT_FONT_FAMILY}` : JOURNAL_REPORT_FONT_FAMILY;
}

export function journalCustomFontPreviewFamily(id: string) {
  const font = snapshot.fonts.find((candidate) => candidate.id === id);
  return font && loadedFaces.get(id)?.status === "loaded" ? journalTeacherCommentFontFamily(font.family) : undefined;
}

function wrapLineCount(context: CanvasRenderingContext2D, value: string, width: number) {
  let count = 0;
  value.replaceAll("\r\n", "\n").split("\n").forEach((paragraph) => {
    let current = "";
    Array.from(paragraph).forEach((character) => {
      const next = current + character;
      if (current && context.measureText(next).width > width) { count += 1; current = character; }
      else current = next;
    });
    if (current || paragraph === "") count += 1;
  });
  return count;
}

function textFingerprint(fontFamily: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 420;
  canvas.height = 80;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("폰트 한글 표시를 확인할 수 없습니다.");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  context.font = `400 40px ${fontFamily}`;
  context.fillText("한글가나다라마바사", 4, 54);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let signature = 2166136261;
  for (let index = 3; index < data.length; index += 4) {
    signature ^= data[index];
    signature = Math.imul(signature, 16777619);
  }
  canvas.width = 1;
  canvas.height = 1;
  return signature >>> 0;
}

function assertJournalCustomFontKoreanGlyphs(family: string) {
  const fallback = textFingerprint(JOURNAL_REPORT_FONT_FAMILY);
  const custom = textFingerprint(journalTeacherCommentFontFamily(family));
  if (custom === fallback) throw new Error("한글 글리프가 포함된 폰트 파일을 선택해 주세요.");
}

export function assertJournalCustomFontGeometry(family: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("폰트 표시 안전성을 확인할 수 없습니다.");
  const typography = JOURNAL_TEACHER_COMMENT_FIXED_TYPOGRAPHY;
  const safetyFixture = Array.from({ length: 500 }, (_, index) => index % 5 < 3 ? "가" : " ").join("");
  const maxLines = Math.floor(typography.availableHeight / (typography.size * typography.lineHeight));
  context.font = `400 ${typography.size}px ${JOURNAL_REPORT_FONT_FAMILY}`;
  const defaultLines = wrapLineCount(context, safetyFixture, typography.textWidth);
  context.font = `400 ${typography.size}px ${journalTeacherCommentFontFamily(family)}`;
  const customLines = wrapLineCount(context, safetyFixture, typography.textWidth);
  const metrics = context.measureText("한글 ABC 123 ♡ 👏");
  canvas.width = 1;
  canvas.height = 1;
  if (!Number.isFinite(metrics.width) || metrics.width <= 0 || customLines > maxLines || customLines > defaultLines) {
    throw new Error("이 글꼴은 선생님의 한마디 500자를 현재 일지 영역에 안전하게 표시할 수 없어 등록할 수 없습니다.");
  }
}

async function loadRecord(record: JournalCustomFontRecord) {
  const existing = loadedFaces.get(record.id);
  if (existing?.status === "loaded") return existing;
  const data = await record.data.arrayBuffer();
  const face = new FontFace(record.family, data, { style: "normal", weight: "400" });
  const loaded = await face.load();
  document.fonts.add(loaded);
  if (!document.fonts.check(`20px "${record.family}"`, "한글 ABC 123 ♡")) {
    document.fonts.delete(loaded);
    throw new Error("선택한 폰트에서 한글을 불러올 수 없습니다.");
  }
  assertJournalCustomFontKoreanGlyphs(record.family);
  assertJournalCustomFontGeometry(record.family);
  loadedFaces.set(record.id, loaded);
  return loaded;
}

function supported() {
  return typeof indexedDB !== "undefined" && typeof FontFace !== "undefined" && Boolean(document.fonts) && Boolean(crypto.subtle);
}

export async function initializeJournalCustomFonts() {
  if (initialization) return initialization;
  initialization = (async () => {
    if (!supported()) {
      emit({ ...defaultSnapshot, status: "unsupported", error: "이 브라우저에서는 로컬 폰트를 사용할 수 없습니다." });
      return;
    }
    try {
      const { records, activeFontId } = await readStoredState();
      const sorted = records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      let active = sorted.find((record) => record.id === activeFontId) ?? null;
      let error = activeFontId && !active ? "저장된 폰트를 찾지 못해 기본 폰트를 사용합니다." : "";
      if (active) {
        try { await loadRecord(active); }
        catch { active = null; error = "저장된 폰트를 불러오지 못해 기본 폰트를 사용합니다."; }
      }
      emit({
        status: "ready",
        fonts: sorted.map(fontMetadata),
        activeFontId: active?.id ?? null,
        activeFontFamily: journalTeacherCommentFontFamily(active?.family),
        error,
      });
      if (activeFontId && !active) await writeActiveFontId(null);
    } catch {
      emit({ ...defaultSnapshot, status: "ready", error: "저장된 폰트를 불러오지 못해 기본 폰트를 사용합니다." });
    }
  })();
  return initialization;
}

export async function addJournalCustomFont(file: File) {
  await initializeJournalCustomFonts();
  if (snapshot.status === "unsupported") throw new Error(snapshot.error);
  validateJournalCustomFontFile(file);
  const data = await file.arrayBuffer();
  const hash = await sha256(data);
  const id = `sha256-${hash}`;
  const existing = snapshot.fonts.find((font) => font.id === id);
  if (existing) {
    await selectJournalCustomFont(existing.id);
    return existing;
  }
  if (snapshot.fonts.length >= JOURNAL_CUSTOM_FONT_MAX_COUNT) throw new Error(`사용자 폰트는 최대 ${JOURNAL_CUSTOM_FONT_MAX_COUNT}개까지 등록할 수 있습니다.`);
  const record: JournalCustomFontRecord = {
    id,
    displayName: journalCustomFontDisplayName(file.name),
    family: journalCustomFontInternalFamily(hash),
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
    createdAt: new Date().toISOString(),
    data: new Blob([data], { type: file.type || "application/octet-stream" }),
  };
  try {
    await loadRecord(record);
  } catch (caught) {
    if (caught instanceof Error && (
      caught.message.includes("한글 글리프")
      || caught.message.includes("500자를 현재 일지 영역")
      || caught.message.includes("한글을 불러올 수 없습니다")
    )) throw caught;
    throw new Error("글꼴 파일을 브라우저에서 읽을 수 없습니다. 손상되었거나 지원되지 않는 글꼴인지 확인해 주세요.");
  }
  await writeFont(record);
  await writeActiveFontId(record.id);
  const metadata = fontMetadata(record);
  emit({ status: "ready", fonts: [...snapshot.fonts, metadata], activeFontId: record.id, activeFontFamily: journalTeacherCommentFontFamily(record.family), error: "" });
  return metadata;
}

export async function selectJournalCustomFont(id: string | null) {
  await initializeJournalCustomFonts();
  if (!id) {
    await writeActiveFontId(null);
    emit({ ...snapshot, activeFontId: null, activeFontFamily: JOURNAL_REPORT_FONT_FAMILY, error: "" });
    return;
  }
  const { records } = await readStoredState();
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new Error("선택한 폰트를 찾을 수 없습니다.");
  await loadRecord(record);
  await writeActiveFontId(id);
  emit({ ...snapshot, activeFontId: id, activeFontFamily: journalTeacherCommentFontFamily(record.family), error: "" });
}

export async function deleteJournalCustomFont(id: string) {
  await initializeJournalCustomFonts();
  const face = loadedFaces.get(id);
  if (face) { document.fonts.delete(face); loadedFaces.delete(id); }
  await removeStoredFont(id);
  const wasActive = snapshot.activeFontId === id;
  if (wasActive) await writeActiveFontId(null);
  emit({
    ...snapshot,
    fonts: snapshot.fonts.filter((font) => font.id !== id),
    activeFontId: wasActive ? null : snapshot.activeFontId,
    activeFontFamily: wasActive ? JOURNAL_REPORT_FONT_FAMILY : snapshot.activeFontFamily,
    error: "",
  });
}

export async function ensureActiveJournalTeacherCommentFont() {
  await initializeJournalCustomFonts();
  if (!snapshot.activeFontId) return JOURNAL_REPORT_FONT_FAMILY;
  const { records } = await readStoredState();
  const record = records.find((candidate) => candidate.id === snapshot.activeFontId);
  if (!record) throw new Error("JOURNAL_CUSTOM_FONT_NOT_READY");
  try {
    await loadRecord(record);
    return journalTeacherCommentFontFamily(record.family);
  } catch {
    throw new Error("JOURNAL_CUSTOM_FONT_NOT_READY");
  }
}

export function useJournalCustomFontPreference() {
  const value = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => snapshot,
    () => defaultSnapshot,
  );
  useEffect(() => { void initializeJournalCustomFonts(); }, []);
  return value;
}
