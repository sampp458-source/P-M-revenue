import { useEffect, useSyncExternalStore } from "react";
import {
  JOURNAL_REPORT_FONT_FAMILY,
  JOURNAL_TEACHER_COMMENT_FONT_SIZES,
  type JournalTeacherCommentFontSize,
} from "./journalReportScene";

export const JOURNAL_CUSTOM_FONT_MAX_FILE_SIZE = 20 * 1024 * 1024;
export const JOURNAL_CUSTOM_FONT_MAX_COUNT = 5;
export const JOURNAL_CUSTOM_FONT_ACCEPT = ".ttf,.otf,.woff,.woff2";

const DATABASE_NAME = "pnm-journal-local-preferences";
const DATABASE_VERSION = 1;
const FONT_STORE = "teacher-comment-fonts";
const PREFERENCE_STORE = "preferences";
const ACTIVE_FONT_KEY = "active-teacher-comment-font";
const ACTIVE_SOURCE_KEY = "active-teacher-comment-font-source";
const ACTIVE_SYSTEM_FONT_KEY = "active-teacher-comment-system-font";
const FONT_SIZE_KEY = "teacher-comment-font-size";
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
export type JournalTeacherCommentFontSource = "DEFAULT" | "FILE" | "SYSTEM";
export type JournalSystemFontMetadata = {
  postscriptName: string;
  fullName: string;
  family: string;
  style: string;
};
type LocalFontData = JournalSystemFontMetadata & { blob: () => Promise<Blob> };
export type JournalCustomFontSnapshot = {
  status: JournalCustomFontStatus;
  fonts: JournalCustomFontMetadata[];
  activeFontId: string | null;
  activeFontFamily: string;
  activeSource: JournalTeacherCommentFontSource;
  activeSystemFont: JournalSystemFontMetadata | null;
  systemFonts: JournalSystemFontMetadata[];
  systemFontStatus: "unsupported" | "idle" | "loading" | "ready" | "denied" | "missing" | "reconnect-required";
  fontSize: JournalTeacherCommentFontSize;
  error: string;
};

const defaultSnapshot: JournalCustomFontSnapshot = {
  status: "loading",
  fonts: [],
  activeFontId: null,
  activeFontFamily: JOURNAL_REPORT_FONT_FAMILY,
  activeSource: "DEFAULT",
  activeSystemFont: null,
  systemFonts: [],
  systemFontStatus: "idle",
  fontSize: 20,
  error: "",
};

let snapshot = defaultSnapshot;
let initialization: Promise<void> | null = null;
const listeners = new Set<() => void>();
const loadedFaces = new Map<string, FontFace>();
const availableSystemFontData = new Map<string, LocalFontData>();
let loadedSystemFace: FontFace | null = null;

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
    const preferences = transaction.objectStore(PREFERENCE_STORE);
    const activeFontRequest = preferences.get(ACTIVE_FONT_KEY);
    const activeSourceRequest = preferences.get(ACTIVE_SOURCE_KEY);
    const activeSystemFontRequest = preferences.get(ACTIVE_SYSTEM_FONT_KEY);
    const fontSizeRequest = preferences.get(FONT_SIZE_KEY);
    const [records, activeFontId, activeSource, activeSystemFont, fontSize] = await Promise.all([
      requestResult(recordsRequest) as Promise<JournalCustomFontRecord[]>,
      requestResult(activeFontRequest) as Promise<string | undefined>,
      requestResult(activeSourceRequest) as Promise<JournalTeacherCommentFontSource | undefined>,
      requestResult(activeSystemFontRequest) as Promise<JournalSystemFontMetadata | undefined>,
      requestResult(fontSizeRequest) as Promise<JournalTeacherCommentFontSize | undefined>,
    ]);
    return { records, activeFontId: activeFontId ?? null, activeSource, activeSystemFont: activeSystemFont ?? null, fontSize };
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

async function writePreference(key: string, value: unknown | null) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PREFERENCE_STORE, "readwrite");
    const store = transaction.objectStore(PREFERENCE_STORE);
    if (value === null) await requestResult(store.delete(key));
    else await requestResult(store.put(value, key));
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

export function assertJournalCustomFontBasicMetrics(family: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("폰트 표시 안전성을 확인할 수 없습니다.");
  context.font = `400 20px ${journalTeacherCommentFontFamily(family)}`;
  const metrics = context.measureText("한글 ABC 123 ♡ 👏");
  canvas.width = 1;
  canvas.height = 1;
  if (!Number.isFinite(metrics.width) || metrics.width <= 0) throw new Error("이 글꼴의 기본 표시 정보를 확인할 수 없습니다.");
}

