import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearJournalBatchDiagnosticsForTests,
  formatJournalBatchDiagnostic,
  getJournalBatchDiagnostic,
  journalBatchFailureMessage,
  JournalBatchDiagnosticSession,
  type JournalBatchStage,
} from "./journalBatchDiagnostics";

beforeEach(() => {
  clearJournalBatchDiagnosticsForTests();
  vi.spyOn(crypto, "randomUUID").mockReturnValue("12345678-1234-4234-8234-123456789012");
});

afterEach(() => vi.restoreAllMocks());

describe("Journal batch diagnostics", () => {
  it.each(["PREPARE", "RENDER", "ENCODE", "VALIDATION", "ZIP", "DOWNLOAD"] as const)(
    "preserves an injected %s failure as the exact safe stage",
    (stage) => {
      const session = new JournalBatchDiagnosticSession(5);
      const entry = stage === "PREPARE" || stage === "ZIP" || stage === "DOWNLOAD"
        ? { ordinal: null, entryId: null, dogId: null }
        : { ordinal: 4, entryId: "entry-4", dogId: "dog-4" };
      session.start(stage, entry);
      const error = Object.assign(new Error(`JOURNAL_${stage}_FAILED`), { code: "22023", status: 400 });
      const failure = session.fail(error).diagnostic;
      expect(failure.failure).toMatchObject({
        stage,
        ordinal: entry.ordinal,
        entryId: entry.entryId,
        dogId: entry.dogId,
        errorClass: "Error",
        safeErrorMessage: `JOURNAL_${stage}_FAILED`,
        httpStatus: 400,
        postgresCode: "22023",
      });
      expect(failure.events.at(-1)?.event).toBe("FAILURE");
      expect(getJournalBatchDiagnostic(failure.batchId)).toBe(failure);
    },
  );

  it("retains stage timing and size evidence without business content", () => {
    const session = new JournalBatchDiagnosticSession(1);
    const entry = { ordinal: 1, entryId: "entry-safe", dogId: "dog-safe" };
    session.start("FETCH", entry);
    session.ack("FETCH", entry);
    session.start("RENDER", entry);
    session.ack("RENDER", entry, { canvasWidth: 1080, canvasHeight: 1440 });
    session.start("ENCODE", entry);
    session.ack("ENCODE", entry, { encodedByteSize: 1234 });
    session.entryComplete(entry, 1234);
    session.start("ZIP", { ordinal: null, entryId: null, dogId: null });
    const diagnostic = session.fail(new Error("private teacher comment must not be copied")).diagnostic;
    const text = formatJournalBatchDiagnostic(diagnostic);
    expect(text).toContain("CANVAS=1080x1440");
    expect(text).toContain("ENCODED_BYTES=1234");
    expect(text).toContain("ACCUMULATED_ENTRY_COUNT: 1");
    expect(text).toContain("SAFE_ERROR_MESSAGE: [REDACTED_NON_CONTRACT_ERROR]");
    expect(text).not.toContain("private teacher comment");
  });

  it.each([
    ["PREPARE", "이미지 저장 준비 중 문제가 발생했습니다."],
    ["FETCH", "3번째 일지 이미지 생성 중 문제가 발생했습니다."],
    ["ZIP", "일지 파일 묶음을 만드는 중 문제가 발생했습니다."],
    ["DOWNLOAD", "일지 파일 다운로드를 준비하는 중 문제가 발생했습니다."],
  ] as Array<[JournalBatchStage, string]>)("maps %s to stage-specific user copy", (stage, expected) => {
    const session = new JournalBatchDiagnosticSession(3);
    const context = stage === "FETCH"
      ? { ordinal: 3, entryId: "entry-3", dogId: "dog-3" }
      : { ordinal: null, entryId: null, dogId: null };
    session.start(stage as Exclude<JournalBatchStage, "ENTRY_COMPLETE">, context);
    const diagnostic = session.fail(new Error(`JOURNAL_${stage}_FAILED`)).diagnostic;
    expect(journalBatchFailureMessage(diagnostic.failure!)).toBe(expected);
  });

  it("never invents an entry ordinal for a presentation preparation failure", () => {
    const session = new JournalBatchDiagnosticSession(5);
    const context = { ordinal: null, entryId: null, dogId: null };
    session.start("PREPARE", context);
    const diagnostic = session.fail(new Error("JOURNAL_SYSTEM_FONT_RECONNECT_REQUIRED")).diagnostic;
    expect(diagnostic.failure).toMatchObject({ stage: "PREPARE", ordinal: null, accumulatedEntryCount: 0 });
    expect(journalBatchFailureMessage(diagnostic.failure!)).toBe("사용 중인 컴퓨터 글꼴을 다시 연결해야 이미지를 저장할 수 있습니다.");
    expect(formatJournalBatchDiagnostic(diagnostic)).toContain("FAILURE_ORDINAL: NONE");
  });

  it("records every overflow target with safe presentation metrics and no comment content", () => {
    const session = new JournalBatchDiagnosticSession(5);
    session.presentationIssues([
      { ordinal: 1, entryId: "entry-1", dogId: "dog-1", fontSource: "SYSTEM", fontFingerprint: "pnm-journal-system-font-safe", fontSize: 20, commentLength: 420, measuredLines: 11, maxLines: 10, requiredHeight: 299.2, availableHeight: 290, overflowAmount: 10, recommendedSize: 18 },
      { ordinal: 4, entryId: "entry-4", dogId: "dog-4", fontSource: "SYSTEM", fontFingerprint: "pnm-journal-system-font-safe", fontSize: 20, commentLength: 500, measuredLines: 13, maxLines: 10, requiredHeight: 353.6, availableHeight: 290, overflowAmount: 64, recommendedSize: null },
    ]);
    session.start("PREPARE", { ordinal: 1, entryId: "entry-1", dogId: "dog-1" });
    const diagnostic = session.fail(new Error("JOURNAL_BATCH_PRESENTATION_OVERFLOW")).diagnostic;
    const text = formatJournalBatchDiagnostic(diagnostic);
    expect(journalBatchFailureMessage(diagnostic.failure!)).toBe("이미지에 글이 모두 들어가지 않는 일지가 있습니다.");
    expect(text).toContain("PRESENTATION_ISSUE_1: ORDINAL=1 | ENTRY_ID=entry-1 | DOG_ID=dog-1");
    expect(text).toContain("PRESENTATION_ISSUE_2: ORDINAL=4 | ENTRY_ID=entry-4 | DOG_ID=dog-4");
    expect(text).toContain("COMMENT_LENGTH=420");
    expect(text).toContain("RECOMMENDED_SIZE=18");
    expect(text).toContain("OVERFLOW_AMOUNT=10");
    expect(text).not.toContain("teacher comment");
  });
});
