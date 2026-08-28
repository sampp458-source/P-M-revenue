import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(resolve(root, "supabase/migrations/202608270001_journal_best_friend_v2.sql"), "utf8");
const preflight = readFileSync(resolve(root, "supabase/verification/202608270001_journal_best_friend_v2_preflight.sql"), "utf8");
const postflight = readFileSync(resolve(root, "supabase/verification/202608270001_journal_best_friend_v2_postflight.sql"), "utf8");
const repairedMigrationSha = "24e549cc8381a0c73b7ddf2fe50e6af1f888544b49fbcadf3fd433b0e5ccbc6d";

describe("Journal Best Friend V2 migration", () => {
  it("creates an explicit ordered DOG/TEACHER target domain without sentinel Dogs", () => {
    expect(migration).toContain("create table public.journal_entry_best_friend_targets");
    expect(migration).toContain("target_type text not null check (target_type in ('DOG','TEACHER'))");
    expect(migration).toContain("(target_type='TEACHER' and dog_id is null)");
    expect(migration).toContain("sort_order between 0 and 4");
    expect(migration).not.toMatch(/sentinel|fake dog/i);
  });

  it("backfills and retains the legacy field as a first-DOG projection", () => {
    expect(migration).toContain("where entry.best_friend_dog_id is not null");
    expect(migration).toContain("best_friend_dog_id=legacy_projection");
    expect(migration).not.toContain("drop column best_friend_dog_id");
    expect(migration).toContain("Fail-closed compatibility bridge");
  });

  it("fails closed instead of silently downgrading canonical multi-target or Teacher state", () => {
    expect(migration).toContain("canonical_target_count>1 or canonical_has_teacher");
    expect(migration).toContain("최신 제일 친한 친구 정보를 다시 불러온 뒤 저장해 주세요.");
    expect(migration).toContain("using errcode='PT409'");
    expect(migration).toContain("effective_targets:=replay_targets");

    const legacySave = (existing: Array<"DOG" | "TEACHER">, requestedDog: string | null) =>
      existing.length > 1 || existing.includes("TEACHER")
        ? { outcome: "CONFLICT", preserved: existing }
        : { outcome: "SAVED", preserved: requestedDog ? ["DOG"] : [] };

    expect(legacySave(["DOG", "DOG"], "dog-a")).toEqual({ outcome: "CONFLICT", preserved: ["DOG", "DOG"] });
    expect(legacySave(["DOG", "TEACHER"], "dog-a")).toEqual({ outcome: "CONFLICT", preserved: ["DOG", "TEACHER"] });
    expect(legacySave(["TEACHER"], null)).toEqual({ outcome: "CONFLICT", preserved: ["TEACHER"] });
    expect(legacySave(["DOG"], "dog-b")).toEqual({ outcome: "SAVED", preserved: ["DOG"] });
    expect(legacySave([], null)).toEqual({ outcome: "SAVED", preserved: [] });
  });

  it("keeps save atomic, versioned, idempotent, audited, and roster constrained", () => {
    expect(migration).toContain("create function public.update_journal_entry_draft_v2");
    expect(migration).toContain("for update");
    expect(migration).toContain("errcode='PT409'");
    expect(migration).toContain("hashtextextended(p_request_id::text,0)");
    expect(migration).toContain("같은 날 등원 명단의 반려견만 선택할 수 있습니다.");
    expect(migration).toContain("같은 제일 친한 친구 대상을 중복 선택할 수 없습니다.");
    expect(migration).toContain("제일 친한 친구는 최대 5명까지 선택할 수 있습니다.");
    expect(migration).toContain("Journal completed entry updated");
    expect(migration).toContain("journal_entry_json_internal(p_entry_id)");
    expect(migration).toContain("before_data,after_data,changed_by,change_reason,request_id");
  });

  it("keeps the canonical 500-character Teacher Comment server boundary", () => {
    expect(migration).toContain("normalized_comment text:=nullif(btrim(coalesce(p_teacher_comment,'')),'')");
    expect(migration).toContain("char_length(coalesce(normalized_comment,''))>500");
    expect(migration).toContain("teacher_comment=normalized_comment");
    expect(migration).toContain("p_physical_evaluation,p_teacher_comment,p_request_id");
  });

  it("removes only the deleted roster Dog target while preserving Teacher and parent status", () => {
    expect(migration).toContain("target.target_type='DOG' and target.dog_id=row_before.dog_id");
    expect(migration).toContain("best_friend_roster_member_removed");
    expect(migration).toContain("returning version into dependent_version_after");
    expect(migration).toContain("'status',dependent_before.status");
    expect(migration).not.toContain("set status=");
    expect(migration).not.toContain("delete from public.journal_days");
  });

  it("locks down direct writes and exposes only approved RPC principals", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.journal_entry_best_friend_targets from public,anon,authenticated");
    expect(migration).toContain("to authenticated,service_role");
    expect(postflight).toContain("array['authenticated','postgres','service_role']");
  });

  it("provides production hard-bound read-only release artifacts", () => {
    for (const artifact of [preflight, postflight]) {
      expect(artifact).toContain("begin read only;");
      expect(artifact).toContain("zorvcuskzemehblqdbfj");
      expect(artifact).toContain("wxbvwixoeczfvbqurdse");
      expect(artifact).toContain("rollback;");
      expect(artifact).not.toMatch(/^\s*(insert|update|delete|create|alter|drop|truncate)\s+/im);
      expect(artifact).toContain(repairedMigrationSha);
    }
  });

  it("normalizes every function-source postflight contract before semantic inspection", () => {
    expect(postflight).toContain("regexp_replace(lower(save_source),'[[:space:]]+','','g')");
    expect(postflight).toContain("regexp_replace(lower(legacy_source),'[[:space:]]+','','g')");
    expect(postflight).toContain("regexp_replace(lower(remove_source),'[[:space:]]+','','g')");
    expect(postflight).toContain("regexp_replace(lower(json_source),'[[:space:]]+','','g')");
    expect(postflight).toContain("position('forupdate' in save_contract)=0");
    expect(postflight).toContain("position('errcode=''pt409''' in save_contract)=0");
    expect(postflight).toContain("STOP_JOURNAL_BEST_FRIEND_V2_LEGACY_BRIDGE_CONTRACT");
    expect(postflight).toContain("STOP_JOURNAL_BEST_FRIEND_V2_READ_CONTRACT");
    expect(postflight).toContain("STOP_JOURNAL_BEST_FRIEND_V2_DELETE_CONTRACT");
  });
});
