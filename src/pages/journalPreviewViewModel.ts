import type { JournalDraft, JournalRosterEntry } from "./journalRepository";

export type JournalPreviewOption = {
  code: string;
  label: string;
  selected: boolean;
};

export type JournalPreviewActivity = {
  title: string;
  activityName: string;
  options: JournalPreviewOption[];
};

export type JournalPreviewViewModel = {
  entryId: string;
  businessDate: string;
  displayDate: string;
  dogName: string;
  customerName: string | null;
  status: JournalRosterEntry["status"];
  conditionOptions: JournalPreviewOption[];
  urinationOptions: JournalPreviewOption[];
  defecationOptions: JournalPreviewOption[];
  stoolOptions: JournalPreviewOption[];
  mealOptions: JournalPreviewOption[];
  teacherRelationshipOptions: JournalPreviewOption[];
  friendRelationshipOptions: JournalPreviewOption[];
  bestFriendName: string | null;
  manners: JournalPreviewActivity;
  physical: JournalPreviewActivity;
  teacherComment: string;
};

const conditionOptions = [
  ["active", "활발해요"], ["calm", "평온해요"], ["tired", "피곤해요"], ["sensitive", "예민해요"],
] as const;
const stoolOptions = [
  ["good", "좋아요"], ["very_loose", "아주 묽어요"], ["slightly_loose", "조금 묽어요"], ["poor", "상태 안 좋아요"],
] as const;
const mealOptions = [
  ["brought_food", "가져온 사료"], ["daycare_food", "유치원 사료"], ["brought_snack", "가져온 간식"], ["daycare_snack", "유치원 간식"],
] as const;
const teacherRelationshipOptions = [
  ["loves_teacher", "선생님 너무 좋아요"], ["prefers_friends", "친구가 더 좋아요"], ["uncomfortable_with_teacher", "아직은 선생님이 불편해요"],
] as const;
const friendRelationshipOptions = [
  ["loves_friends", "친구 너무 좋아요"], ["prefers_teacher", "선생님이 더 좋아요"], ["uncomfortable_with_friends", "아직은 친구가 불편해요"],
] as const;
const mannersOptions = [
  ["excellent", "참 잘했어요"], ["can_improve", "다음엔 더 잘할 수 있어요"], ["difficult", "아직은 어려워요"],
] as const;
const physicalOptions = [
  ["champion", "나는야 체육왕"], ["fun", "너무 재미있었어요"], ["rest", "오늘은 쉴래요"],
] as const;

const selectedOptions = (
  options: ReadonlyArray<readonly [string, string]>,
  selected: readonly string[],
): JournalPreviewOption[] => options.map(([code, label]) => ({ code, label, selected: selected.includes(code) }));

const singleOptions = (
  options: ReadonlyArray<readonly [string, string]>,
  selected: string | null,
): JournalPreviewOption[] => selectedOptions(options, selected ? [selected] : []);

const binaryOptions = (selected: boolean | null): JournalPreviewOption[] => [
  { code: "yes", label: "O", selected: selected === true },
  { code: "no", label: "X", selected: selected === false },
];

export const journalEntryToDraft = (entry: JournalRosterEntry): JournalDraft => ({
  conditionCodes: entry.conditionCodes ?? [],
  urination: entry.urination ?? null,
  defecation: entry.defecation ?? null,
  stoolCondition: entry.stoolCondition ?? null,
  mealCodes: entry.mealCodes ?? [],
  teacherRelationship: entry.teacherRelationship ?? null,
  friendRelationship: entry.friendRelationship ?? null,
  bestFriendDogId: entry.bestFriendDogId ?? null,
  mannersActivityName: entry.mannersActivityName ?? "",
  mannersEvaluation: entry.mannersEvaluation ?? null,
  physicalActivityName: entry.physicalActivityName ?? "",
  physicalEvaluation: entry.physicalEvaluation ?? null,
  teacherComment: entry.teacherComment ?? "",
});

export function buildJournalPreviewViewModel(
  entry: JournalRosterEntry,
  draft: JournalDraft,
  rosterEntries: JournalRosterEntry[] = [],
): JournalPreviewViewModel {
  return {
    entryId: entry.id,
    businessDate: entry.businessDate,
    displayDate: entry.businessDate.replaceAll("-", "."),
    dogName: entry.dog.name,
    customerName: entry.customer.name,
    status: entry.status,
    conditionOptions: selectedOptions(conditionOptions, draft.conditionCodes),
    urinationOptions: binaryOptions(draft.urination),
    defecationOptions: binaryOptions(draft.defecation),
    stoolOptions: singleOptions(stoolOptions, draft.defecation === true ? draft.stoolCondition : null),
    mealOptions: selectedOptions(mealOptions, draft.mealCodes),
    teacherRelationshipOptions: singleOptions(teacherRelationshipOptions, draft.teacherRelationship),
    friendRelationshipOptions: singleOptions(friendRelationshipOptions, draft.friendRelationship),
    bestFriendName: rosterEntries.find((item) => item.dog.id === draft.bestFriendDogId)?.dog.name ?? null,
    manners: { title: "예절교육", activityName: draft.mannersActivityName, options: singleOptions(mannersOptions, draft.mannersEvaluation) },
    physical: { title: "체육 시간", activityName: draft.physicalActivityName, options: singleOptions(physicalOptions, draft.physicalEvaluation) },
    teacherComment: draft.teacherComment,
  };
}
