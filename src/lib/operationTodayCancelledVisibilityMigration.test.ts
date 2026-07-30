import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/202607300003_operation_today_cancelled_visibility.sql",
  ),
  "utf8",
);

describe("Operations Today cancelled visibility migration", () => {
  it("keeps archived rows excluded while allowing cancelled rows", () => {
    expect(migration).toContain("schedule.archived_at is null");
    expect(migration).not.toContain("schedule.status <> 'cancelled'");
  });

  it("changes only the Operations Today read RPC", () => {
    expect(migration).toContain(
      "create or replace function public.get_operation_schedules_for_day",
    );
    expect(migration).not.toMatch(
      /\b(update|insert into|delete from|alter table)\s+public\./i,
    );
    expect(migration).not.toMatch(
      /\bpublic\.(sales|sale_payments|sale_refunds|profiles)\b/,
    );
  });
});
