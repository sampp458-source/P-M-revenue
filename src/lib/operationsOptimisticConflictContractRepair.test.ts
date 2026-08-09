import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/202608090001_operations_optimistic_conflict_contract_repair.sql",
);
const preflight = read(
  "supabase/verification/202608090001_operations_optimistic_conflict_contract_repair_preflight.sql",
);
const postflight = read(
  "supabase/verification/202608090001_operations_optimistic_conflict_contract_repair_postflight.sql",
);
const rollback = read(
  "supabase/verification/202608090001_operations_optimistic_conflict_contract_repair_rollback.sql",
);

const targetIdentity = "set_operation_schedule_status(uuid,integer,text,text,uuid)";

describe("Operations optimistic conflict contract repair", () => {
  it("targets only the failing schedule status contract", () => {
    expect(migration).toContain(`public.${targetIdentity}`);
    expect(migration).not.toMatch(/public\.(archive_operation_schedule|update_operation_schedule|set_operation_member_role|set_operation_member_schedule_color|complete_hotel_check_out|reverse_hotel_completion)\(/);
  });

  it("replaces only the guarded manual optimistic conflict SQLSTATE", () => {
    expect(migration).toContain("'using errcode = ''40001'''");
    expect(migration).toContain("'using errcode = ''PT409'''");
    expect(migration).not.toContain("replace(source_before, '40001', 'PT409')");
    expect(preflight).toContain(
      "READY_TO_APPLY_OPERATIONS_OPTIMISTIC_CONFLICT_CONTRACT_REPAIR",
    );
    expect(postflight).toContain(
      "OPERATIONS_OPTIMISTIC_CONFLICT_CONTRACT_REPAIR_READY",
    );
  });

  it("preserves exact metadata, ACL variants, and frozen contracts", () => {
    for (const source of [preflight, postflight]) {
      expect(source).toContain("array['authenticated','postgres','service_role']");
      expect(source).toContain("a5deae851384be64c4a6df9a193269a5");
      expect(source).toContain("7744baa7276dcb70676ec593e8ddc0e6");
      expect(source).toContain("dd4dd04865adfa2dc3ec83097e2b81a3");
      expect(source).toContain("7dac53943e2f74f207de1cd36d5023fb");
    }
  });

  it("can restore only the prior 40001 variant", () => {
    expect(rollback).toContain(`public.${targetIdentity}`);
    expect(rollback).toContain("'using errcode = ''PT409'''");
    expect(rollback).toContain("'using errcode = ''40001'''");
  });
});
