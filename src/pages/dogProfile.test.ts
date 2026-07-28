import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  activeDogActivities,
  dogUsageDateRange,
  mapDogProfileActivity,
  summarizeDogUsage,
  type DogProfileActivity,
} from "./dogProfile";

const activity = (
  id: string,
  overrides: Partial<DogProfileActivity> = {},
): DogProfileActivity => ({
  id,
  saleDate: "2026-07-28",
  createdAt: "2026-07-28T09:00:00+09:00",
  businessUnitId: "daycare",
  businessUnitName: "유치원",
  productName: "유치원 1회",
  quantity: 1,
  unitLabel: "회",
  status: "normal",
  cancellationType: null,
  ...overrides,
});

describe("dog profile usage and timeline", () => {
  it("summarizes active usage by business unit and quantity", () => {
    const result = summarizeDogUsage([
      activity("daycare-1", { quantity: 5 }),
      activity("daycare-2", { quantity: 3 }),
      activity("hotel", {
        businessUnitId: "hotel",
        businessUnitName: "호텔",
        productName: "스탠다드 1박",
        quantity: 9,
        unitLabel: "박",
      }),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        businessUnitName: "유치원",
        quantity: 8,
        count: 2,
        unitLabel: "회",
      }),
      expect.objectContaining({
        businessUnitName: "호텔",
        quantity: 9,
        count: 1,
        unitLabel: "박",
      }),
    ]);
  });

  it("reads the display unit from the related product", () => {
    expect(
      mapDogProfileActivity({
        id: "hotel",
        sale_date: "2026-07-28",
        created_at: "2026-07-28T09:00:00+09:00",
        business_unit_id: "hotel",
        business_unit_name: "호텔",
        product_name: "스탠다드 1박",
        quantity: 9,
        status: "normal",
        cancellation_type: null,
        product: { unit_label: "박" },
      }),
    ).toEqual(
      expect.objectContaining({
        quantity: 9,
        unitLabel: "박",
      }),
    );
  });

  it("excludes cancelled and entry_error records from usage", () => {
    const result = activeDogActivities([
      activity("normal"),
      activity("cancelled", { status: "cancelled" }),
      activity("entry-error", { cancellationType: "entry_error" }),
    ]);

    expect(result.map((row) => row.id)).toEqual(["normal"]);
  });

  it("calculates first and recent usage dates from the same activity set", () => {
    expect(
      dogUsageDateRange([
        activity("middle", { saleDate: "2026-07-20" }),
        activity("first", { saleDate: "2026-06-03" }),
        activity("recent", { saleDate: "2026-07-28" }),
      ]),
    ).toEqual({
      firstDate: "2026-06-03",
      recentDate: "2026-07-28",
    });
  });
});

describe("dog profile audit and Customer Master connection", () => {
  const profileUi = readFileSync(
    new URL("./DogProfileModal.tsx", import.meta.url),
    "utf8",
  );
  const managementUi = readFileSync(
    new URL("./DogManagement.tsx", import.meta.url),
    "utf8",
  );
  const sharedUi = readFileSync(
    new URL("../components/ui.tsx", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/202607280004_dog_master_audit.sql",
      import.meta.url,
    ),
    "utf8",
  ).toLowerCase();

  it("keeps owner editing on the shared customers row", () => {
    expect(profileUi).toContain("보호자 정보");
    expect(profileUi).toContain("onEditOwner");
    expect(managementUi).toContain('.from("customers")');
    expect(managementUi).toContain(".update(values)");
  });

  it("extends the existing dog workflow without replacing its edit actions", () => {
    expect(managementUi).toContain("<Eye size={15} />");
    expect(managementUi).toContain("프로필");
    expect(managementUi).toContain("보호자 수정");
    expect(managementUi).toContain("반려견 정보 수정");
    expect(managementUi).toContain("관리 더보기");
    expect(managementUi).toContain(
      'title={editing?.id ? "반려견 수정" : "반려견 등록"}',
    );
  });

  it("opens directly on the dog list without the redundant customer-list tab", () => {
    expect(managementUi).not.toContain('from "./Pets"');
    expect(managementUi).not.toContain('useState<"dogs" | "customers">');
    expect(managementUi).not.toContain("보호자 목록</Button>");
    expect(managementUi).not.toContain("<CustomerList");
    expect(managementUi).toContain("반려견 검색");
    expect(managementUi).toContain("보호자 수정");
  });

  it("keeps the requested profile section order", () => {
    const sections = [
      'title="반려견 정보"',
      'title="보호자 정보"',
      'title="이용 정보"',
      'title="메모"',
      'title="Timeline"',
    ].map((title) => profileUi.indexOf(title));

    expect(sections.every((index) => index >= 0)).toBe(true);
    expect(sections).toEqual([...sections].sort((a, b) => a - b));
  });

  it("keeps loading, empty, and error usage states distinct", () => {
    expect(profileUi).toContain("최근 이용 확인 중");
    expect(profileUi).toContain("최근 이용 확인 불가");
    expect(profileUi).toContain("최근 이용 없음");
    expect(profileUi).toContain('title="아직 이용 기록이 없습니다."');
  });

  it("resets list and profile scrolling while keeping empty states compact", () => {
    expect(managementUi).toContain("scrollResetKey=");
    expect(profileUi).toContain("resetKey={dog.id}");
    expect(profileUi).toContain(
      '<EmptyState compact title="아직 이용 기록이 없습니다." />',
    );
    expect(profileUi).toContain(
      '<EmptyState compact title="표시할 Timeline이 없습니다." />',
    );
    expect(sharedUi).toContain("scrollRef.current.scrollLeft = 0");
    expect(sharedUi).toContain("scrollRef.current.scrollTop = 0");
    expect(sharedUi).toContain(
      "flex max-h-[calc(100dvh-0.5rem)] w-full flex-col overflow-hidden",
    );
  });

  it("uses customer-friendly labels and formatted display phones", () => {
    expect(profileUi).toContain("보호자 프로필 보기");
    expect(profileUi).not.toContain("보호자 Master 보기");
    expect(profileUi).toContain("formatPhone(owner.phone)");
  });

  it("loads units through the product relation instead of a missing sales column", () => {
    expect(managementUi).toContain(
      "product:products!sales_product_id_fkey(unit_label)",
    );
    expect(managementUi).not.toContain(
      "quantity, unit_label, status, cancellation_type",
    );
  });

  it("records Dog Master updates without changing master or accounting columns", () => {
    expect(migration).toContain("create trigger dogs_master_audit");
    expect(migration).toContain("'shared_master'");
    expect(migration).toContain("'dog'");
    expect(migration).toContain("to_jsonb(old)");
    expect(migration).toContain("to_jsonb(new)");
    expect(migration).not.toMatch(/alter table public\.dogs/);
    expect(migration).not.toContain("public.sales");
    expect(migration).not.toContain("sale_payments");
    expect(migration).not.toContain("sale_refunds");
  });
});
