// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardDateDrawer } from "./DashboardDateDrawer";
import type { DashboardSale } from "./dashboardMetrics";

afterEach(cleanup);

describe("DashboardDateDrawer actions", () => {
  it("keeps sale registration and ledger actions available for the selected date", () => {
    const onRegisterSale = vi.fn();
    const onOpenSales = vi.fn();

    render(
      <DashboardDateDrawer
        open
        date="2026-08-01"
        unitName="전체 사업부"
        themeCode="all"
        summary={{
          date: "2026-08-01",
          salesAmount: 0,
          revenue: 0,
          net: 0,
          count: 0,
          cancelledCount: 0,
          refund: 0,
          outstanding: 0,
        }}
        rows={[]}
        payments={[]}
        refunds={[]}
        paymentMethodTotals={new Map()}
        units={[]}
        onClose={vi.fn()}
        onOpenSale={vi.fn()}
        onRegisterSale={onRegisterSale}
        onOpenSales={onOpenSales}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "매출 등록" }));
    fireEvent.click(screen.getByRole("button", { name: "전체 매출 내역 보기" }));

    expect(onRegisterSale).toHaveBeenCalledOnce();
    expect(onOpenSales).toHaveBeenCalledOnce();
  });

  it("keeps the focus summary scoped while showing every business unit breakdown", () => {
    const sale = (
      id: string,
      businessUnitId: string,
      businessUnitName: string,
      amount: number,
    ): DashboardSale => ({
      id,
      saleDate: "2026-08-01",
      businessUnitId,
      businessUnitName,
      productId: `${id}-product`,
      productName: "테스트 상품",
      dogId: null,
      dogName: "테스트견",
      customerId: null,
      customerName: "보호자",
      createdBy: "admin",
      staffName: "대표",
      paymentMethod: "card",
      originalAmount: amount,
      additionalAmount: 0,
      discountAmount: 0,
      paidAmount: amount,
      refundAmount: 0,
      outstandingAmount: 0,
      netAmount: amount,
      status: "normal",
      createdAt: "2026-08-01T09:00:00+09:00",
    });

    render(
      <DashboardDateDrawer
        open
        date="2026-08-01"
        unitName="교육센터"
        focusedUnitId="training"
        themeCode="training"
        summary={{
          date: "2026-08-01",
          salesAmount: 400_000,
          revenue: 400_000,
          net: 400_000,
          count: 1,
          cancelledCount: 0,
          refund: 0,
          outstanding: 0,
        }}
        rows={[
          sale("training-sale", "training", "교육센터", 400_000),
          sale("hotel-sale", "hotel", "호텔", 60_000),
        ]}
        payments={[]}
        refunds={[]}
        paymentMethodTotals={new Map()}
        units={[
          { id: "daycare", code: "daycare", name: "유치원" },
          { id: "training", code: "training", name: "교육센터" },
          { id: "hotel", code: "hotel", name: "호텔" },
        ]}
        outstandingLabel="교육센터 현재 미수"
        onClose={vi.fn()}
        onOpenSale={vi.fn()}
        onRegisterSale={vi.fn()}
        onOpenSales={vi.fn()}
      />,
    );

    expect(screen.getByText("교육센터 판매금액")).toBeTruthy();
    expect(screen.getByText("해당 날짜 전체 사업부")).toBeTruthy();
    expect(screen.getAllByText("400,000원").length).toBeGreaterThan(0);
    expect(screen.getByText("60,000원")).toBeTruthy();
    expect(screen.getByText("교육센터 현재 미수")).toBeTruthy();
  });
});