async function loadRecord(record: JournalCustomFontRecord) {
  const existing = loadedFaces.get(record.id);
  if (existing?.status === "loaded") return existing;
  const data = await record.data.arrayBuffer();
  const face = new FontFace(record.family, data, { style: "normal", weight: "400" });
  const loaded = await face.load();
  document.fonts.add(loaded);
  try {
    if (!document.fonts.check(`20px "${record.family}"`, "한글 ABC 123 ♡")) {
      throw new Error("선택한 폰트에서 한글을 불러올 수 없습니다.");
    }
    assertJournalCustomFontKoreanGlyphs(record.family);
    assertJournalCustomFontBasicMetrics(record.family);
  } catch (caught) {
    document.fonts.delete(loaded);
    throw caught;
  }
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
      const { records, activeFontId, activeSource, activeSystemFont, fontSize } = await readStoredState();
      const sorted = records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const source: JournalTeacherCommentFontSource = activeSource === "SYSTEM" && activeSystemFont ? "SYSTEM" : activeSource === "FILE" || activeFontId ? "FILE" : "DEFAULT";
      let active = source === "FILE" ? sorted.find((record) => record.id === activeFontId) ?? null : null;
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
        activeSource: source === "SYSTEM" ? "SYSTEM" : active ? "FILE" : "DEFAULT",
        activeSystemFont: source === "SYSTEM" ? activeSystemFont : null,
        systemFonts: [],
        systemFontStatus: source === "SYSTEM" ? "reconnect-required" : typeof window !== "undefined" && "queryLocalFonts" in window ? "idle" : "unsupported",
        fontSize: JOURNAL_TEACHER_COMMENT_FONT_SIZES.includes(fontSize as JournalTeacherCommentFontSize) ? fontSize as JournalTeacherCommentFontSize : 20,
        error,
      });
      if (activeFontId && !active) await writeActiveFontId(null);
    } catch {
      emit({ ...defaultSnapshot, status: "ready", systemFontStatus: typeof window !== "undefined" && "queryLocalFonts" in window ? "idle" : "unsupported", error: "저장된 폰트를 불러오지 못해 기본 폰트를 사용합니다." });
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
  await writePreference(ACTIVE_SOURCE_KEY, "FILE");
  await writePreference(ACTIVE_SYSTEM_FONT_KEY, null);
  emit({ ...snapshot, status: "ready", fonts: [...snapshot.fonts, metadata], activeFontId: record.id, activeFontFamily: journalTeacherCommentFontFamily(record.family), activeSource: "FILE", activeSystemFont: null, error: "" });
  return metadata;
}

export async function selectJournalCustomFont(id: string | null) {
  await initializeJournalCustomFonts();
  if (!id) {
    await writeActiveFontId(null);
    await writePreference(ACTIVE_SOURCE_KEY, "DEFAULT");
    await writePreference(ACTIVE_SYSTEM_FONT_KEY, null);
    emit({ ...snapshot, activeFontId: null, activeFontFamily: JOURNAL_REPORT_FONT_FAMILY, activeSource: "DEFAULT", activeSystemFont: null, error: "" });
    return;
  }
  const { records } = await readStoredState();
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new Error("선택한 폰트를 찾을 수 없습니다.");
  await loadRecord(record);
  await writeActiveFontId(id);
  await writePreference(ACTIVE_SOURCE_KEY, "FILE");
  await writePreference(ACTIVE_SYSTEM_FONT_KEY, null);
  emit({ ...snapshot, activeFontId: id, activeFontFamily: journalTeacherCommentFontFamily(record.family), activeSource: "FILE", activeSystemFont: null, error: "" });
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
    activeSource: wasActive ? "DEFAULT" : snapshot.activeSource,
    activeSystemFont: wasActive ? null : snapshot.activeSystemFont,
    error: "",
  });
  if (wasActive) await writePreference(ACTIVE_SOURCE_KEY, "DEFAULT");
}

