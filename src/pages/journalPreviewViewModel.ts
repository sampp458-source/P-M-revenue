import type { JournalDraft, JournalRosterEntry } from "./journalRepository";

export type JournalPreviewViewModel = {
  entryId: string;
  businessDate: string;
  dog: JournalRosterEntry["dog"];
  customer: JournalRosterEntry["customer"];
  status: JournalRosterEntry["status"];
  draft: JournalDraft;
};

export function buildJournalPreviewViewModel(
  entry: JournalRosterEntry,
  draft: JournalDraft,
): JournalPreviewViewModel {
  return {
    entryId: entry.id,
    businessDate: entry.businessDate,
    dog: entry.dog,
    customer: entry.customer,
    status: entry.status,
    draft: {
      ...draft,
      conditionCodes: [...draft.conditionCodes],
      mealCodes: [...draft.mealCodes],
    },
  };
}
