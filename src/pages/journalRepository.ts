import { supabase } from "../lib/supabase";
import {
  JournalPersistenceError,
  classifyJournalPersistenceFailure,
  journalPersistenceErrorFromUnknown,
  type JournalPersistenceContext,
} from "./journalPersistenceDiagnostics";
import {
  canonicalJournalTeacherComment,
  JOURNAL_TEACHER_COMMENT_MAX_LENGTH,
  journalTeacherCommentLength,
} from "./journalTextNormalization";

export type JournalStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
export type JournalCondition = "active" | "calm" | "tired" | "sensitive";
export type JournalStoolCondition = "good" | "very_loose" | "slightly_loose" | "poor";
export type JournalMeal = "brought_food" | "daycare_food" | "brought_snack" | "daycare_snack";
export type JournalTeacherRelationship = "loves_teacher" | "prefers_friends" | "uncomfortable_with_teacher";
export type JournalFriendRelationship = "loves_friends" | "prefers_teacher" | "uncomfortable_with_friends";
export type JournalMannersEvaluation = "excellent" | "can_improve" | "difficult";
export type JournalPhysicalEvaluation = "champion" | "fun" | "rest";
export type JournalBestFriendTarget =
  | { type: "DOG"; dogId: string }
  | { type: "TEACHER"; dogId: null };

export interface JournalDraft {
  conditionCodes: JournalCondition[];
  urination: boolean | null;
  defecation: boolean | null;
  stoolCondition: JournalStoolCondition | null;
  mealCodes: JournalMeal[];
  teacherRelationship: JournalTeacherRelationship | null;
  friendRelationship: JournalFriendRelationship | null;
  /** V2 canonical field. The legacy field remains optional for rollback/test fixture normalization only. */
  bestFriendTargets?: JournalBestFriendTarget[];
  bestFriendDogId?: string | null;
  mannersActivityName: string;
  mannersEvaluation: JournalMannersEvaluation | null;
  physicalActivityName: string;
  physicalEvaluation: JournalPhysicalEvaluation | null;
  teacherComment: string;
}

export interface JournalRosterEntry {
  id: string;
  journalDayId: string;
  businessDate: string;
  dog: { id: string; name: string };
  customer: { id: string; name: string | null };
  status: JournalStatus;
  conditionCodes: JournalCondition[];
  urination: boolean | null;
  defecation: boolean | null;
  stoolCondition: JournalStoolCondition | null;
  mealCodes: JournalMeal[];
  teacherRelationship: JournalTeacherRelationship | null;
  friendRelationship: JournalFriendRelationship | null;
  bestFriendDogId: string | null;
  bestFriendTargets?: JournalBestFriendTarget[];
  mannersActivityName: string | null;
  mannersEvaluation: JournalMannersEvaluation | null;
  physicalActivityName: string | null;
  physicalEvaluation: JournalPhysicalEvaluation | null;
  teacherComment: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface JournalRoster {
  businessDate: string;
  journalDayId: string | null;
  defaults: {
    mannersActivityName: string | null;
    physicalActivityName: string | null;
    version: number | null;
  };
  summary: {
    total: number;
    notStarted: number;
    inProgress: number;
    completed: number;
  };
  entries: JournalRosterEntry[];
}

export interface JournalDirectoryDog {
  id: string;
  name: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  breed: string | null;
}

export class JournalRepositoryError extends Error {
  constructor(message: string, readonly kind: "permission" | "conflict" | "validation" | "unavailable") {
    super(message);
    this.name = "JournalRepositoryError";
  }
}

export function normalizedJournalBestFriendTargets(draft: Pick<JournalDraft, "bestFriendTargets" | "bestFriendDogId">) {
  if (draft.bestFriendTargets) return draft.bestFriendTargets;
  return draft.bestFriendDogId ? [{ type: "DOG" as const, dogId: draft.bestFriendDogId }] : [];
}

type SupabaseErrorMetadata = { code?: string; message?: string; details?: string; hint?: string };

const throwError = (error: SupabaseErrorMetadata | null) => {
  if (!error) return;
  if (error.code === "PT409" || error.code === "40001") {
    throw new JournalRepositoryError("다른 직원이 먼저 변경했습니다. 최신 명단을 불러왔습니다.", "conflict");
  }
  if (error.code === "42501") {
    throw new JournalRepositoryError("일지 명단을 관리할 권한이 없습니다.", "permission");
  }
  if (["22023", "23505", "P0002"].includes(error.code ?? "")) {
    throw new JournalRepositoryError(error.message || "일지 명단 요청을 확인해 주세요.", "validation");
  }
  throw new JournalRepositoryError("일지 명단을 불러오지 못했습니다.", "unavailable");
};

async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  persistenceContext?: JournalPersistenceContext,
) {
  try {
    const request = supabase.rpc(name, args);
    const result = signal ? await request.abortSignal(signal) : await request;
    if (result.error && persistenceContext) {
      throw new JournalPersistenceError(
        classifyJournalPersistenceFailure(result.error, result.status),
        persistenceContext.operation,
        persistenceContext.entryId,
        persistenceContext.entryStatus,
        persistenceContext.expectedVersion,
        persistenceContext.requestId,
        {
          httpStatus: result.status,
          postgresCode: result.error.code,
          message: result.error.message,
          details: result.error.details,
          hint: result.error.hint,
        },
      );
    }
    throwError(result.error);
    return result.data as T;
  } catch (error) {
    if (!persistenceContext || error instanceof JournalPersistenceError) throw error;
    throw journalPersistenceErrorFromUnknown(error, persistenceContext);
  }
}

