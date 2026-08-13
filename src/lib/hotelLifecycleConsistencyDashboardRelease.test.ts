import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const prefix="supabase/verification/202608130005_hotel_lifecycle_consistency";
const migration=read("supabase/migrations/202608130005_hotel_lifecycle_consistency.sql");
const preflight=read(`${prefix}_production_preflight.sql`);
const postflight=read(`${prefix}_production_postflight.sql`);
const dashboard={
  preflight:read(`${prefix}_dashboard_preflight.sql`),
  migration:read(`${prefix}_dashboard_migration.sql`),
  postflight:read(`${prefix}_dashboard_postflight.sql`),
};
const migrationSha="5012670da85361cbfdccbf835722cd1f82065292a90f666a88c7113dbbc9aa03";

function sourceBody(sql:string,start:string,end:string){
  return sql.slice(sql.indexOf(`${start}\n`)+start.length+1,sql.lastIndexOf(`\n${end}`));
}
function dashboardBody(sql:string,phase:string){
  const start=`-- APPROVED_SOURCE_BODY_BEGIN: ${phase}\n`;
  const end=`\n-- APPROVED_SOURCE_BODY_END: ${phase}`;
  return sql.slice(sql.indexOf(start)+start.length,sql.lastIndexOf(end));
}

describe("Hotel lifecycle Production Dashboard release",()=>{
  it("pins the approved migration and embeds every source body byte-for-byte",()=>{
    expect(sha(migration)).toBe(migrationSha);
    expect(dashboardBody(dashboard.preflight,"PREFLIGHT")).toBe(sourceBody(preflight,"begin read only;","rollback;"));
    expect(dashboardBody(dashboard.migration,"MIGRATION")).toBe(sourceBody(migration,"begin;","commit;"));
    expect(dashboardBody(dashboard.postflight,"POSTFLIGHT")).toBe(sourceBody(postflight,"begin read only;","rollback;"));
  });
  it("hard-binds Production, rejects Clean QA, and keeps verification read-only",()=>{
    for(const sql of Object.values(dashboard)){
      expect(sql).toContain("zorvcuskzemehblqdbfj");
      expect(sql).toContain("wxbvwixoeczfvbqurdse");
      expect(sql).toContain(migrationSha);
      expect(sql).toContain("current_database()<>'postgres'");
      expect(sql).toContain("current_user<>'postgres'");
      expect(sql).toContain("hotel_qa.environment_guard");
      expect(sql).not.toMatch(/postgres(?:ql)?:\/\//i);
      expect(sql).not.toMatch(/^\+/m);
    }
    expect(dashboard.preflight).toContain("begin read only;");
    expect(dashboard.postflight).toContain("begin read only;");
    expect(dashboard.preflight.trim()).toMatch(/rollback;$/);
    expect(dashboard.postflight.trim()).toMatch(/rollback;$/);
    expect(dashboard.migration.trim()).toMatch(/commit;$/);
  });
  it("preserves lifecycle, ACL, calendar projection, and frozen Hotel assertions",()=>{
    expect(dashboard.preflight).toContain("READY_TO_APPLY_HOTEL_LIFECYCLE_CONSISTENCY");
    expect(dashboard.postflight).toContain("HOTEL_LIFECYCLE_CONSISTENCY_READY");
    expect(dashboard.postflight).toContain("STOP_HOTEL_LIFECYCLE_RPC_ACL");
    expect(dashboard.postflight).toContain("STOP_HOTEL_LIFECYCLE_CALENDAR_PROJECTION");
    expect(dashboard.postflight).toContain("STOP_HOTEL_LIFECYCLE_FROZEN_HOTEL_DIFF");
  });
});
