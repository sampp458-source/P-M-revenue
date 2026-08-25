export type JournalPersistenceFailureKind =
  | "VERSION_CONFLICT"
  | "PERMISSION"
  | "TIMEOUT"
  | "ABORT"
  | "NETWORK"
  | "SERVER"
  | "VALIDATION"
  | "REQUEST_CONFLICT"
  | "UNKNOWN";

export type JournalPersistenceOperation = "update_journal_entry_draft";

export interface JournalPersistenceContext {
  operation: JournalPersistenceOperation;
  entryId: string;
  entryStatus: string;
  expectedVersion: number;
  requestId: string;
}

export interface JournalPersistenceErrorMetadata {
  httpStatus?: number | null;
  postgresCode?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export class JournalPersistenceError extends Error {
  readonly httpStatus: number | null;
  readonly postgresCode: string | null;
  readonly details: string | null;
  readonly hint: string | null;
  readonly isTimeout: boolean;
  readonly isAbort: boolean;
  readonly isNetwork: boolean;

  constructor(
    readonly kind: JournalPersistenceFailureKind,
    readonly operation: JournalPersistenceOperation,
    readonly entryId: string,
    readonly entryStatus: string,
    readonly expectedVersion: number,
    readonly requestId: string,
    metadata: JournalPersistenceErrorMetadata = {},
  ) {
    super(metadata.message || "Journal persistence failed");
    this.name = "JournalPersistenceError";
    this.httpStatus = metadata.httpStatus ?? null;
    this.postgresCode = metadata.postgresCode ?? null;
    this.details = metadata.details ?? null;
    this.hint = metadata.hint ?? null;
    this.isTimeout = kind === "TIMEOUT";
    this.isAbort = kind === "ABORT";
    this.isNetwork = kind === "NETWORK";
  }
}

export interface JournalSaveFailureDiagnostic {
  diagnosticId: string;
  failureKind: JournalPersistenceFailureKind;
  operation: JournalPersistenceOperation;
  entryId: string;
  entryStatus: string;
  serverExpectedVersion: number;
  localDraftRevision: number;
  requestId: string;
  attemptNumber: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  httpStatus: number | null;
  postgresCode: string | null;
  isTimeout: boolean;
  isAbort: boolean;
  isNetwork: boolean;
}

type ErrorLike = {
  name?: string;
  code?: string | number;
  message?: string;
  details?: string;
  hint?: string;
};

const abortLike = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as ErrorLike;
  return candidate.name === "AbortError" || candidate.code === "ABORT_ERR";
};

const networkLike = (error: unknown) => {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== "object") return false;
  const message = (error as ErrorLike).message?.toLowerCase() ?? "";
  return ["failed to fetch", "networkerror", "network request", "load failed"].some((fragment) => message.includes(fragment));
};

export function classifyJournalPersistenceFailure(
  error: ErrorLike | null,
  httpStatus: number | null = null,
): JournalPersistenceFailureKind {
  if (!error) return "UNKNOWN";
  const code = typeof error.code === "string" ? error.code : null;
  if (abortLike(error)) return "ABORT";
  if (networkLike(error)) return "NETWORK";
  if (code === "PT409" || code === "40001") return "VERSION_CONFLICT";
  if (code === "42501" || httpStatus === 401 || httpStatus === 403) return "PERMISSION";
  if (code === "22023" && /(?:request|요청)\s*(?:id|ID)/i.test(error.message ?? "")) return "REQUEST_CONFLICT";
  if (["22023", "23505", "P0002"].includes(code ?? "")) return "VALIDATION";
  if (code || (httpStatus !== null && httpStatus >= 400)) return "SERVER";
  return "UNKNOWN";
}

export function journalPersistenceErrorFromUnknown(
  error: unknown,
  context: JournalPersistenceContext,
  metadata: JournalPersistenceErrorMetadata = {},
  forcedKind?: JournalPersistenceFailureKind,
) {
  if (error instanceof JournalPersistenceError) return error;
  const candidate = error && typeof error === "object" ? error as ErrorLike : null;
  const merged = {
    httpStatus: metadata.httpStatus ?? null,
    postgresCode: metadata.postgresCode ?? (typeof candidate?.code === "string" ? candidate.code : null),
    message: metadata.message ?? candidate?.message ?? (typeof error === "string" ? error : null),
    details: metadata.details ?? candidate?.details ?? null,
    hint: metadata.hint ?? candidate?.hint ?? null,
  };
  const kind = forcedKind ?? classifyJournalPersistenceFailure(candidate, merged.httpStatus);
  return new JournalPersistenceError(
    kind,
    context.operation,
    context.entryId,
    context.entryStatus,
    context.expectedVersion,
    context.requestId,
    merged,
  );
}

export function createJournalDiagnosticId() {
  return `JRN-SAVE-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

export function logJournalSaveFailure(
  diagnostic: JournalSaveFailureDiagnostic,
) {
  const safeDiagnostic = {
    diagnosticId: diagnostic.diagnosticId,
    failureKind: diagnostic.failureKind,
    operation: diagnostic.operation,
    entryId: diagnostic.entryId,
    entryStatus: diagnostic.entryStatus,
    serverExpectedVersion: diagnostic.serverExpectedVersion,
    localDraftRevision: diagnostic.localDraftRevision,
    requestId: diagnostic.requestId,
    attemptNumber: diagnostic.attemptNumber,
    startedAt: diagnostic.startedAt,
    endedAt: diagnostic.endedAt,
    durationMs: diagnostic.durationMs,
    httpStatus: diagnostic.httpStatus,
    postgresCode: diagnostic.postgresCode,
    isTimeout: diagnostic.isTimeout,
    isAbort: diagnostic.isAbort,
    isNetwork: diagnostic.isNetwork,
  };
  console.error("[journal-autosave]", safeDiagnostic);
}
