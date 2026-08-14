import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", file), "utf8");

describe("forms, modals, and action hierarchy", () => {
  it("uses the shared form section and alert system for Daycare and Long Stay", () => {
    const daycare = source("DaycareReservationModal.tsx");
    const longStay = source("LongStayRegistrationForm.tsx");
    for (const text of [daycare, longStay]) {
      expect(text).toContain("<FormSection");
      expect(text).toContain("<FormAlert");
      expect(text).toContain("<ModalActions>");
    }
    expect(daycare).toContain('title="예약 대상"');
    expect(daycare).toContain('title="이용 정보"');
    expect(daycare).toContain('title="운영 정보"');
    expect(longStay).toContain('title="계약 정보"');
  });

  it("keeps Hotel, Shared Room, Long Stay, and Daycare actions on one hierarchy", () => {
    for (const file of [
      "HotelOperations.tsx",
      "SharedHotelRoomModal.tsx",
      "LongStayOperationsPanel.tsx",
      "DaycareOperationsPanel.tsx",
    ]) {
      expect(source(file)).toContain("<ResponsiveActionGroup");
    }
    expect(source("HotelOperations.tsx")).toContain("primary={<>{!stay.checkedInAt");
    expect(source("SharedHotelRoomModal.tsx")).toContain('confirmLabel="Dog별 퇴실"');
    expect(source("LongStayOperationsPanel.tsx")).toContain('openAction("leave", contract)');
    expect(source("LongStayOperationsPanel.tsx")).toContain('openAction("return", contract)');
    expect(source("DaycareOperationsPanel.tsx")).toContain("reservation.roomAllocation ? <Button");
  });

  it("separates service identity from lifecycle color", () => {
    const daycare = source("DaycareOperationsPanel.tsx");
    const shared = source("SharedHotelRoomModal.tsx");
    expect(daycare).toContain('<Badge tone="blue">데이케어</Badge>');
    expect(daycare).not.toContain("bg-cyan-50/45");
    expect(shared).toContain('<Badge tone="blue">같은 방</Badge>');
    expect(shared).not.toContain("bg-violet-50 p-4");
  });

  it("keeps profile scrolling single-axis on mobile and condenses Dog actions", () => {
    const customer = source("CustomerProfileModal.tsx");
    const dog = source("DogProfileModal.tsx");
    expect(customer).toContain('className="sm:max-h-[28rem] sm:overflow-y-auto sm:pr-1"');
    expect(customer).not.toContain('className="max-h-[28rem] overflow-y-auto');
    expect(dog).toContain("<ResponsiveActionGroup");
  });

  it("preserves the canonical RPC and repository wiring", () => {
    expect(source("DaycareReservationModal.tsx")).toContain("createDaycareReservation(input)");
    expect(source("LongStayRegistrationForm.tsx")).toContain("createLongStayContract({");
    expect(source("SharedHotelRoomModal.tsx")).toContain("sharedHotelRoomRepository.checkOut");
    expect(source("HotelOperations.tsx")).toContain("completeHotelCheckOut");
  });
});
