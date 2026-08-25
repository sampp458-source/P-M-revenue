import { describe, expect, it, vi } from "vitest";
import {
  JournalPersistenceError,
  classifyJournalPersistenceFailure,
  journalPersistenceErrorFromUnknown,
  logJournalSaveFailure,
} from "./journalPersistenceDiagnostics";

const context = {
  operation: "update_journal_entry_draft" as const,
  entryId: "entry-1",
  entryStatus: "COMPLETED",
  expectedVersion: 17,
  requestId: "request-1",
};

describe("Journal persistence diagnostics", () => {
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
});
