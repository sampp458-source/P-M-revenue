interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  name?: string;
}

export function logSupabaseError(
  context: string,
  error: SupabaseErrorLike,
  status?: number,
) {
  if (!import.meta.env.DEV) return;

  console.error(`[Supabase] ${context}`, {
    status,
    code: error.code,
    name: error.name,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

export function partyMutationError(
  error: SupabaseErrorLike,
  fallback: string,
) {
  const message = error.message ?? "";

  if (message.includes("승인된 활성 계정")) {
    return "승인되지 않았거나 비활성 처리된 계정입니다.";
  }
  if (message.includes("다른 직원")) {
    return "다른 직원이 등록한 매출은 수정할 수 없습니다.";
  }
  if (message.includes("마감된 월")) {
    return "마감된 월의 매출은 수정할 수 없습니다.";
  }
  if (message.includes("정상 상태")) {
    return "취소 또는 환불 처리된 매출의 고객 정보는 변경할 수 없습니다.";
  }
  if (
    message.includes("보호자") ||
    message.includes("반려견") ||
    message.includes("연결 정보")
  ) {
    return message;
  }
  if (error.code === "42501") {
    return "현재 계정의 업무 권한을 확인할 수 없습니다. 계정 상태를 확인해 주세요.";
  }

  return fallback;
}