function localFontQuery() {
  return (window as Window & { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
}

export function matchJournalSystemFontDescriptor(
  descriptor: JournalSystemFontMetadata,
  candidates: JournalSystemFontMetadata[],
) {
  return candidates.find((candidate) => candidate.postscriptName === descriptor.postscriptName)
    ?? candidates.find((candidate) => (
      candidate.fullName === descriptor.fullName
      && candidate.family === descriptor.family
      && candidate.style === descriptor.style
    ))
    ?? null;
}

export async function connectJournalSystemFonts() {
  await initializeJournalCustomFonts();
  const query = localFontQuery();
  if (!query) {
    emit({ ...snapshot, systemFontStatus: "unsupported", error: "이 브라우저에서는 컴퓨터 글꼴 연결을 지원하지 않습니다." });
    return [];
  }
  emit({ ...snapshot, systemFontStatus: "loading", error: "" });
  try {
    const records = await query.call(window);
    availableSystemFontData.clear();
    records.forEach((record) => availableSystemFontData.set(record.postscriptName, record));
    const fonts = records.map(({ postscriptName, fullName, family, style }) => ({ postscriptName, fullName, family, style }))
      .sort((left, right) => {
        const familyOrder = left.family.localeCompare(right.family, "ko");
        if (familyOrder) return familyOrder;
        const regularRank = (style: string) => /^(regular|normal|book)$/i.test(style.trim()) ? 0 : 1;
        return regularRank(left.style) - regularRank(right.style) || left.fullName.localeCompare(right.fullName, "ko");
      });
    emit({ ...snapshot, systemFonts: fonts, systemFontStatus: "ready", error: "" });
    return fonts;
  } catch (caught) {
    const denied = caught instanceof DOMException && (caught.name === "NotAllowedError" || caught.name === "SecurityError");
    emit({ ...snapshot, systemFonts: [], systemFontStatus: denied ? "denied" : "idle", error: denied ? "컴퓨터 글꼴 접근이 허용되지 않았습니다. 브라우저 권한을 확인해 주세요." : "컴퓨터 글꼴 목록을 불러오지 못했습니다." });
    return [];
  }
}

export async function selectJournalSystemFont(postscriptName: string) {
  await initializeJournalCustomFonts();
  const record = availableSystemFontData.get(postscriptName);
  if (!record) throw new Error("컴퓨터 글꼴을 다시 연결한 뒤 선택해 주세요.");
  const blob = await record.blob();
  const data = await blob.arrayBuffer();
  const hash = await sha256(data);
  const family = `pnm-journal-system-font-${hash.slice(0, 20)}`;
  const face = await new FontFace(family, data, { style: "normal", weight: "400" }).load();
  document.fonts.add(face);
  try {
    assertJournalCustomFontKoreanGlyphs(family);
    assertJournalCustomFontBasicMetrics(family);
  } catch (caught) {
    document.fonts.delete(face);
    throw caught;
  }
  if (loadedSystemFace) document.fonts.delete(loadedSystemFace);
  loadedSystemFace = face;
  const metadata: JournalSystemFontMetadata = { postscriptName: record.postscriptName, fullName: record.fullName, family: record.family, style: record.style };
  await writeActiveFontId(null);
  await writePreference(ACTIVE_SOURCE_KEY, "SYSTEM");
  await writePreference(ACTIVE_SYSTEM_FONT_KEY, metadata);
  emit({ ...snapshot, activeFontId: null, activeFontFamily: journalTeacherCommentFontFamily(family), activeSource: "SYSTEM", activeSystemFont: metadata, systemFontStatus: "ready", error: "" });
}

export async function reconnectActiveJournalSystemFont() {
  await initializeJournalCustomFonts();
  const descriptor = snapshot.activeSource === "SYSTEM" ? snapshot.activeSystemFont : null;
  if (!descriptor) throw new Error("다시 연결할 컴퓨터 글꼴 정보가 없습니다. 다른 글꼴을 선택해 주세요.");
  const fonts = await connectJournalSystemFonts();
  if (snapshot.systemFontStatus !== "ready") {
    throw new Error(snapshot.error || "컴퓨터 글꼴을 다시 연결하지 못했습니다.");
  }
  const match = matchJournalSystemFontDescriptor(descriptor, fonts);
  if (!match) {
    emit({
      ...snapshot,
      systemFontStatus: "missing",
      error: "이전에 사용한 컴퓨터 글꼴을 찾을 수 없습니다. 다른 글꼴이나 기본 글꼴을 선택해 주세요.",
    });
    throw new Error("이전에 사용한 컴퓨터 글꼴을 찾을 수 없습니다. 다른 글꼴이나 기본 글꼴을 선택해 주세요.");
  }
  await selectJournalSystemFont(match.postscriptName);
  return match;
}

export async function selectJournalTeacherCommentFontSize(fontSize: JournalTeacherCommentFontSize) {
  if (!JOURNAL_TEACHER_COMMENT_FONT_SIZES.includes(fontSize)) throw new Error("지원하지 않는 글자 크기입니다.");
  await initializeJournalCustomFonts();
  await writePreference(FONT_SIZE_KEY, fontSize);
  emit({ ...snapshot, fontSize, error: "" });
}

export type JournalTeacherCommentPresentation = {
  fontFamily: string;
  fontSize: JournalTeacherCommentFontSize;
};

export async function ensureActiveJournalTeacherCommentPresentation(): Promise<JournalTeacherCommentPresentation> {
  await initializeJournalCustomFonts();
  if (snapshot.activeSource === "SYSTEM") {
    if (snapshot.systemFontStatus !== "ready" || !loadedSystemFace) throw new Error("JOURNAL_SYSTEM_FONT_RECONNECT_REQUIRED");
    return { fontFamily: snapshot.activeFontFamily, fontSize: snapshot.fontSize };
  }
  if (!snapshot.activeFontId) return { fontFamily: JOURNAL_REPORT_FONT_FAMILY, fontSize: snapshot.fontSize };
  const { records } = await readStoredState();
  const record = records.find((candidate) => candidate.id === snapshot.activeFontId);
  if (!record) throw new Error("JOURNAL_CUSTOM_FONT_NOT_READY");
  try {
    await loadRecord(record);
    return { fontFamily: journalTeacherCommentFontFamily(record.family), fontSize: snapshot.fontSize };
  } catch {
    throw new Error("JOURNAL_CUSTOM_FONT_NOT_READY");
  }
}

export async function ensureActiveJournalTeacherCommentFont() {
  return (await ensureActiveJournalTeacherCommentPresentation()).fontFamily;
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
