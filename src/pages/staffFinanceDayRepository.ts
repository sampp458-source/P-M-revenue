import { supabase } from "../lib/supabase";

export interface StaffFinanceDayPayload {
  sales: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  refunds: Record<string, unknown>[];
}

const missingRpc = (error: { code?: string; message?: string } | null) =>
  Boolean(
    error &&
      (error.code === "42883" ||
        error.code === "PGRST202" ||
        error.message?.includes("schema cache")),
  );

export async function fetchStaffFinanceDay(
  date: string,
): Promise<StaffFinanceDayPayload> {
  const rpcResult = await supabase.rpc("get_staff_finance_day", {
    p_date: date,
  });
  if (!rpcResult.error) {
    const payload = (rpcResult.data ?? {}) as Partial<StaffFinanceDayPayload>;
    return {
      sales: payload.sales ?? [],
      payments: payload.payments ?? [],
      refunds: payload.refunds ?? [],
    };
  }
  if (!missingRpc(rpcResult.error)) throw rpcResult.error;

  // Migration 적용 전 호환 경로도 서버 날짜 조건을 사용한다.
  const [dayPayments, dayRefunds] = await Promise.all([
    supabase
      .from("sale_payments")
      .select("*")
      .eq("payment_date", date)
      .is("voided_at", null),
    supabase
      .from("sale_refunds")
      .select("*")
      .eq("refund_date", date)
      .is("voided_at", null),
  ]);
  if (dayPayments.error) throw dayPayments.error;
  if (dayRefunds.error) throw dayRefunds.error;

  const eventSaleIds = [
    ...new Set(
      [...(dayPayments.data ?? []), ...(dayRefunds.data ?? [])].map(
        (row) => row.sale_id as string,
      ),
    ),
  ];
  let salesQuery = supabase.from("sales").select("*");
  salesQuery = eventSaleIds.length
    ? salesQuery.or(
        `sale_date.eq.${date},id.in.(${eventSaleIds.join(",")})`,
      )
    : salesQuery.eq("sale_date", date);
  const salesResult = await salesQuery
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (salesResult.error) throw salesResult.error;

  const saleIds = (salesResult.data ?? []).map((row) => row.id as string);
  if (!saleIds.length) return { sales: [], payments: [], refunds: [] };

  const [paymentsResult, refundsResult] = await Promise.all([
    supabase.from("sale_payments").select("*").in("sale_id", saleIds),
    supabase.from("sale_refunds").select("*").in("sale_id", saleIds),
  ]);
  if (paymentsResult.error) throw paymentsResult.error;
  if (refundsResult.error) throw refundsResult.error;
  return {
    sales: (salesResult.data ?? []) as Record<string, unknown>[],
    payments: (paymentsResult.data ?? []) as Record<string, unknown>[],
    refunds: (refundsResult.data ?? []) as Record<string, unknown>[],
  };
}
