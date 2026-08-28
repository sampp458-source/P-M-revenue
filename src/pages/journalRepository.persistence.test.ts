import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

import { updateJournalEntryDraft, type JournalDraft } from "./journalRepository";

const draft: JournalDraft = {
  conditionCodes: ["active"],
  urination: true,
  defecation: false,
  stoolCondition: null,
  mealCodes: [],
  teacherRelationship: "loves_teacher",
  friendRelationship: "loves_friends",
  bestFriendDogId: null,
  mannersActivityName: "기다려",
  mannersEvaluation: "excellent",
  physicalActivityName: "공놀이",
  physicalEvaluation: "fun",
  teacherComment: "business content must not be logged",
};

beforeEach(() => mocks.rpc.mockReset());

describe("Journal update persistence metadata", () => {
  it("preserves HTTP and Postgres metadata without changing the RPC payload contract", async () => {
    const abortSignal = vi.fn().mockResolvedValue({
      data: null,
      status: 409,
      error: { code: "PT409", message: "stale", details: "version mismatch", hint: "reload" },
    });
    mocks.rpc.mockReturnValue({ abortSignal });
    const signal = new AbortController().signal;

    const saving = updateJournalEntryDraft("entry-1", 17, draft, "request-1", signal, "COMPLETED");
    await expect(saving).rejects.toMatchObject({
      name: "JournalPersistenceError",
      kind: "VERSION_CONFLICT",
      operation: "update_journal_entry_draft",
      entryId: "entry-1",
      entryStatus: "COMPLETED",
      expectedVersion: 17,
      requestId: "request-1",
      httpStatus: 409,
      postgresCode: "PT409",
      message: "stale",
      details: "version mismatch",
      hint: "reload",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("update_journal_entry_draft_v2", expect.objectContaining({
      p_entry_id: "entry-1",
      p_expected_version: 17,
      p_request_id: "request-1",
      p_teacher_comment: "business content must not be logged",
      p_best_friend_targets: [],
    }));
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("classifies thrown fetch and abort failures", async () => {
    mocks.rpc.mockReturnValueOnce({ abortSignal: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    await expect(updateJournalEntryDraft("entry-1", 1, draft, "request-network", new AbortController().signal))
      .rejects.toMatchObject({ kind: "NETWORK", isNetwork: true });

    mocks.rpc.mockReturnValueOnce({ abortSignal: vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")) });
    const aborted = updateJournalEntryDraft("entry-1", 1, draft, "request-abort", new AbortController().signal);
    await expect(aborted).rejects.toMatchObject({ name: "JournalPersistenceError", kind: "ABORT", isAbort: true });
  });

  it("normalizes teacher comment text at the persistence boundary", async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: { id: "entry-1" }, status: 200, error: null });
    mocks.rpc.mockReturnValue({ abortSignal });
    await updateJournalEntryDraft("entry-1", 1, {
      ...draft,
      teacherComment: "가을\r\n안녕\u00a0친구\ufeff\u200e 👨‍👩‍👧‍👦",
    }, "request-normalize", new AbortController().signal);
    expect(mocks.rpc).toHaveBeenCalledWith("update_journal_entry_draft_v2", expect.objectContaining({
      p_teacher_comment: "가을\n안녕 친구 👨‍👩‍👧‍👦",
    }));
  });

  it("sends exactly 500 PostgreSQL characters and rejects 501 before the RPC", async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: { id: "entry-1" }, status: 200, error: null });
    mocks.rpc.mockReturnValue({ abortSignal });
    const accepted = `  ${"🐶".repeat(499)}\n  `;
    await updateJournalEntryDraft("entry-1", 2, { ...draft, teacherComment: accepted }, "request-500", new AbortController().signal);
    expect(mocks.rpc).toHaveBeenCalledWith("update_journal_entry_draft_v2", expect.objectContaining({
      p_teacher_comment: `${"🐶".repeat(499)}\n`,
    }));

    mocks.rpc.mockClear();
    await expect(Promise.resolve().then(() => updateJournalEntryDraft(
      "entry-1",
      2,
      { ...draft, teacherComment: "가".repeat(501) },
      "request-501",
      new AbortController().signal,
    ))).rejects.toMatchObject({ kind: "VALIDATION", postgresCode: "22023" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves the selected V2 target order in the RPC payload", async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: { id: "entry-1" }, status: 200, error: null });
    mocks.rpc.mockReturnValue({ abortSignal });
    const targets = [
      { type: "DOG" as const, dogId: "dog-b" },
      { type: "TEACHER" as const, dogId: null },
      { type: "DOG" as const, dogId: "dog-c" },
    ];
    await updateJournalEntryDraft("entry-1", 1, { ...draft, bestFriendTargets: targets }, "request-targets", new AbortController().signal);
    expect(mocks.rpc).toHaveBeenCalledWith("update_journal_entry_draft_v2", expect.objectContaining({
      p_best_friend_targets: targets,
    }));
  });
});
