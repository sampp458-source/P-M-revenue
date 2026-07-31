import { supabase } from "../lib/supabase";

export interface StaffFinanceDayPayload {
  sales: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  refunds: Record<string, unknown>[];
}

export async function fetchStaffFinanceDay(
  date: string,
): Promise<StaffFinanceDayPayload> {
  const rpcResult = await supabase.rpc("get_staff_finance_day", {
    p_date: date,
  });
  if (rpcResult.error) throw rpcResult.error;

  const payload = (rpcResult.data ?? {}) as Partial<StaffFinanceDayPayload>;
  return {
    sales: payload.sales ?? [],
    payments: payload.payments ?? [],
    refunds: payload.refunds ?? [],
  };
}
