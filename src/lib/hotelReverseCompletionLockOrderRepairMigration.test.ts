import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read(
  "supabase/migrations/202608040004_hotel_reverse_completion_lock_order_repair.sql",
).toLowerCase();
const preflight = read(
  "supabase/verification/202608040004_hotel_reverse_completion_lock_order_repair_preflight.sql",
).toLowerCase();
const postflight = read(
  "supabase/verification/202608040004_hotel_reverse_completion_lock_order_repair_postflight.sql",
).toLowerCase();
const rollback = read(
  "supabase/verification/202608040004_hotel_reverse_completion_lock_order_repair_rollback.sql",
).toLowerCase();
const flexiblePreflight = read(
  "supabase/verification/202608040002_hotel_flexible_reservations_preflight.sql",
).toLowerCase();

function functionBody(source: string) {
  const start = source.indexOf("function public.reverse_hotel_completion");
  const dollarTag = source.indexOf("$function$", start) >= 0
    ? "$function$"
    : "$$";
  const bodyStart = source.indexOf(dollarTag, start);
  const end = source.indexOf(dollarTag, bodyStart + dollarTag.length)
    + dollarTag.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(bodyStart).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const repairedBody = functionBody(migration);
const rollbackBody = functionBody(rollback);
const addedLockBlock = [
  "\n    -- global advisory lock order: room type -> room -> total capacity.",
  "\n    -- the existing room assertion below reuses this transaction-level lock.",
  "\n    perform pg_advisory_xact_lock(",
  "\n      hashtextextended(",
  "\n        'hotel-room:' || final_allocation.room_id::text,",
  "\n        0",
  "\n      )",
  "\n    );\n",
].join("");

describe("reverse_hotel_completion lock-order repair", () => {
  it("adds only the early room advisory lock", () => {
    expect(repairedBody).toContain(addedLockBlock);
    const withoutAddedLock = repairedBody.replace(addedLockBlock, "");
    expect(withoutAddedLock).toBe(rollbackBody);
  });

  it("changes Type -> Total -> Room into Type -> Room -> Total", () => {
    expect(rollbackBody.indexOf("assert_hotel_capacity_available")).toBeLessThan(
      rollbackBody.indexOf("update public.hotel_capacity_reservations"),
    );
    expect(rollbackBody.indexOf("update public.hotel_capacity_reservations")).toBeLessThan(
      rollbackBody.indexOf("assert_hotel_room_allocation_available"),
    );
    expect(repairedBody.indexOf("assert_hotel_capacity_available")).toBeLessThan(
      repairedBody.indexOf("hotel-room:"),
    );
    expect(repairedBody.indexOf("hotel-room:")).toBeLessThan(
      repairedBody.indexOf("update public.hotel_capacity_reservations"),
    );
  });

  it("preserves signature, permissions and execution properties", () => {
    [migration, rollback].forEach((source) => {
      expect(source).toContain("p_completion_kind text");
      expect(source).toContain("p_reason text");
      expect(source).toContain("security definer");
      expect(source).toContain("set search_path to 'public', 'pg_temp'");
    });
    expect(preflight).toContain("authenticated_execute_ready");
    expect(postflight).toContain("authenticated_execute_preserved");
  });

  it("uses exact before/after fingerprints and exact rollback body", () => {
    expect(preflight).toContain("a694cfa7ab7ed47afdc2fcae44a2f87d");
    expect(migration).toContain("a694cfa7ab7ed47afdc2fcae44a2f87d");
    expect(postflight).toContain("dd4dd04865adfa2dc3ec83097e2b81a3");
    expect(rollback).toContain("dd4dd04865adfa2dc3ec83097e2b81a3");
  });

  it("makes the repaired version a prerequisite for Flexible migration", () => {
    expect(flexiblePreflight).toContain("legacy_reverse_lock_repair_version_ready");
    expect(flexiblePreflight).toContain("dd4dd04865adfa2dc3ec83097e2b81a3");
  });
});
