import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const saleRegistration = readFileSync(
  new URL("../pages/SaleRegistration.tsx", import.meta.url),
  "utf8",
);
const operationsToday = readFileSync(
  new URL("../pages/OperationsToday.tsx", import.meta.url),
  "utf8",
);
const customerDogSearchFields = readFileSync(
  new URL("../components/CustomerDogSearchFields.tsx", import.meta.url),
  "utf8",
);
const outstandingDrawer = readFileSync(
  new URL("../pages/dashboard/OutstandingPaymentsDrawer.tsx", import.meta.url),
  "utf8",
);

describe("전화번호 표시 정책", () => {
  it("고객·보호자 검색과 일정 SearchSelect는 전체 번호 포맷을 사용한다", () => {
    expect(saleRegistration).toContain(
      "text={displayPhone(result.customerPhone)}",
    );
    expect(customerDogSearchFields).toContain(
      "formatPhoneForDisplay(customer?.phone)",
    );
    expect(customerDogSearchFields).toContain("formatPhoneForDisplay(row.phone)");
    expect(operationsToday).toContain("<CustomerDogSearchFields");
    expect(operationsToday).not.toContain("phoneLast4");
  });

  it("직원 수금 대기만 번호를 마스킹하고 실제 번호는 전화 링크에만 사용한다", () => {
    expect(outstandingDrawer).toContain("maskedCollectionPhone");
    expect(outstandingDrawer).toContain("-****-");
    expect(outstandingDrawer).toContain('href={`tel:${sale.customerPhone');
    expect(outstandingDrawer).not.toContain(
      'aria-label={`${sale.customerPhone',
    );
    expect(outstandingDrawer).not.toContain(
      'title={`${sale.customerPhone',
    );
  });
});
