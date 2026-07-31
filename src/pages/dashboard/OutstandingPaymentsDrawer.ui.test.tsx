// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSale } from "./dashboardMetrics";
import { OutstandingPaymentsDrawer } from "./OutstandingPaymentsDrawer";

afterEach(cleanup);

const sale: DashboardSale = {
  id: "sale-1",
  saleDate: "2026-07-12",
  businessUnitId: "training",
  businessUnitName: "교육센터",
  productId: "product-1",
  productName: "상담",
  dogId: "dog-1",
  dogName: "토리",
  customerId: "customer-1",
  customerName: "김아름",
  customerPhone: null,
  createdBy: "profile-1",
  staffName: "직원",
  paymentMethod: "card",
  originalAmount: 1_000_000,
  additionalAmount: 0,
  discountAmount: 0,
  paidAmount: 400_000,
  refundAmount: 0,
  outstandingAmount: 600_000,
  netAmount: 400_000,
  status: "active",
  createdAt: "2026-07-12T09:00:00Z",
};

const renderDrawer = (sales: DashboardSale[]) =>
  render(
    <OutstandingPaymentsDrawer
      open
      unitId=""
      unitName="전체"
      units={[{ id: "training", name: "교육센터" }]}
      sales={sales}
      collectionMode
      title="수금 대기"
      onClose={vi.fn()}
      onChanged={vi.fn(async () => undefined)}
      onOpenSale={vi.fn()}
      onOpenCustomer={vi.fn()}
    />,
  );

describe("수금 대기 Drawer UI", () => {
  it("미수금이 없으면 업무용 Empty State를 표시한다", () => {
    renderDrawer([]);

    expect(screen.getByText("현재 수금 대기 고객이 없습니다.")).toBeTruthy();
    expect(screen.getByText("현재 처리해야 할 미수 거래가 없습니다.")).toBeTruthy();
  });

  it("금액 중심 정보 계층과 Primary 결제 동선을 유지한다", () => {
    renderDrawer([sale]);

    const card = screen.getByRole("article");
    const content = card.textContent ?? "";
    expect(content.indexOf("600,000원")).toBeLessThan(content.indexOf("김아름"));
    expect(content.indexOf("김아름")).toBeLessThan(content.indexOf("반려견 토리"));
    expect(content.indexOf("반려견 토리")).toBeLessThan(content.indexOf("교육센터"));
    expect(within(card).getByRole("button", { name: "결제받기" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "거래 확인" })).toBeTruthy();
    expect(within(card).getByText("연락처 미등록")).toBeTruthy();
    expect(within(card).queryByRole("link", { name: /전화/ })).toBeNull();
  });
});