export function fetchJournalRoster(businessDate: string) {
  return rpc<JournalRoster>("get_journal_roster", { p_business_date: businessDate });
}

export function registerJournalRoster(
  businessDate: string,
  dogIds: string[],
  defaults: { mannersActivityName: string; physicalActivityName: string; expectedVersion: number | null },
  requestId = crypto.randomUUID(),
) {
  return rpc<JournalRoster>("register_journal_roster_v2", {
    p_business_date: businessDate,
    p_dog_ids: dogIds,
    p_default_manners_activity: defaults.mannersActivityName || null,
    p_default_physical_activity: defaults.physicalActivityName || null,
    p_expected_defaults_version: defaults.expectedVersion,
    p_request_id: requestId,
  });
}

export function updateJournalDayDefaultActivities(
  journalDayId: string,
  expectedVersion: number,
  defaults: { mannersActivityName: string; physicalActivityName: string },
  requestId = crypto.randomUUID(),
) {
  return rpc<JournalRoster>("update_journal_day_default_activities", {
    p_journal_day_id: journalDayId,
    p_expected_version: expectedVersion,
    p_default_manners_activity: defaults.mannersActivityName || null,
    p_default_physical_activity: defaults.physicalActivityName || null,
    p_request_id: requestId,
  });
}

export function removeJournalRosterEntry(entryId: string, expectedVersion: number, requestId = crypto.randomUUID()) {
  return rpc<JournalRoster>("remove_journal_roster_entry", {
    p_entry_id: entryId,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
}

export function fetchJournalEntry(entryId: string) {
  return rpc<JournalRosterEntry>("get_journal_entry", { p_entry_id: entryId });
}

export function updateJournalEntryDraft(
  entryId: string,
  expectedVersion: number,
  draft: JournalDraft,
  requestId: string = crypto.randomUUID(),
  signal?: AbortSignal,
  entryStatus: JournalStatus = "IN_PROGRESS",
) {
  const persistenceContext: JournalPersistenceContext = {
    operation: "update_journal_entry_draft",
    entryId,
    entryStatus,
    expectedVersion,
    requestId,
  };
  const teacherComment = canonicalJournalTeacherComment(draft.teacherComment);
  if (journalTeacherCommentLength(teacherComment) > JOURNAL_TEACHER_COMMENT_MAX_LENGTH) {
    throw new JournalPersistenceError(
      "VALIDATION",
      persistenceContext.operation,
      persistenceContext.entryId,
      persistenceContext.entryStatus,
      persistenceContext.expectedVersion,
      persistenceContext.requestId,
      { postgresCode: "22023", message: "일지 입력값을 확인해 주세요." },
    );
  }
  return rpc<JournalRosterEntry>("update_journal_entry_draft_v2", {
    p_entry_id: entryId,
    p_expected_version: expectedVersion,
    p_condition_codes: draft.conditionCodes,
    p_urination: draft.urination,
    p_defecation: draft.defecation,
    p_stool_condition: draft.defecation ? draft.stoolCondition : null,
    p_meal_codes: draft.mealCodes,
    p_teacher_relationship: draft.teacherRelationship,
    p_friend_relationship: draft.friendRelationship,
    p_best_friend_targets: normalizedJournalBestFriendTargets(draft),
    p_manners_activity_name: draft.mannersActivityName || null,
    p_manners_evaluation: draft.mannersEvaluation,
    p_physical_activity_name: draft.physicalActivityName || null,
    p_physical_evaluation: draft.physicalEvaluation,
    p_teacher_comment: teacherComment || null,
    p_request_id: requestId,
  }, signal, persistenceContext);
}

export function completeJournalEntry(
  entryId: string,
  expectedVersion: number,
  requestId = crypto.randomUUID(),
) {
  return rpc<JournalRosterEntry>("complete_journal_entry", {
    p_entry_id: entryId,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
}

export async function fetchJournalDogDirectory(): Promise<JournalDirectoryDog[]> {
  const [dogResult, customerResult] = await Promise.all([
    supabase.from("dogs").select("id,name,customer_id,breed,is_active").eq("is_active", true).order("name"),
    supabase.from("customers").select("id,name,phone,is_active").eq("is_active", true).order("name"),
  ]);
  throwError(dogResult.error ?? customerResult.error);
  const customers = new Map((customerResult.data ?? []).map((row) => [row.id, row]));
  return (dogResult.data ?? []).flatMap((dog) => {
    const customer = dog.customer_id ? customers.get(dog.customer_id) : null;
    if (!customer) return [];
    return [{
      id: dog.id,
      name: dog.name,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      breed: dog.breed,
    }];
  });
}
