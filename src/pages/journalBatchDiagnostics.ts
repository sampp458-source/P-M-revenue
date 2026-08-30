export type JournalBatchStage =
  | "PREPARE"
  | "FETCH"
  | "RENDER"
  | "ENCODE"
  | "VALIDATION"
  | "ENTRY_COMPLETE"
  | "ZIP"
  | "DOWNLOAD";

export type JournalBatchStageEventName =
  | "PREPARE_START"
  | "PREPARE_ACK"
  | "FETCH_START"
  | "FETCH_ACK"
  | "RENDER_START"
  | "RENDER_ACK"
  | "ENCODE_START"
  | "ENCODE_ACK"
  | "VALIDATION_START"
  | "VALIDATION_ACK"
  | "ENTRY_COMPLETE"
  | "ZIP_START"
  | "ZIP_ACK"
  | "DOWNLOAD_START"
  | "DOWNLOAD_ACK"
  | "FAILURE";

export type JournalBatchEntryContext = {
  ordinal: number | null;
  entryId: string | null;
  dogId: string | null;
};

export type JournalBatchStageEvent = JournalBatchEntryContext & {
  event: JournalBatchStageEventName;
  timestamp: string;
  durationMs: number | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
  encodedByteSize: number | null;
  accumulatedEntryCount: number;
  accumulatedByteSize: number;
};

export type JournalBatchFailure = JournalBatchEntryContext & {
  stage: JournalBatchStage;
  errorClass: string;
  safeErrorMessage: string;
  httpStatus: number | null;
  postgresCode: string | null;
  durationMs: number;
  canvasWidth: number | null;
  canvasHeight: number | null;
  encodedByteSize: number | null;
  accumulatedEntryCount: number;
  accumulatedByteSize: number;
};

export type JournalBatchDiagnostic = {
  batchId: string;
  startedAt: string;
  endedAt: string | null;
  targetCount: number;
  events: JournalBatchStageEvent[];
  failure: JournalBatchFailure | null;
};

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  httpStatus?: unknown;
};

const JOURNAL_BATCH_DIAGNOSTIC_LIMIT = 10;
const journalBatchDiagnosticBuffer: JournalBatchDiagnostic[] = [];
const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
const elapsed = (startedAt: number) => Math.max(0, Math.round((now() - startedAt) * 10) / 10);

const safeToken = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(trimmed) ? trimmed : fallback;
};

const safeErrorMessage = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "[NO_SAFE_ERROR_MESSAGE]";
  const trimmed = value.trim();
  if (/^[A-Z][A-Z0-9_.:-]{2,127}$/.test(trimmed)) return trimmed;
  return "[REDACTED_NON_CONTRACT_ERROR]";
};

const numericStatus = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const postgresCode = (value: unknown) => typeof value === "string" && /^[0-9A-Z]{5}$/.test(value) ? value : null;

export class JournalBatchExportError extends Error {
  readonly diagnostic: JournalBatchDiagnostic;

  constructor(diagnostic: JournalBatchDiagnostic) {
    super("JOURNAL_BATCH_EXPORT_FAILED");
    this.name = "JournalBatchExportError";
    this.diagnostic = diagnostic;
  }
}

export class JournalBatchDiagnosticSession {
  readonly diagnostic: JournalBatchDiagnostic;
  private readonly batchStartedAt = now();
  private readonly stageStartedAt = new Map<string, number>();
  private currentStage: JournalBatchStage = "PREPARE";
  private currentEntry: JournalBatchEntryContext = { ordinal: null, entryId: null, dogId: null };
  private canvasWidth: number | null = null;
  private canvasHeight: number | null = null;
  private encodedByteSize: number | null = null;
  private accumulatedEntryCount = 0;
  private accumulatedByteSize = 0;

