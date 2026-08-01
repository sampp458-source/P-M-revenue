// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardDateDrawer } from "./DashboardDateDrawer";

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
});
