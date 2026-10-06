import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../pages/StaffManagement.tsx", import.meta.url),
  "utf8",
);

describe("Staff Operations role management UI", () => {
  it("reads and updates Operations roles through dedicated RPCs", () => {
    expect(source).toContain('supabase.rpc("get_operation_membership_directory")');
    expect(source).toContain('supabase.rpc("set_operation_member_role"');
    expect(source).not.toContain('.from("operation_memberships").update');
  });

  it("keeps Finance and Operations roles visually separate", () => {
    expect(source).toContain("Finance 역할");
    expect(source).toContain("운영 권한");
    expect(source).toContain('title="운영 권한 설정"');
    expect(source).toContain("최고 관리자");
    expect(source).toContain("관리자");
    expect(source).toContain("직원");
    expect(source).not.toContain("({role})");
  });

  it("uses a compact master/detail directory with preserved date history", () => {
    expect(source).toContain("<StaffDirectory");
    expect(source).toContain("staff-facts");
    expect(source).toContain("DateTimeCell");
    expect(source).toContain('aria-label="운영 권한"');
  });

  it("does not mislabel a failed directory request as a missing membership", () => {
    expect(source).toContain("권한 조회 실패");
    expect(source).toContain("operationLoadError ?");
    expect(source).toContain("!operationLoadError && canManageOperationRoles");
  });
});
