import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607280003_customer_master_address.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

const dogManagement = readFileSync(
  new URL("../pages/DogManagement.tsx", import.meta.url),
  "utf8",
);
const dogProfile = readFileSync(
  new URL("../pages/DogProfileModal.tsx", import.meta.url),
  "utf8",
);

const customerList = readFileSync(
  new URL("../pages/Pets.tsx", import.meta.url),
  "utf8",
);

describe("customer editing inside pet workflow", () => {
  it("adds only the shared optional address field", () => {
    expect(migration).toContain(
      "alter table public.customers\n  add column if not exists address text null",
    );
    expect(migration).toContain(
      "202607280002_customer_master_editing.sql",
    );
    expect(migration).not.toMatch(/\b(update|alter table)\s+public\.sales\b/);
    expect(migration).not.toContain("sale_payments");
    expect(migration).not.toContain("sale_refunds");
  });

  it("edits the selected Customer Master without leaving the pet screen", () => {
    expect(dogProfile).toContain("보호자 정보");
    expect(dogProfile).toContain("onEditOwner");
    expect(dogManagement).toContain("보호자 정보 수정");
    expect(dogManagement).toContain('label="주소"');
    expect(dogManagement).toContain('.from("customers")');
    expect(dogManagement).toContain(".update(values)");
    expect(dogManagement).toContain("setDogs((current)");
    expect(dogManagement).not.toContain("보호자 수정 권한이 없습니다.");
  });

  it("keeps address available in the shared customer list editor", () => {
    expect(customerList).toContain(
      "id, name, phone, address, memo, is_active",
    );
    expect(customerList).toContain('label="주소"');
    expect(customerList).toContain(
      "address: form.address.trim() || null",
    );
  });
});
