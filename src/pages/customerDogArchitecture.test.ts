import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compactDogNames,
  customerDogCountById,
  customerServiceCounts,
  customerServiceDogNames,
  isSingleDogProfileName,
  preferredDogService,
  type CustomerDogServiceStatus,
} from "./customerDogArchitecture";

const services: CustomerDogServiceStatus[] = [
  {
    dogId: "dog-a",
    domain: "training",
    label: "교육",
    detail: "A 프로그램",
    status: "진행중",
    sourceEntityId: "training-a",
  },
  {
    dogId: "dog-a",
    domain: "hotel",
    label: "호텔",
    detail: "STANDARD 3",
    status: "이용중",
    sourceEntityId: "stay-a",
  },
  {
    dogId: "dog-b",
    domain: "daycare",
    label: "유치원",
    detail: "오전반",
    status: "등원중",
    sourceEntityId: "daycare-b",
  },
];

describe("Customer and Dog architecture V2", () => {
  it("accepts one dog name and rejects combined profile names", () => {
    expect(isSingleDogProfileName("동동이")).toBe(true);
    expect(isSingleDogProfileName("동동이,마루")).toBe(false);
    expect(isSingleDogProfileName("동동이 / 마루")).toBe(false);
    expect(isSingleDogProfileName("동동이\n마루")).toBe(false);
  });

  it("counts only active dogs linked to a Customer", () => {
    expect(
      customerDogCountById([
        { customerId: "customer-a", active: true },
        { customerId: "customer-a", active: true },
        { customerId: "customer-a", active: false },
        { customerId: null, active: true },
      ]).get("customer-a"),
    ).toBe(2);
  });

  it("counts current services once per dog and domain", () => {
    expect(customerServiceCounts(["dog-a", "dog-b"], [
      ...services,
      {
        dogId: "dog-a",
        domain: "consultation",
        label: "상담",
        detail: "전화 상담",
        status: "완료",
        sourceEntityId: "consultation-a",
      },
    ])).toEqual({
      hotel: 1,
      training: 1,
      daycare: 1,
    });
  });

  it("prefers the active Hotel state for the Customer dog card", () => {
    expect(preferredDogService("dog-a", services)).toMatchObject({
      domain: "hotel",
      detail: "STANDARD 3",
      status: "이용중",
    });
  });

  it("groups current dog names by service and creates a compact label", () => {
    expect(
      customerServiceDogNames(
        [
          { id: "dog-a", name: "동동이" },
          { id: "dog-b", name: "마루" },
        ],
        services,
      ),
    ).toEqual({ hotel: ["동동이"], training: ["동동이"], daycare: ["마루"] });
    expect(compactDogNames(["동동이", "마루", "콩이"])).toBe("동동이 외 2마리");
  });
});

describe("Customer and Dog UI boundary", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const customerPage = readFileSync(
    new URL("./CustomerManagement.tsx", import.meta.url),
    "utf8",
  );
  const customerProfile = readFileSync(
    new URL("./CustomerProfileModal.tsx", import.meta.url),
    "utf8",
  );
  const dogManagement = readFileSync(
    new URL("./DogManagement.tsx", import.meta.url),
    "utf8",
  );
  const headerSearch = readFileSync(
    new URL("../components/CustomerDogHeaderSearch.tsx", import.meta.url),
    "utf8",
  );

  it("adds separate Customer routes without replacing Dog management", () => {
    expect(app).toContain('path="customers" element={<PetManagementPage />}');
    expect(app).toContain(
      'path="customer-management" element={<CustomerManagementPage />}',
    );
    expect(app).toContain('label: "반려견 관리"');
    expect(app).toContain('label: "보호자 관리"');
  });

  it("shows Customer service counts, dog cards, and Customer Timeline", () => {
    expect(customerPage).toContain("serviceCounts.hotel");
    expect(customerPage).toContain("serviceCounts.training");
    expect(customerPage).toContain("serviceCounts.daycare");
    expect(customerProfile).toContain("반려견 현재 상태");
    expect(customerProfile).toContain("Customer Timeline");
    expect(customerProfile).toContain("현재 이용 현황");
    expect(customerPage).toContain("recentUseDetailByCustomerId");
    expect(customerPage).toContain("serviceDogNames");
    expect(customerProfile).toContain("onOpenDog");
  });

  it("shows current service and legacy context in Dog management", () => {
    expect(dogManagement).toContain("DogCurrentService");
    expect(dogManagement).toContain("Legacy · 다견 이름");
    expect(dogManagement).toContain("preferredDogService");
  });

  it("expands a direct Dog search with sibling Dogs from the same Customer", () => {
    expect(headerSearch).toContain("directlyMatchedCustomerIds");
    expect(headerSearch).toContain("familyDogs");
    expect(headerSearch).toContain("같은 가족");
    expect(headerSearch).toContain("DogCurrentService");
    expect(headerSearch).toContain("보호자 프로필");
  });

  it("opens customerId as a Customer Profile instead of the first linked Dog", () => {
    expect(dogManagement).toContain("openCustomerProfile(requestedCustomerId)");
    expect(dogManagement).not.toContain(
      "dogs.find((dog) => dog.customerId === requestedCustomerId)",
    );
  });

  it("keeps future contracts as TypeScript interfaces only", () => {
    const source = readFileSync(
      new URL("./customerDogArchitecture.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("export interface FamilyBookingDraft");
    expect(source).toContain("export interface LongStayContractDraft");
    expect(source).toContain("export interface RoomOccupancyCapacityDraft");
    expect(source).not.toContain("supabase");
  });
});