  constructor(targetCount: number) {
    this.diagnostic = {
      batchId: `JRN-BATCH-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
      startedAt: new Date().toISOString(),
      endedAt: null,
      targetCount,
      events: [],
      failure: null,
    };
  }

  private key(stage: JournalBatchStage, context: JournalBatchEntryContext) {
    return `${stage}:${context.ordinal ?? "batch"}`;
  }

  private append(event: JournalBatchStageEventName, context: JournalBatchEntryContext, durationMs: number | null) {
    this.diagnostic.events.push({
      event,
      ...context,
      timestamp: new Date().toISOString(),
      durationMs,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      encodedByteSize: this.encodedByteSize,
      accumulatedEntryCount: this.accumulatedEntryCount,
      accumulatedByteSize: this.accumulatedByteSize,
    });
  }

  start(stage: Exclude<JournalBatchStage, "ENTRY_COMPLETE">, context: JournalBatchEntryContext) {
    if (stage === "FETCH" && context.ordinal !== null) {
      this.canvasWidth = null;
      this.canvasHeight = null;
      this.encodedByteSize = null;
    } else if (stage === "ZIP") {
      this.canvasWidth = null;
      this.canvasHeight = null;
      this.encodedByteSize = null;
    }
    this.currentStage = stage;
    this.currentEntry = context;
    this.stageStartedAt.set(this.key(stage, context), now());
    this.append(`${stage}_START`, context, null);
  }

  ack(
    stage: Exclude<JournalBatchStage, "ENTRY_COMPLETE">,
    context: JournalBatchEntryContext,
    detail: { canvasWidth?: number; canvasHeight?: number; encodedByteSize?: number } = {},
  ) {
    if (detail.canvasWidth !== undefined) this.canvasWidth = detail.canvasWidth;
    if (detail.canvasHeight !== undefined) this.canvasHeight = detail.canvasHeight;
    if (detail.encodedByteSize !== undefined) this.encodedByteSize = detail.encodedByteSize;
    const startedAt = this.stageStartedAt.get(this.key(stage, context));
    this.append(`${stage}_ACK`, context, startedAt === undefined ? null : elapsed(startedAt));
  }

  entryComplete(context: JournalBatchEntryContext, encodedByteSize: number) {
    this.currentStage = "ENTRY_COMPLETE";
    this.currentEntry = context;
    this.encodedByteSize = encodedByteSize;
    this.accumulatedEntryCount += 1;
    this.accumulatedByteSize += encodedByteSize;
    this.append("ENTRY_COMPLETE", context, null);
  }

  complete() {
    this.diagnostic.endedAt = new Date().toISOString();
    storeJournalBatchDiagnostic(this.diagnostic);
    return this.diagnostic;
  }

  fail(error: unknown) {
    const candidate = error && typeof error === "object" ? error as ErrorLike : null;
    const stageStartedAt = this.stageStartedAt.get(this.key(this.currentStage, this.currentEntry)) ?? this.batchStartedAt;
    const failure: JournalBatchFailure = {
      stage: this.currentStage,
      ...this.currentEntry,
      errorClass: safeToken(candidate?.name ?? candidate?.constructor?.name, "UnknownError"),
      safeErrorMessage: safeErrorMessage(candidate?.message ?? error),
      httpStatus: numericStatus(candidate?.httpStatus) ?? numericStatus(candidate?.status),
      postgresCode: postgresCode(candidate?.code),
      durationMs: elapsed(stageStartedAt),
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      encodedByteSize: this.encodedByteSize,
      accumulatedEntryCount: this.accumulatedEntryCount,
      accumulatedByteSize: this.accumulatedByteSize,
    };
    this.diagnostic.failure = failure;
    this.diagnostic.endedAt = new Date().toISOString();
    this.append("FAILURE", this.currentEntry, failure.durationMs);
    storeJournalBatchDiagnostic(this.diagnostic);
    return new JournalBatchExportError(this.diagnostic);
  }
}

export function storeJournalBatchDiagnostic(diagnostic: JournalBatchDiagnostic) {
  journalBatchDiagnosticBuffer.push(diagnostic);
  if (journalBatchDiagnosticBuffer.length > JOURNAL_BATCH_DIAGNOSTIC_LIMIT) {
    journalBatchDiagnosticBuffer.splice(0, journalBatchDiagnosticBuffer.length - JOURNAL_BATCH_DIAGNOSTIC_LIMIT);
  }
}

export function getJournalBatchDiagnostic(batchId: string) {
  return journalBatchDiagnosticBuffer.find((item) => item.batchId === batchId) ?? null;
}

export function clearJournalBatchDiagnosticsForTests() {
  journalBatchDiagnosticBuffer.splice(0);
}

const value = (item: string | number | null) => item === null ? "NONE" : String(item);

export function formatJournalBatchDiagnostic(diagnostic: JournalBatchDiagnostic) {
  const failure = diagnostic.failure;
  const header = [
    ["BATCH_ID", diagnostic.batchId],
    ["STARTED_AT", diagnostic.startedAt],
    ["ENDED_AT", diagnostic.endedAt],
    ["TARGET_COUNT", diagnostic.targetCount],
    ["FAILURE_STAGE", failure?.stage ?? null],
    ["FAILURE_ORDINAL", failure?.ordinal ?? null],
    ["FAILURE_ENTRY_ID", failure?.entryId ?? null],
    ["FAILURE_DOG_ID", failure?.dogId ?? null],
    ["ERROR_CLASS", failure?.errorClass ?? null],
    ["SAFE_ERROR_MESSAGE", failure?.safeErrorMessage ?? null],
    ["HTTP_STATUS", failure?.httpStatus ?? null],
    ["POSTGRES_CODE", failure?.postgresCode ?? null],
    ["DURATION_MS", failure?.durationMs ?? null],
    ["CANVAS_WIDTH", failure?.canvasWidth ?? null],
    ["CANVAS_HEIGHT", failure?.canvasHeight ?? null],
    ["ENCODED_BYTE_SIZE", failure?.encodedByteSize ?? null],
    ["ACCUMULATED_ENTRY_COUNT", failure?.accumulatedEntryCount ?? null],
    ["ACCUMULATED_BYTE_SIZE", failure?.accumulatedByteSize ?? null],
  ].map(([key, item]) => `${key}: ${value(item)}`);
  const timeline = diagnostic.events.map((event, index) => [
    `EVENT_${index + 1}`,
    event.event,
    `ORDINAL=${value(event.ordinal)}`,
    `ENTRY_ID=${value(event.entryId)}`,
    `DOG_ID=${value(event.dogId)}`,
    `DURATION_MS=${value(event.durationMs)}`,
    `CANVAS=${event.canvasWidth === null || event.canvasHeight === null ? "NONE" : `${event.canvasWidth}x${event.canvasHeight}`}`,
    `ENCODED_BYTES=${value(event.encodedByteSize)}`,
    `ACCUMULATED_ENTRIES=${event.accumulatedEntryCount}`,
    `ACCUMULATED_BYTES=${event.accumulatedByteSize}`,
  ].join(" | "));
  return [...header, "TIMELINE:", ...timeline].join("\n");
}

export function journalBatchFailureMessage(failure: JournalBatchFailure) {
  if (failure.safeErrorMessage === "JOURNAL_SYSTEM_FONT_RECONNECT_REQUIRED") {
    return "사용 중인 컴퓨터 글꼴을 다시 연결해야 이미지를 저장할 수 있습니다.";
  }
  if (failure.stage === "ZIP") return "일지 파일 묶음을 만드는 중 문제가 발생했습니다.";
  if (failure.stage === "DOWNLOAD") return "일지 파일 다운로드를 준비하는 중 문제가 발생했습니다.";
  if (failure.stage === "PREPARE" || failure.ordinal === null) return "이미지 저장 준비 중 문제가 발생했습니다.";
  return `${failure.ordinal}번째 일지 이미지 생성 중 문제가 발생했습니다.`;
}
