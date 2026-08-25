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

export type JournalValidationAssertionKey =
  | "REQUEST_INPUT_MISSING"
  | "INPUT_VALUE_INVALID"
  | "REQUEST_ID_REUSED"
  | "ENTRY_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "PERMISSION_DENIED"
  | "BEST_FRIEND_SELF"
  | "BEST_FRIEND_NOT_IN_ROSTER"
  | "COMPLETION_REQUIRED_FIELD_MISSING"
  | "ACTIVITY_PAIR_INVALID"
  | "COMMENT_TOO_LONG"
  | "MANNERS_ACTIVITY_TOO_LONG"
  | "PHYSICAL_ACTIVITY_TOO_LONG"
  | "UNIQUE_CONSTRAINT_VIOLATION"
  | "UNKNOWN_VALIDATION";

export interface JournalValidationShape {
  conditionCount: number;
  urineSelected: boolean;
  stoolSelected: boolean;
  stoolStatusPresent: boolean;
  mealCount: number;
  teacherRelationshipPresent: boolean;
  friendRelationshipPresent: boolean;
  bestFriendDogIdPresent: boolean;
  bestFriendRosterMembershipKnown: boolean | null;
  mannersActivityPresent: boolean;
  mannersActivityLength: number;
  mannersEvaluationPresent: boolean;
  physicalActivityPresent: boolean;
  physicalActivityLength: number;
  physicalEvaluationPresent: boolean;
  teacherCommentPresent: boolean;
  teacherCommentLength: number;
}

type JournalValidationDraftLike = {
  conditionCodes: readonly unknown[];
  urination: boolean | null;
  defecation: boolean | null;
  stoolCondition: unknown | null;
  mealCodes: readonly unknown[];
  teacherRelationship: unknown | null;
  friendRelationship: unknown | null;
  bestFriendDogId: string | null;
  mannersActivityName: string;
  mannersEvaluation: unknown | null;
  physicalActivityName: string;
  physicalEvaluation: unknown | null;
  teacherComment: string;
};

export function journalValidationShape(
  draft: JournalValidationDraftLike,
  rosterDogIds: readonly string[],
): JournalValidationShape {
  const mannersActivity = draft.mannersActivityName.trim();
  const physicalActivity = draft.physicalActivityName.trim();
  const teacherComment = draft.teacherComment.trim();
  return {
    conditionCount: draft.conditionCodes.length,
    urineSelected: draft.urination !== null,
    stoolSelected: draft.defecation !== null,
    stoolStatusPresent: draft.defecation === true && draft.stoolCondition !== null,
    mealCount: draft.mealCodes.length,
    teacherRelationshipPresent: draft.teacherRelationship !== null,
    friendRelationshipPresent: draft.friendRelationship !== null,
    bestFriendDogIdPresent: draft.bestFriendDogId !== null,
    bestFriendRosterMembershipKnown: draft.bestFriendDogId === null
      ? null
      : rosterDogIds.includes(draft.bestFriendDogId),
    mannersActivityPresent: mannersActivity.length > 0,
    mannersActivityLength: mannersActivity.length,
    mannersEvaluationPresent: draft.mannersEvaluation !== null,
    physicalActivityPresent: physicalActivity.length > 0,
    physicalActivityLength: physicalActivity.length,
    physicalEvaluationPresent: draft.physicalEvaluation !== null,
    teacherCommentPresent: teacherComment.length > 0,
    teacherCommentLength: teacherComment.length,
  };
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
  serverMessage: string | null;
  serverDetails: string | null;
  serverHint: string | null;
  assertionKey: JournalValidationAssertionKey;
  validationShape: JournalValidationShape;
  isTimeout: boolean;
  isAbort: boolean;
  isNetwork: boolean;
}

const SAFE_SERVER_MESSAGES = new Map<string, JournalValidationAssertionKey>([
  ["일지 항목, 버전, 요청 ID가 필요합니다.", "REQUEST_INPUT_MISSING"],
  ["일지 입력값을 확인해 주세요.", "INPUT_VALUE_INVALID"],
  ["동일 요청 ID가 다른 일지 저장에 사용되었습니다.", "REQUEST_ID_REUSED"],
  ["일지 항목을 찾을 수 없습니다.", "ENTRY_NOT_FOUND"],
  ["다른 사용자가 먼저 변경했습니다.", "VERSION_CONFLICT"],
  ["일지를 작성할 권한이 없습니다.", "PERMISSION_DENIED"],
  ["자기 자신을 제일 친한 친구로 선택할 수 없습니다.", "BEST_FRIEND_SELF"],
  ["같은 날 등원 명단의 반려견만 선택할 수 있습니다.", "BEST_FRIEND_NOT_IN_ROSTER"],
  ["필수 일지 내용을 모두 입력해 주세요.", "COMPLETION_REQUIRED_FIELD_MISSING"],
  ["활동명과 평가는 함께 입력해 주세요.", "ACTIVITY_PAIR_INVALID"],
]);

