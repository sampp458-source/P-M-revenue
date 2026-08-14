import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), "utf8");

describe("Long Stay public application contract", () => {
  it("uses the approved public RPCs and never selects Long Stay tables directly", () => {
    const repository = source("./longStayHotelRepository.ts");
    const rpcNames = [
      "create_long_stay_contract",
      "confirm_long_stay_month_v2",
      "complete_long_stay_check_in",
      "start_long_stay_absence_v3",
      "complete_long_stay_absence_v2",
      "get_long_stay_return_room_availability",
      "set_long_stay_absence_expected_return_v2",
      "set_long_stay_planned_checkout",
      "complete_long_stay_check_out",
      "reverse_long_stay_completion",
      "get_long_stay_contract",
      "get_customer_long_stays",
      "get_long_stay_month_v2",
      "get_long_stay_room_availability_v2",
    ];
    rpcNames.forEach((name) => expect(repository).toContain(`"${name}"`));
    expect(repository).not.toMatch(/\.from\(["']long_stay_/);
  });

  it("preserves version, replay and SQLSTATE handling", () => {
    const repository = source("./longStayHotelRepository.ts");
    expect(repository).toContain("p_expected_contract_version");
    expect(repository).toContain("p_expected_stay_version");
    expect(repository).toContain("crypto.randomUUID()");
    ["40001", "PT409", "23505", "23514", "23P01", "42501", "P0002", "22023"].forEach(
      (code) => expect(repository).toContain(`"${code}"`),
    );
  });

  it("keeps infinity out of the public UI model", () => {
    const contract = source("./longStayHotelContract.ts");
    const operations = source("../pages/LongStayOperationsPanel.tsx");
    expect(contract).toContain("runtimeCapacityUntil: null");
    expect(contract).toContain("runtimeAllocationUntil: null");
    expect(operations).not.toContain("reserved_until");
    expect(operations).not.toContain("allocated_until");
    expect(operations).not.toContain("'infinity'");
  });

  it("refreshes the canonical Room Board snapshot after Long Stay mutations", () => {
    const operations = source("../pages/LongStayOperationsPanel.tsx");
    const hotel = source("../pages/HotelOperations.tsx");
    expect(operations).toContain("onHotelSnapshotRefresh");
    expect(operations).toContain("Promise.all([load(), onHotelSnapshotRefresh()])");
    expect(hotel).toContain("<LongStayOperationsPanel");
    expect(hotel).toContain("selectedBusinessDate={selectedDate}");
    expect(hotel).toContain("onHotelSnapshotRefresh={() => loadSnapshot(selectedDate)}");
    expect(operations).toMatch(/const openAction[\s\S]*setToast\(null\)[\s\S]*setAction/);
    expect(operations).toContain("getLongStayContract(action.contract.id)");
    expect(operations).toContain('mutationError.kind === "conflict"');
    expect(operations).toMatch(/finally[\s\S]*setProcessing\(false\)/);
  });

  it("integrates Customer and Dog profiles without replacing their timelines", () => {
    const customer = source("../pages/CustomerProfileModal.tsx");
    const dog = source("../pages/DogProfileModal.tsx");
    const longStayProfile = source("../pages/LongStayProfileSection.tsx");
    expect(customer).toContain("<LongStayProfileSection");
    expect(customer).toContain("Customer Timeline");
    expect(dog).toContain("<LongStayProfileSection");
    expect(dog).toContain('title="Timeline"');
    expect(longStayProfile).not.toContain("<Modal");
    expect(longStayProfile).toContain('aria-label="장기호텔 등록 양식"');
  });
});
