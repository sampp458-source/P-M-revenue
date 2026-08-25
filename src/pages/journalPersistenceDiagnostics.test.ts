import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JOURNAL_VALIDATION_ASSERTION_MAP,
  JournalPersistenceError,
  clearJournalFailureDiagnosticsForTests,
  classifyJournalPersistenceFailure,
  formatJournalFailureDiagnostic,
  getJournalFailureDiagnostic,
  journalPersistenceErrorFromUnknown,
  journalValidationAssertionKey,
  journalValidationShape,
  logJournalSaveFailure,
  safeJournalFailureDiagnostic,
} from "./journalPersistenceDiagnostics";

const context = {
  operation: "update_journal_entry_draft" as const,
  entryId: "entry-1",
  entryStatus: "COMPLETED",
  expectedVersion: 17,
  requestId: "request-1",
};

describe("Journal persistence diagnostics", () => {
  afterEach(() => clearJournalFailureDiagnosticsForTests());

  it.each([
    [{ code: "PT409", message: "stale" }, 409, "VERSION_CONFLICT"],
    [{ code: "42501", message: "denied" }, 403, "PERMISSION"],
    [{ code: "22023", message: "동일 요청 ID가 다른 저장에 사용되었습니다." }, 400, "REQUEST_CONFLICT"],
    [{ code: "22023", message: "invalid input" }, 400, "VALIDATION"],
    [{ code: "P0001", message: "server failure" }, 400, "SERVER"],
    [{ message: "unclassified" }, null, "UNKNOWN"],
  ] as const)("classifies %# without exposing business content", (error, status, expected) => {
    expect(classifyJournalPersistenceFailure(error, status)).toBe(expected);
  });

  it("distinguishes explicit abort and network rejection", () => {
    expect(classifyJournalPersistenceFailure(new DOMException("aborted", "AbortError"))).toBe("ABORT");
    expect(classifyJournalPersistenceFailure(new TypeError("Failed to fetch"))).toBe("NETWORK");
  });

  it("preserves safe transport and Postgres metadata in a typed error", () => {
    const failure = journalPersistenceErrorFromUnknown(
      { code: "PT409", message: "stale", details: "version mismatch", hint: "reload" },
      context,
      { httpStatus: 409 },
    );
    expect(failure).toBeInstanceOf(JournalPersistenceError);
    expect(failure).toMatchObject({
      kind: "VERSION_CONFLICT",
      operation: "update_journal_entry_draft",
      entryId: "entry-1",
      entryStatus: "COMPLETED",
      expectedVersion: 17,
      requestId: "request-1",
      httpStatus: 409,
      postgresCode: "PT409",
      details: "version mismatch",
      hint: "reload",
      isTimeout: false,
      isAbort: false,
      isNetwork: false,
    });
  });

  it("logs runtime metadata without raw errors or Journal business content", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new JournalPersistenceError(
      "SERVER",
      "update_journal_entry_draft",
      "entry-1",
      "COMPLETED",
      17,
      "request-1",
      { message: "private teacher comment", details: "private customer data", hint: "private phone" },
    );
    logJournalSaveFailure({
      diagnosticId: "JRN-SAVE-SAFE0001",
      failureKind: "SERVER",
      operation: "update_journal_entry_draft",
      entryId: "entry-1",
      entryStatus: "COMPLETED",
      serverExpectedVersion: 17,
      localDraftRevision: 3,
      requestId: "request-1",
      attemptNumber: 1,
      startedAt: "2026-08-25T00:00:00.000Z",
      endedAt: "2026-08-25T00:00:01.000Z",
      durationMs: 1_000,
      httpStatus: 500,
      postgresCode: "P0001",
      serverMessage: "[REDACTED_UNRECOGNIZED_SERVER_MESSAGE]",
      serverDetails: "[REDACTED]",
      serverHint: "[REDACTED]",
      assertionKey: "UNKNOWN_VALIDATION",
      validationShape: journalValidationShape({
        conditionCodes: [], urination: null, defecation: null, stoolCondition: null, mealCodes: [],
        teacherRelationship: null, friendRelationship: null, bestFriendDogId: null,
        mannersActivityName: "", mannersEvaluation: null, physicalActivityName: "",
        physicalEvaluation: null, teacherComment: "",
      }, []),
      isTimeout: false,
      isAbort: false,
      isNetwork: false,
    });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("JRN-SAVE-SAFE0001");
    expect(logged).not.toContain(error.message);
    expect(logged).not.toContain(error.details!);
    expect(logged).not.toContain(error.hint!);
    consoleError.mockRestore();
  });

  it("maps every fixed server assertion and preserves only allowlisted server text", () => {
    expect(JOURNAL_VALIDATION_ASSERTION_MAP).toEqual(expect.arrayContaining([
      expect.objectContaining({ assertionKey: "BEST_FRIEND_NOT_IN_ROSTER" }),
      expect.objectContaining({ assertionKey: "ACTIVITY_PAIR_INVALID" }),
      expect.objectContaining({ assertionKey: "ENTRY_NOT_FOUND" }),
    ]));
    const failure = new JournalPersistenceError(
      "VALIDATION", "update_journal_entry_draft", "entry-1", "COMPLETED", 17, "request-1",
      { httpStatus: 400, postgresCode: "22023", message: "활동명과 평가는 함께 입력해 주세요.", details: "private dog name", hint: "private comment" },
    );
    const diagnostic = safeJournalFailureDiagnostic({
      diagnosticId: "JRN-SAVE-MAPPED01", failureKind: failure.kind, operation: failure.operation,
      entryId: failure.entryId, entryStatus: failure.entryStatus, serverExpectedVersion: 17,
      localDraftRevision: 4, requestId: failure.requestId, attemptNumber: 1,
      startedAt: "2026-08-25T00:00:00.000Z", endedAt: "2026-08-25T00:00:01.000Z",
      durationMs: 1_000, httpStatus: 400, postgresCode: "22023",
      isTimeout: false, isAbort: false, isNetwork: false,
    }, failure);
    expect(diagnostic).toMatchObject({
      serverMessage: "활동명과 평가는 함께 입력해 주세요.",
      serverDetails: "[REDACTED]", serverHint: "[REDACTED]", assertionKey: "ACTIVITY_PAIR_INVALID",
    });
  });

  it("derives validation-only shape without retaining Journal business content", () => {
    const shape = journalValidationShape({
      conditionCodes: ["active"], urination: true, defecation: true, stoolCondition: "good",
      mealCodes: ["brought_food"], teacherRelationship: "loves_teacher",
      friendRelationship: "loves_friends", bestFriendDogId: "dog-2",
      mannersActivityName: "private manners", mannersEvaluation: null,
      physicalActivityName: "private physical", physicalEvaluation: "fun",
      teacherComment: "private teacher comment",
    }, ["dog-1"]);
    expect(shape).toMatchObject({
      conditionCount: 1, urineSelected: true, stoolSelected: true, stoolStatusPresent: true,
      mealCount: 1, bestFriendDogIdPresent: true, bestFriendRosterMembershipKnown: false,
      mannersActivityPresent: true, mannersEvaluationPresent: false,
      physicalActivityPresent: true, physicalEvaluationPresent: true, teacherCommentPresent: true,
    });
    const serialized = JSON.stringify(shape);
    expect(serialized).not.toContain("private manners");
    expect(serialized).not.toContain("private physical");
    expect(serialized).not.toContain("private teacher comment");
    expect(journalValidationAssertionKey("22023", "[REDACTED_UNRECOGNIZED_SERVER_MESSAGE]", shape))
      .toBe("BEST_FRIEND_NOT_IN_ROSTER");
  });

  it("uses safe shape evidence to identify length and activity-pair assertions", () => {
    const base = journalValidationShape({
      conditionCodes: ["active"], urination: true, defecation: false, stoolCondition: null,
      mealCodes: [], teacherRelationship: "loves_teacher", friendRelationship: "loves_friends",
      bestFriendDogId: null, mannersActivityName: "manners", mannersEvaluation: "excellent",
      physicalActivityName: "physical", physicalEvaluation: "fun", teacherComment: "comment",
    }, []);
    expect(journalValidationAssertionKey("22023", "일지 입력값을 확인해 주세요.", {
      ...base, teacherCommentLength: 501,
    })).toBe("COMMENT_TOO_LONG");
    expect(journalValidationAssertionKey("22023", "활동명과 평가는 함께 입력해 주세요.", {
      ...base, mannersEvaluationPresent: false,
    })).toBe("ACTIVITY_PAIR_INVALID");
    expect(journalValidationAssertionKey("P0002", "일지 항목을 찾을 수 없습니다.", base))
      .toBe("ENTRY_NOT_FOUND");
  });

  it("keeps a bounded lookup buffer and formats a safe copy payload", () => {
    for (let index = 0; index < 11; index += 1) {
      const failure = new JournalPersistenceError(
        "VALIDATION", "update_journal_entry_draft", `entry-${index}`, "COMPLETED", 17, `request-${index}`,
        { httpStatus: 400, postgresCode: "22023", message: "일지 입력값을 확인해 주세요." },
      );
      safeJournalFailureDiagnostic({
        diagnosticId: `JRN-SAVE-${String(index).padStart(8, "0")}`, failureKind: failure.kind,
        operation: failure.operation, entryId: failure.entryId, entryStatus: failure.entryStatus,
        serverExpectedVersion: 17, localDraftRevision: index, requestId: failure.requestId,
        attemptNumber: 1, startedAt: "2026-08-25T00:00:00.000Z",
        endedAt: "2026-08-25T00:00:01.000Z", durationMs: 1_000,
        httpStatus: 400, postgresCode: "22023", isTimeout: false, isAbort: false, isNetwork: false,
      }, failure);
    }
    expect(getJournalFailureDiagnostic("JRN-SAVE-00000000")).toBeNull();
    const latest = getJournalFailureDiagnostic("JRN-SAVE-00000010");
    expect(latest).not.toBeNull();
    const copied = formatJournalFailureDiagnostic(latest!);
    expect(copied).toContain("POSTGRES_CODE: 22023");
    expect(copied).toContain("ASSERTION_KEY: INPUT_VALUE_INVALID");
    expect(copied).not.toContain("Dog name");
    expect(copied).not.toContain("teacher comment contents");
  });
});