export const JOURNAL_VALIDATION_ASSERTION_MAP = Object.freeze(
  Array.from(SAFE_SERVER_MESSAGES, ([serverMessage, assertionKey]) => ({ serverMessage, assertionKey })),
);

const EMPTY_VALIDATION_SHAPE: JournalValidationShape = Object.freeze({
  conditionCount: 0,
  urineSelected: false,
  stoolSelected: false,
  stoolStatusPresent: false,
  mealCount: 0,
  teacherRelationshipPresent: false,
  friendRelationshipPresent: false,
  bestFriendDogIdPresent: false,
  bestFriendRosterMembershipKnown: null,
  mannersActivityPresent: false,
  mannersActivityLength: 0,
  mannersEvaluationPresent: false,
  physicalActivityPresent: false,
  physicalActivityLength: 0,
  physicalEvaluationPresent: false,
  teacherCommentPresent: false,
  teacherCommentLength: 0,
});

const sanitizeServerMessage = (value: string | null) => {
  if (!value) return null;
  if (SAFE_SERVER_MESSAGES.has(value)) return value;
  if (/^duplicate key value violates unique constraint "[a-z0-9_]+"$/i.test(value)) return value;
  return "[REDACTED_UNRECOGNIZED_SERVER_MESSAGE]";
};

const sanitizeSupplementalServerText = (value: string | null) => {
  if (!value) return null;
  if (SAFE_SERVER_MESSAGES.has(value)) return value;
  return "[REDACTED]";
};

export function journalValidationAssertionKey(
  postgresCode: string | null,
  serverMessage: string | null,
  shape: JournalValidationShape,
): JournalValidationAssertionKey {
  const mapped = serverMessage ? SAFE_SERVER_MESSAGES.get(serverMessage) : null;
  if (mapped && mapped !== "INPUT_VALUE_INVALID") return mapped;
  if (postgresCode === "P0002") return "ENTRY_NOT_FOUND";
  if (postgresCode === "PT409" || postgresCode === "40001") return "VERSION_CONFLICT";
  if (postgresCode === "42501") return "PERMISSION_DENIED";
  if (postgresCode === "23505") return "UNIQUE_CONSTRAINT_VIOLATION";
  if (shape.bestFriendDogIdPresent && shape.bestFriendRosterMembershipKnown === false) return "BEST_FRIEND_NOT_IN_ROSTER";
  if (shape.teacherCommentLength > 500) return "COMMENT_TOO_LONG";
  if (shape.mannersActivityLength > 80) return "MANNERS_ACTIVITY_TOO_LONG";
  if (shape.physicalActivityLength > 80) return "PHYSICAL_ACTIVITY_TOO_LONG";
  if (shape.mannersActivityPresent !== shape.mannersEvaluationPresent
    || shape.physicalActivityPresent !== shape.physicalEvaluationPresent) return "ACTIVITY_PAIR_INVALID";
  return mapped ?? "UNKNOWN_VALIDATION";
}

const JOURNAL_DIAGNOSTIC_LIMIT = 10;
const journalDiagnosticBuffer: JournalSaveFailureDiagnostic[] = [];

export function storeJournalFailureDiagnostic(diagnostic: JournalSaveFailureDiagnostic) {
  journalDiagnosticBuffer.push(diagnostic);
  if (journalDiagnosticBuffer.length > JOURNAL_DIAGNOSTIC_LIMIT) {
    journalDiagnosticBuffer.splice(0, journalDiagnosticBuffer.length - JOURNAL_DIAGNOSTIC_LIMIT);
  }
}

export function getJournalFailureDiagnostic(diagnosticId: string) {
  return journalDiagnosticBuffer.find((item) => item.diagnosticId === diagnosticId) ?? null;
}

export function clearJournalFailureDiagnosticsForTests() {
  journalDiagnosticBuffer.splice(0);
}

const diagnosticValue = (value: string | number | boolean | null) => value === null ? "NONE" : String(value);

