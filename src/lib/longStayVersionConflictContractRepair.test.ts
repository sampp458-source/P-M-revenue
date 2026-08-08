import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/202608080002_long_stay_version_conflict_contract_repair.sql",
);
const preflight = read(
  "supabase/verification/202608080002_long_stay_version_conflict_contract_repair_preflight.sql",
);
const postflight = read(
  "supabase/verification/202608080002_long_stay_version_conflict_contract_repair_postflight.sql",
);
const rollback = read(
  "supabase/verification/202608080002_long_stay_version_conflict_contract_repair_rollback.sql",
);

const targetFunctions = [
  "confirm_long_stay_month",
  "complete_long_stay_check_in",
  "start_long_stay_absence",
  "complete_long_stay_absence",
  "set_long_stay_planned_checkout",
  "complete_long_stay_check_out",
  "reverse_long_stay_completion",
];

describe("Long Stay version-conflict contract repair", () => {
  it("targets exactly the seven approved Long Stay commands", () => {
    targetFunctions.forEach((name) => expect(migration).toContain(`public.${name}(`));
    expect(migration).not.toMatch(/public\.(create_long_stay_contract|get_long_stay_contract|get_customer_long_stays|get_long_stay_month)\(/);
    expect(migration).not.toMatch(/public\.(complete_hotel_check_out|reverse_hotel_completion|get_hotel_operations_snapshot_v2)\(/);
  });

  it("moves only manual optimistic conflicts from 40001 to PT409", () => {
    expect(migration).toContain("'using errcode=''40001'''");
    expect(migration).toContain("'using errcode=''PT409'''");
    expect(migration).not.toContain("replace(source_before, '40001', 'PT409')");
    expect(preflight).toContain("READY_TO_APPLY_LONG_STAY_VERSION_CONFLICT_CONTRACT_REPAIR");
    expect(postflight).toContain("LONG_STAY_VERSION_CONFLICT_CONTRACT_REPAIR_READY");
  });

  it("preserves exact public metadata and frozen Hotel contracts", () => {
    for (const source of [preflight, postflight]) {
      expect(source).toContain("array['authenticated','postgres','service_role']");
      expect(source).toContain("p.prosecdef");
      expect(source).toContain("search_path=public, pg_temp");
      expect(source).toContain("7744baa7276dcb70676ec593e8ddc0e6");
      expect(source).toContain("dd4dd04865adfa2dc3ec83097e2b81a3");
      expect(source).toContain("7dac53943e2f74f207de1cd36d5023fb");
    }
  });

  it("can restore the exact prior SQLSTATE variant", () => {
    expect(rollback).toContain("'using errcode=''PT409'''");
    expect(rollback).toContain("'using errcode=''40001'''");
    targetFunctions.forEach((name) => expect(rollback).toContain(`public.${name}(`));
  });
});
