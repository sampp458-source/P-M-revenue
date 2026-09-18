import { supabase } from "../lib/supabase";
import { type DogRemovalPreview } from "./dogHistoricalIdentityRepository";

const messages: Record<string, string> = {
  NOT_AUTHORIZED: "활성 직원 계정으로 로그인해 주세요.",
  DOG_NOT_FOUND: "이미 삭제되었거나 찾을 수 없는 반려견입니다.",
  DOG_BUSY: "다른 업무를 처리 중입니다. 연결 기록을 다시 확인해 주세요.",
  STALE_VERSION: "반려견 정보가 변경되었습니다. 다시 확인해 주세요.",
  STALE_PREVIEW: "연결된 업무가 변경되었습니다. 다시 확인해 주세요.",
  ACTIVE_OPERATION_EXISTS: "현재 진행 중인 업무가 있어 삭제할 수 없습니다.",
  HARD_DELETE_NOT_ELIGIBLE: "연결된 기록이 생겼습니다. 삭제 방법을 다시 확인해 주세요.",
  PROFILE_REMOVAL_NOT_ELIGIBLE: "프로필을 삭제할 수 없는 상태입니다. 다시 확인해 주세요.",
  INVALID_PROFILE_STATE: "현재 프로필 상태에서는 이 작업을 할 수 없습니다.",
  REQUEST_ID_CONFLICT: "요청 정보가 달라졌습니다. 창을 닫고 다시 확인해 주세요.",
  REFERENCE_CHECK_UNAVAILABLE: "연결 기록을 안전하게 확인하지 못했습니다. 삭제하지 않았습니다.",
};
export class DogRemovalFailure extends Error { constructor(message: string, readonly requiresRefresh: boolean) { super(message); } }
export function dogRemovalError(error: { message?: string; code?: string }): Error {
  return new DogRemovalFailure(messages[error.message ?? ""] ?? (error.code === "23503"
    ? messages.HARD_DELETE_NOT_ELIGIBLE : "처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도하거나 목록을 확인해 주세요."), Boolean(messages[error.message ?? ""]) || error.code === "23503");
}
export interface DogRemovalResult { dogId: string; mode: "hard_delete" | "profile_remove"; requestId: string }
export async function removeDogProfile(preview: DogRemovalPreview, requestId: string): Promise<DogRemovalResult> {
  if (!preview.commandAvailable || preview.version === null || !preview.proposedMode) throw new Error("연결 기록을 다시 확인해 주세요.");
  const { data, error } = await supabase.rpc("remove_dog_profile", {
    p_dog_id: preview.dog.recordDogId, p_expected_version: preview.version,
    p_expected_graph_fingerprint: preview.graphFingerprint, p_requested_mode: preview.proposedMode,
    p_request_id: requestId, p_reason: null,
  });
  if (error) throw dogRemovalError(error);
  if (data?.dogId !== preview.dog.recordDogId || data?.mode !== preview.proposedMode || data?.requestId !== requestId) {
    throw new Error("처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.");
  }
  return data as DogRemovalResult;
}