export function formatJournalFailureDiagnostic(diagnostic: JournalSaveFailureDiagnostic) {
  const shape = diagnostic.validationShape;
  return [
    ["DIAGNOSTIC_ID", diagnostic.diagnosticId],
    ["TIMESTAMP", diagnostic.endedAt],
    ["FAILURE_KIND", diagnostic.failureKind],
    ["ASSERTION_KEY", diagnostic.assertionKey],
    ["OPERATION", diagnostic.operation],
    ["ENTRY_ID", diagnostic.entryId],
    ["ENTRY_STATUS", diagnostic.entryStatus],
    ["EXPECTED_VERSION", diagnostic.serverExpectedVersion],
    ["DRAFT_REVISION", diagnostic.localDraftRevision],
    ["REQUEST_ID", diagnostic.requestId],
    ["ATTEMPT_NUMBER", diagnostic.attemptNumber],
    ["DURATION_MS", diagnostic.durationMs],
    ["HTTP_STATUS", diagnostic.httpStatus],
    ["POSTGRES_CODE", diagnostic.postgresCode],
    ["SERVER_MESSAGE", diagnostic.serverMessage],
    ["SERVER_DETAILS", diagnostic.serverDetails],
    ["SERVER_HINT", diagnostic.serverHint],
    ["TIMEOUT", diagnostic.isTimeout],
    ["ABORT", diagnostic.isAbort],
    ["NETWORK", diagnostic.isNetwork],
    ["CONDITION_COUNT", shape.conditionCount],
    ["URINE_SELECTED", shape.urineSelected],
    ["STOOL_SELECTED", shape.stoolSelected],
    ["STOOL_STATUS_PRESENT", shape.stoolStatusPresent],
    ["MEAL_COUNT", shape.mealCount],
    ["TEACHER_RELATIONSHIP_PRESENT", shape.teacherRelationshipPresent],
    ["FRIEND_RELATIONSHIP_PRESENT", shape.friendRelationshipPresent],
    ["BEST_FRIEND_PRESENT", shape.bestFriendDogIdPresent],
    ["BEST_FRIEND_ROSTER_MEMBERSHIP_KNOWN", shape.bestFriendRosterMembershipKnown],
    ["MANNERS_ACTIVITY_PRESENT", shape.mannersActivityPresent],
    ["MANNERS_ACTIVITY_LENGTH", shape.mannersActivityLength],
    ["MANNERS_EVALUATION_PRESENT", shape.mannersEvaluationPresent],
    ["PHYSICAL_ACTIVITY_PRESENT", shape.physicalActivityPresent],
    ["PHYSICAL_ACTIVITY_LENGTH", shape.physicalActivityLength],
    ["PHYSICAL_EVALUATION_PRESENT", shape.physicalEvaluationPresent],
    ["TEACHER_COMMENT_PRESENT", shape.teacherCommentPresent],
    ["TEACHER_COMMENT_LENGTH", shape.teacherCommentLength],
  ].map(([key, value]) => `${key}: ${diagnosticValue(value)}`).join("\n");
}

export function safeJournalFailureDiagnostic(
  diagnostic: Omit<JournalSaveFailureDiagnostic, "serverMessage" | "serverDetails" | "serverHint" | "assertionKey" | "validationShape">,
  failure: JournalPersistenceError,
  validationShape: JournalValidationShape = EMPTY_VALIDATION_SHAPE,
): JournalSaveFailureDiagnostic {
  const serverMessage = sanitizeServerMessage(failure.message);
  const safeDiagnostic = {
    ...diagnostic,
    serverMessage,
    serverDetails: sanitizeSupplementalServerText(failure.details),
    serverHint: sanitizeSupplementalServerText(failure.hint),
    assertionKey: journalValidationAssertionKey(failure.postgresCode, serverMessage, validationShape),
    validationShape,
  };
  storeJournalFailureDiagnostic(safeDiagnostic);
  return safeDiagnostic;
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
    serverMessage: diagnostic.serverMessage,
    serverDetails: diagnostic.serverDetails,
    serverHint: diagnostic.serverHint,
    assertionKey: diagnostic.assertionKey,
    validationShape: diagnostic.validationShape,
    isTimeout: diagnostic.isTimeout,
    isAbort: diagnostic.isAbort,
    isNetwork: diagnostic.isNetwork,
  };
  console.error("[journal-autosave]", safeDiagnostic);
}
