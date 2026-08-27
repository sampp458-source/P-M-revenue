import { describe, expect, it } from "vitest";
import { buildJournalPreviewViewModel, journalEntryToDraft } from "./journalPreviewViewModel";
import type { JournalRosterEntry } from "./journalRepository";

const entry = (overrides: Partial<JournalRosterEntry> = {}): JournalRosterEntry => ({
  id: "entry-a",
  journalDayId: "day-a",
  businessDate: "2026-08-27",
  dog: { id: "dog-a", name: "가을" },
  customer: { id: "customer-a", name: "보호자" },
  status: "IN_PROGRESS",
  conditionCodes: [],
  urination: null,
  defecation: null,
  stoolCondition: null,
  mealCodes: [],
  teacherRelationship: null,
  friendRelationship: null,
  bestFriendDogId: null,
  mannersActivityName: null,
  mannersEvaluation: null,
  physicalActivityName: null,
  physicalEvaluation: null,
  teacherComment: null,
  version: 1,
  createdAt: "2026-08-27T00:00:00Z",
  updatedAt: "2026-08-27T00:00:00Z",
  ...overrides,
});

describe("Journal Best Friend ViewModel normalization", () => {
  it("uses canonical V2 targets even when the array is empty", () => {
    const draft = journalEntryToDraft(entry({ bestFriendDogId: "legacy-dog", bestFriendTargets: [] }));
    expect(draft.bestFriendTargets).toEqual([]);
  });

  it("normalizes a legacy single Dog only when V2 targets are absent", () => {
    const legacy = entry({ bestFriendDogId: "dog-b" });
    const draft = journalEntryToDraft(legacy);
    const viewModel = buildJournalPreviewViewModel(legacy, draft, [
      legacy,
      entry({ id: "entry-b", dog: { id: "dog-b", name: "단추" } }),
    ]);
    expect(draft.bestFriendTargets).toEqual([{ type: "DOG", dogId: "dog-b" }]);
    expect(viewModel.bestFriendTargets).toEqual([{ type: "DOG", dogId: "dog-b", label: "단추" }]);
  });

  it("resolves ordered Dogs and Teacher from the current roster only", () => {
    const source = entry({
      bestFriendTargets: [
        { type: "DOG", dogId: "dog-b" },
        { type: "TEACHER", dogId: null },
        { type: "DOG", dogId: "not-in-roster" },
      ],
    });
    const draft = journalEntryToDraft(source);
    const viewModel = buildJournalPreviewViewModel(source, draft, [
      source,
      entry({ id: "entry-b", dog: { id: "dog-b", name: "가을" } }),
    ]);
    expect(viewModel.bestFriendTargets).toEqual([
      { type: "DOG", dogId: "dog-b", label: "가을" },
      { type: "TEACHER", dogId: null, label: "선생님" },
    ]);
  });
});
