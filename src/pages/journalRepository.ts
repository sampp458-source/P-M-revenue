import { supabase } from "../lib/supabase";

export type JournalStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export interface JournalRosterEntry {
  id: string;
  journalDayId: string;
  businessDate: string;
  dog: { id: string; name: string };
  customer: { id: string; name: string | null };
  status: JournalStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface JournalRoster {
  businessDate: string;
  journalDayId: string | null;
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

const throwError = (error: { code?: string; message?: string } | null) => {
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

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const result = await supabase.rpc(name, args);
  throwError(result.error);
  return result.data as T;
}

export function fetchJournalRoster(businessDate: string) {
  return rpc<JournalRoster>("get_journal_roster", { p_business_date: businessDate });
}

export function registerJournalRoster(businessDate: string, dogIds: string[], requestId = crypto.randomUUID()) {
  return rpc<JournalRoster>("register_journal_roster", {
    p_business_date: businessDate,
    p_dog_ids: dogIds,
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
