// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardKpiHero } from "./DashboardSections";

afterEach(cleanup);

const renderHero = (
  overrides: Partial<React.ComponentProps<typeof DashboardKpiHero>> = {},
) =>
  render(
    <DashboardKpiHero
      periodLabel="이번 달"
      compareLabel="전월"
      salesAmount={3_000_000}
      previousSalesAmount={2_000_000}
      paidAmount={2_500_000}
      previousPaidAmount={2_000_000}
      count={3}
      monthlyTarget={5_000_000}
      outstanding={500_000}
      refund={200_000}
      onSales={vi.fn()}
      onPayments={vi.fn()}
      onRefunds={vi.fn()}
      onNet={vi.fn()}
      onOutstanding={vi.fn()}
      {...overrides}
    />,
  );

describe("DashboardKpiHero 권한별 표시", () => {
  it("관리자 기본 표시에는 현재 전체 미수와 비교 정보를 유지한다", () => {
    renderHero();

    expect(screen.getByText("현재 전체 미수")).toBeTruthy();
    expect(screen.getAllByText("전월 대비").length).toBeGreaterThan(0);
    expect(screen.getByText("목표 대비 50.0%")).toBeTruthy();
  });

  it("직원 표시에는 수금 대기 건수와 금액을 함께 노출하고 누적 비교를 숨긴다", () => {
    renderHero({
      periodLabel: "7월 19일",
      showComparison: false,
      monthlyTarget: null,
      outstandingCount: 5,
      outstandingLabel: "수금 대기",
      outstandingDescription: "아직 결제가 필요한 고객 · 수금 업무",
      outstandingActionLabel: "수금 대기 목록 열기",
    });

    expect(screen.getByText("7월 19일 판매금액")).toBeTruthy();
    expect(screen.getByText("7월 19일 실수납")).toBeTruthy();
    expect(screen.getByText("7월 19일 환불")).toBeTruthy();
    expect(screen.getByText("7월 19일 순수납")).toBeTruthy();
    expect(screen.getByText("수금 대기")).toBeTruthy();
    expect(screen.getByText("5건")).toBeTruthy();
    expect(screen.getByText("500,000원")).toBeTruthy();
    expect(screen.queryByText("현재 전체 미수")).toBeNull();
    expect(screen.queryByText("전월 대비")).toBeNull();
    expect(screen.queryByText("목표 미설정")).toBeNull();
  });
});
