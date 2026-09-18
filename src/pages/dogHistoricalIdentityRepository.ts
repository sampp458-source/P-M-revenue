import { supabase } from "../lib/supabase";

export type DogProfileStatus = "active" | "inactive" | "removed" | "merged";
export interface HistoricalDogIdentity {
  recordDogId: string;
  displayName: string;
  nameSource: "dog_master";
  profileStatus: DogProfileStatus;
  canonicalDogId: string | null;
  profileReadable: boolean;
  customerId: string | null;
  breed: string | null;
  sex: "male" | "female" | null;
}
export interface DogRemovalPreview {
  dog: Pick<HistoricalDogIdentity, "recordDogId" | "displayName" | "customerId" | "profileStatus">;
  version: null;
  commandAvailable: false;
  contractVersion: "dog-profile-preview-v2a-1";
  categories: Array<{
    category: string;
    userVisibleCount: number;
    technicalReferenceCount: number;
    records: Array<{ recordId: string; dates: Record<string, unknown>; classification: "ALLOW" | "WARN" | "BLOCK" | "UNKNOWN" }>;
  }>;
  technicalReferenceCount: number;
  structuredIdentityTraceCount: number;
  activeBlockerCount: number;
  blockingReasonCodes: string[];
  warnings: string[];
  hardDeleteEligible: boolean;
  profileRemovalEligible: boolean;
  proposedMode: "hard_delete" | "profile_remove" | null;
  graphFingerprint: string;
  evaluatedAt: string;
  fingerprintUsage: "READ_ONLY_NOT_A_WRITE_TOKEN";
}

/** Historical references only. Never use this directory as new-operation options. */
export async function fetchHistoricalDogIdentities(dogIds: string[]): Promise<HistoricalDogIdentity[]> {
  const ids = [...new Set(dogIds)].sort();
  if (!ids.length) return [];
  const { data, error } = await supabase.rpc("get_historical_dog_identities", { p_dog_ids: ids });
  if (error) throw new Error("기록에 연결된 반려견 정보를 불러오지 못했습니다.", { cause: error });
  if (!Array.isArray(data) || data.length !== ids.length ||
      data.some((item) => !ids.includes(item.recordDogId) || typeof item.displayName !== "string") ||
      new Set(data.map((item) => item.recordDogId)).size !== ids.length) {
    throw new Error("기록에 연결된 반려견 정보를 확인할 수 없습니다.");
  }
  return data as HistoricalDogIdentity[];
}

/** Read-only preview. Does not replace or invoke the existing hard-delete flow. */
export async function previewDogProfileRemoval(dogId: string): Promise<DogRemovalPreview> {
  const { data, error } = await supabase.rpc("preview_dog_profile_removal", { p_dog_id: dogId });
  if (error) throw new Error("연결된 이용 기록을 확인하지 못했습니다.", { cause: error });
  if (!data || data.commandAvailable !== false || data.version !== null ||
      data.contractVersion !== "dog-profile-preview-v2a-1" || data.dog?.recordDogId !== dogId) {
    throw new Error("지원하지 않는 프로필 조회 응답입니다.");
  }
  return data as DogRemovalPreview;
}
