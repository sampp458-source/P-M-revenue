import { supabase } from "../lib/supabase";

export interface StaffFinanceDayPayload {
  sales: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  refunds: Record<string, unknown>[];
  outstandingSales: StaffOutstandingSale[];
}

export interface StaffOutstandingSale {
  sale_id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  dog_id: string | null;
  dog_name: string | null;
  outstanding_amount: number;
  outstanding_date: string;
  business_unit_id: string;
  business_unit_name: string;
}

export async function fetchStaffFinanceDay(
  date: string,
): Promise<StaffFinanceDayPayload> {
  const rpcResult = await supabase.rpc("get_staff_finance_day", {
    p_date: date,
  });
  if (rpcResult.error) throw rpcResult.error;

  const payload = (rpcResult.data ?? {}) as Partial<StaffFinanceDayPayload>;
  const rawPayload = (rpcResult.data ?? {}) as Partial<
    StaffFinanceDayPayload & {
      outstanding_sales: StaffOutstandingSale[];
    }
  >;
  if (!Array.isArray(rawPayload.outstanding_sales)) {
    throw new Error("직원 미수 관리 데이터를 확인할 수 없습니다.");
  }
  return {
    sales: payload.sales ?? [],
    payments: payload.payments ?? [],
    refunds: payload.refunds ?? [],
    outstandingSales: rawPayload.outstanding_sales,
  };
}
