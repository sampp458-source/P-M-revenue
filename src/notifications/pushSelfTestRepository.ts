import { supabase } from "../lib/supabase";
export type SelfTestContext = { allowed: boolean; blocked?: string; subscription?: { id: string; binding_id: string; provider: string; last_seen_at: string }; latest?: SelfTestResult | null };
export type SelfTestResult = { request_id: string; notification_id: string; delivery_id: string; status: string; created_at: string; sent_at: string | null; last_error: string | null };
async function call<T>(name: string, args = {}): Promise<T> {
 const {data,error} = await supabase.rpc(name,args);
 if(error) throw new Error(error.code === "42501" ? "관리자 본인만 실행할 수 있습니다." : error.message === "SELF_TEST_RATE_LIMIT" ? "5분에 1회, 하루 최대 3회만 보낼 수 있습니다." : error.message === "SELF_TEST_SUBSCRIPTION_CHANGED" ? "기기 연결이 변경됐습니다. 다시 확인해 주세요." : "발송 결과가 불확실합니다. 같은 요청의 결과를 먼저 확인해 주세요.");
 return data as T;
}
export const adminPushSelfTest = {
 context: () => call<SelfTestContext>("get_admin_push_self_test_v1"),
 send: (requestId: string, subscriptionId: string, bindingId: string) => call<SelfTestResult>("send_admin_push_self_test_v1", {p_request_id:requestId,p_subscription_id:subscriptionId,p_binding_id:bindingId}),
};
