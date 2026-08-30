import { canonicalJournalTeacherComment } from "./journalTextNormalization";
import type { JournalDraft, JournalStatus } from "./journalRepository";

const DATABASE_NAME = "pnm-journal-conflict-recovery-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "conflicts";
const MAX_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type JournalConflictClassification = "SELF_ORIGINATED_WITH_LOCAL_PENDING" | "TRUE_EXTERNAL_CONFLICT";

export interface JournalConflictBufferRecord {
  entryId: string;
  baseVersion: number;
  latestServerVersion: number;
  baseStatus: JournalStatus;
  localStatus: JournalStatus;
  latestServerStatus: JournalStatus;
  latestServerCaptured: boolean;
  baseSnapshot: JournalDraft;
  localDraft: JournalDraft;
  latestServerSnapshot: JournalDraft;
  timestamp: string;
  classification: JournalConflictClassification;
}

const cloneDraft = (draft: JournalDraft): JournalDraft => ({
  ...draft,
  conditionCodes: [...draft.conditionCodes],
  mealCodes: [...draft.mealCodes],
  bestFriendTargets: draft.bestFriendTargets?.map((target) => ({ ...target })),
  teacherComment: canonicalJournalTeacherComment(draft.teacherComment),
});

export function createJournalConflictBufferRecord(input: JournalConflictBufferRecord): JournalConflictBufferRecord {
  return {
    ...input,
    baseSnapshot: cloneDraft(input.baseSnapshot),
    localDraft: cloneDraft(input.localDraft),
    latestServerSnapshot: cloneDraft(input.latestServerSnapshot),
  };
}

export function isJournalConflictBufferExpired(record: JournalConflictBufferRecord, now = Date.now()) {
  const timestamp = Date.parse(record.timestamp);
  return !Number.isFinite(timestamp) || now - timestamp > MAX_RETENTION_MS;
}

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.addEventListener("success", () => resolve(request.result));
  request.addEventListener("error", () => reject(request.error ?? new Error("JOURNAL_CONFLICT_BUFFER_REQUEST_FAILED")));
});

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === "undefined") {
    reject(new Error("JOURNAL_CONFLICT_BUFFER_UNAVAILABLE"));
    return;
  }
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "entryId" });
  });
  request.addEventListener("success", () => resolve(request.result));
  request.addEventListener("error", () => reject(request.error ?? new Error("JOURNAL_CONFLICT_BUFFER_OPEN_FAILED")));
});

const pruneExpiredBuffers = async (database: IDBDatabase, now = Date.now()) => {
  const readTransaction = database.transaction(STORE_NAME, "readonly");
  const records = await requestResult(readTransaction.objectStore(STORE_NAME).getAll()) as JournalConflictBufferRecord[];
  const expired = records.filter((record) => isJournalConflictBufferExpired(record, now));
  if (!expired.length) return;
  const writeTransaction = database.transaction(STORE_NAME, "readwrite");
  const store = writeTransaction.objectStore(STORE_NAME);
  await Promise.all(expired.map((record) => requestResult(store.delete(record.entryId))));
};

export async function saveJournalConflictBuffer(record: JournalConflictBufferRecord) {
  const database = await openDatabase();
  try {
    await pruneExpiredBuffers(database);
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).put(createJournalConflictBufferRecord(record)));
  } finally {
    database.close();
  }
}

export async function loadJournalConflictBuffer(entryId: string) {
  const database = await openDatabase();
  try {
    await pruneExpiredBuffers(database);
    const transaction = database.transaction(STORE_NAME, "readonly");
    const record = await requestResult(transaction.objectStore(STORE_NAME).get(entryId)) as JournalConflictBufferRecord | undefined;
    if (!record) return null;
    return createJournalConflictBufferRecord(record);
  } finally {
    database.close();
  }
}

export async function deleteJournalConflictBuffer(entryId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).delete(entryId));
  } finally {
    database.close();
  }
}

const draftFields: Array<keyof JournalDraft> = [
  "conditionCodes", "urination", "defecation", "stoolCondition", "mealCodes",
  "teacherRelationship", "friendRelationship", "bestFriendTargets", "bestFriendDogId",
  "mannersActivityName", "mannersEvaluation", "physicalActivityName", "physicalEvaluation", "teacherComment",
];

const comparable = (field: keyof JournalDraft, value: JournalDraft[keyof JournalDraft]) => {
  if (field === "teacherComment") return canonicalJournalTeacherComment(String(value ?? ""));
  return JSON.stringify(value ?? null);
};

export function analyzeJournalThreeWayMerge(
  base: JournalDraft,
  local: JournalDraft,
  server: JournalDraft,
  statuses?: { base: JournalStatus; local: JournalStatus; server: JournalStatus },
) {
  const merged = cloneDraft(server);
  const conflictFields: Array<keyof JournalDraft> = [];
  const locallyChangedFields: Array<keyof JournalDraft> = [];
  const serverChangedFields: Array<keyof JournalDraft> = [];
  draftFields.forEach((field) => {
    const baseValue = comparable(field, base[field]);
    const localValue = comparable(field, local[field]);
    const serverValue = comparable(field, server[field]);
    const localChanged = localValue !== baseValue;
    const serverChanged = serverValue !== baseValue;
    if (localChanged) locallyChangedFields.push(field);
    if (serverChanged) serverChangedFields.push(field);
    if (localChanged && serverChanged && localValue !== serverValue) {
      conflictFields.push(field);
      return;
    }
    if (localChanged) Object.assign(merged, { [field]: cloneDraft(local)[field] });
  });
  const statusConflict = Boolean(
    statuses
    && statuses.server !== statuses.base
    && (statuses.local !== statuses.base || locallyChangedFields.length > 0),
  );
  return { mergedCandidate: merged, conflictFields, locallyChangedFields, serverChangedFields, statusConflict };
}
