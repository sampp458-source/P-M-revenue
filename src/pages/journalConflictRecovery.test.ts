import { afterEach, describe, expect, it, vi } from "vitest";
import type { JournalDraft } from "./journalRepository";
import {
  analyzeJournalThreeWayMerge,
  createJournalConflictBufferRecord,
  deleteJournalConflictBuffer,
  isJournalConflictBufferExpired,
  loadJournalConflictBuffer,
  saveJournalConflictBuffer,
} from "./journalConflictRecovery";

const draft = (overrides: Partial<JournalDraft> = {}): JournalDraft => ({
  conditionCodes: ["active"], urination: true, defecation: true, stoolCondition: "good",
  mealCodes: ["brought_food"], teacherRelationship: "loves_teacher", friendRelationship: "loves_friends",
  bestFriendTargets: [], mannersActivityName: "기다려", mannersEvaluation: "excellent",
  physicalActivityName: "공놀이", physicalEvaluation: "champion", teacherComment: "기본 내용",
  ...overrides,
});

describe("Journal conflict recovery foundation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a canonical durable record without presentation-only font preferences", () => {
    const record = createJournalConflictBufferRecord({
      entryId: "entry-1", baseVersion: 7, latestServerVersion: 8,
      baseStatus: "IN_PROGRESS", localStatus: "IN_PROGRESS", latestServerStatus: "COMPLETED",
      latestServerCaptured: true,
      baseSnapshot: draft(), localDraft: draft({ teacherComment: "로컬\r\n내용" }),
      latestServerSnapshot: draft(), timestamp: "2026-08-29T12:00:00.000Z",
      classification: "SELF_ORIGINATED_WITH_LOCAL_PENDING",
    });
    expect(record.localDraft.teacherComment).toBe("로컬\n내용");
    expect(record).not.toHaveProperty("font");
    expect(record).not.toHaveProperty("fontSize");
    expect(isJournalConflictBufferExpired(record, Date.parse("2026-08-29T13:00:00.000Z"))).toBe(false);
    expect(isJournalConflictBufferExpired(record, Date.parse("2026-08-31T13:00:00.000Z"))).toBe(true);
  });

  it("builds a safe merge candidate only for disjoint field changes", () => {
    const base = draft();
    const local = draft({ teacherComment: "로컬 한마디" });
    const server = draft({ mealCodes: ["daycare_food"] });
    const result = analyzeJournalThreeWayMerge(base, local, server);
    expect(result.conflictFields).toEqual([]);
    expect(result.mergedCandidate.teacherComment).toBe("로컬 한마디");
    expect(result.mergedCandidate.mealCodes).toEqual(["daycare_food"]);
  });

  it("marks same-field divergence and Best Friend divergence for user resolution", () => {
    const base = draft();
    const result = analyzeJournalThreeWayMerge(
      base,
      draft({ teacherComment: "로컬", bestFriendTargets: [{ type: "TEACHER", dogId: null }] }),
      draft({ teacherComment: "서버", bestFriendTargets: [{ type: "DOG", dogId: "dog-2" }] }),
    );
    expect(result.conflictFields).toEqual(expect.arrayContaining(["teacherComment", "bestFriendTargets"]));
  });

  it("persists, reloads, and explicitly clears the entry-scoped recovery record", async () => {
    const records = new Map<string, unknown>();
    let initialized = false;
    const eventRequest = <T>(operation: () => T) => {
      const listeners = new Map<string, Array<() => void>>();
      const request = {
        result: undefined as T | undefined,
        error: null,
        addEventListener(type: string, listener: () => void) {
          listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
      };
      queueMicrotask(() => {
        request.result = operation();
        listeners.get("success")?.forEach((listener) => listener());
      });
      return request;
    };
    const database = {
      objectStoreNames: { contains: () => initialized },
      createObjectStore: () => { initialized = true; },
      transaction: () => ({ objectStore: () => ({
        put: (value: { entryId: string }) => eventRequest(() => { records.set(value.entryId, value); return value.entryId; }),
        get: (key: string) => eventRequest(() => records.get(key)),
        getAll: () => eventRequest(() => [...records.values()]),
        delete: (key: string) => eventRequest(() => records.delete(key)),
      }) }),
      close: () => undefined,
    };
    const indexedDb = {
      open: () => {
        const listeners = new Map<string, Array<() => void>>();
        const request = {
          result: database,
          error: null,
          addEventListener(type: string, listener: () => void) {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
          },
        };
        queueMicrotask(() => {
          if (!initialized) listeners.get("upgradeneeded")?.forEach((listener) => listener());
          listeners.get("success")?.forEach((listener) => listener());
        });
        return request;
      },
    };
    vi.stubGlobal("indexedDB", indexedDb);
    const record = createJournalConflictBufferRecord({
      entryId: "entry-durable", baseVersion: 3, latestServerVersion: 4,
      baseStatus: "IN_PROGRESS", localStatus: "IN_PROGRESS", latestServerStatus: "IN_PROGRESS",
      latestServerCaptured: true,
      baseSnapshot: draft(), localDraft: draft({ teacherComment: "보존할 내용" }), latestServerSnapshot: draft(),
      timestamp: new Date().toISOString(), classification: "TRUE_EXTERNAL_CONFLICT",
    });

    await saveJournalConflictBuffer(record);
    await expect(loadJournalConflictBuffer(record.entryId)).resolves.toMatchObject({
      entryId: record.entryId, localDraft: expect.objectContaining({ teacherComment: "보존할 내용" }),
    });
    await deleteJournalConflictBuffer(record.entryId);
    await expect(loadJournalConflictBuffer(record.entryId)).resolves.toBeNull();

    const expired = { ...record, timestamp: "2026-08-20T00:00:00.000Z" };
    await saveJournalConflictBuffer(expired);
    await expect(loadJournalConflictBuffer(expired.entryId)).resolves.toBeNull();
    expect(records.has(expired.entryId)).toBe(false);
  });

  it("keeps a server completion transition conservative when a local business field also changed", () => {
    const result = analyzeJournalThreeWayMerge(
      draft(), draft({ teacherComment: "완료 응답 뒤 로컬 입력" }), draft(),
      { base: "IN_PROGRESS", local: "IN_PROGRESS", server: "COMPLETED" },
    );
    expect(result.statusConflict).toBe(true);
  });
});
