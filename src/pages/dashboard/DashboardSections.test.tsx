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

  it("직원 표시에는 선택일 발생 미수만 노출하고 누적 비교를 숨긴다", () => {
    renderHero({
      periodLabel: "7월 19일",
      showComparison: false,
      monthlyTarget: null,
      outstandingLabel: "7월 19일 발생 미수",
      outstandingDescription: "선택한 날짜의 판매에서 발생한 미수",
      outstandingActionLabel: "선택 날짜 판매 거래 목록 열기",
    });

    expect(screen.getByText("7월 19일 판매금액")).toBeTruthy();
    expect(screen.getByText("7월 19일 실수납")).toBeTruthy();
    expect(screen.getByText("7월 19일 환불")).toBeTruthy();
    expect(screen.getByText("7월 19일 순수납")).toBeTruthy();
    expect(screen.getByText("7월 19일 발생 미수")).toBeTruthy();
    expect(screen.queryByText("현재 전체 미수")).toBeNull();
    expect(screen.queryByText("전월 대비")).toBeNull();
    expect(screen.queryByText("목표 미설정")).toBeNull();
  });
});
