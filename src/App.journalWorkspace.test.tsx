// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import App from "./App";

const moduleMocks = vi.hoisted(() => ({
  chooseModule: vi.fn(),
  switchModule: vi.fn(),
  rememberPendingReturnTo: vi.fn(),
}));

vi.mock("./auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "staff@example.test" },
    profile: { name: "테스트 직원", role: "staff" },
    businessUnits: [],
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("./app/ModuleContext", () => ({
  useModule: () => ({
    gateCompleted: true,
    pendingReturnTo: null,
    currentModule: null,
    ...moduleMocks,
  }),
}));

vi.mock("./pages/JournalHome", () => ({
  JournalHomePage: () => <div>JOURNAL_HOME_RENDERED</div>,
}));

vi.mock("./pages/OperationsToday", () => ({
  OperationsTodayPage: () => <div>OPERATIONS_TODAY_RENDERED</div>,
}));

vi.mock("./pages/DashboardDB", () => ({
  DashboardPage: () => <div>SALES_DASHBOARD_RENDERED</div>,
}));

vi.mock("./pages/HotelOperations", () => ({
  HotelOperationsPage: () => <div>HOTEL_OPERATIONS_RENDERED</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderPath = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

function CurrentPath() {
  const location = useLocation();
  return <output aria-label="현재 URL">{location.pathname}</output>;
}

const renderPathWithLocation = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <CurrentPath />
      <App />
    </MemoryRouter>,
  );

describe("Journal workspace IA", () => {
  it("선택 화면에 세 workspace를 표시한다", () => {
    renderPath("/select-module");
    const schedule = screen.getByRole("button", { name: /스케줄 관리/ });
    expect(schedule).toBeTruthy();
    expect(screen.getByRole("button", { name: /매출 관리/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /일지 관리/ })).toBeTruthy();
    expect(schedule.parentElement?.className).toContain("grid-cols-1");
    expect(schedule.parentElement?.className).toContain("md:grid-cols-3");

    fireEvent.click(schedule);
    expect(moduleMocks.chooseModule).toHaveBeenLastCalledWith("operations", "/operations/today");
    fireEvent.click(screen.getByRole("button", { name: /매출 관리/ }));
    expect(moduleMocks.chooseModule).toHaveBeenLastCalledWith("finance", "/dashboard");
    fireEvent.click(screen.getByRole("button", { name: /일지 관리/ }));
    expect(moduleMocks.chooseModule).toHaveBeenLastCalledWith("journal", "/journal/today");
  });

  it("Journal 전용 sidebar와 breadcrumb에서 오늘의 일지를 렌더한다", () => {
    renderPath("/journal/today");
    const navigation = screen.getByRole("navigation", { name: "일지 관리" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(1);
    expect(within(navigation).getByRole("link", { name: "오늘의 일지" })).toBeTruthy();
    expect(screen.getByText("JOURNAL_HOME_RENDERED")).toBeTruthy();
    expect(screen.getAllByText("일지 관리")).toHaveLength(2);
  });

  it("기존 Operations Journal 주소를 Journal workspace로 넘긴다", async () => {
    renderPath("/operations/journal");
    await waitFor(() =>
      expect(screen.getByText("JOURNAL_HOME_RENDERED")).toBeTruthy(),
    );
    expect(screen.getByRole("navigation", { name: "일지 관리" })).toBeTruthy();
  });

  it("Schedule sidebar에서는 Journal 메뉴를 제거한다", () => {
    renderPath("/operations/today");
    expect(screen.getByText("OPERATIONS_TODAY_RENDERED")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "일지" })).toBeNull();
  });

  it("Schedule, Sales, Journal canonical direct routes를 독립 렌더한다", () => {
    const schedule = renderPath("/operations/today");
    expect(screen.getByText("OPERATIONS_TODAY_RENDERED")).toBeTruthy();
    schedule.unmount();

    const sales = renderPath("/dashboard");
    expect(screen.getByText("SALES_DASHBOARD_RENDERED")).toBeTruthy();
    sales.unmount();

    renderPath("/journal/today");
    expect(screen.getByText("JOURNAL_HOME_RENDERED")).toBeTruthy();
  });

  it.each([
    ["/operations/hotel", "HOTEL_OPERATIONS_RENDERED"],
    ["/journal/today", "JOURNAL_HOME_RENDERED"],
    ["/dashboard", "SALES_DASHBOARD_RENDERED"],
  ])("%s Sidebar 로고가 기존 OS Home으로 이동한다", async (path, marker) => {
    renderPathWithLocation(path);
    expect(screen.getByText(marker)).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "P&M OS 홈" }));

    await waitFor(() =>
      expect(screen.getByLabelText("현재 URL").textContent).toBe(
        "/select-module",
      ),
    );
    expect(screen.getByRole("heading", { name: "어떤 업무를 시작할까요?" })).toBeTruthy();
  });

  it("Mobile drawer에서도 Sidebar 로고로 OS Home에 이동한다", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 375,
    });
    renderPathWithLocation("/journal/today");

    fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    fireEvent.click(screen.getByRole("link", { name: "P&M OS 홈" }));

    await waitFor(() =>
      expect(screen.getByLabelText("현재 URL").textContent).toBe(
        "/select-module",
      ),
    );
    expect(screen.getByRole("heading", { name: "어떤 업무를 시작할까요?" })).toBeTruthy();
  });
});
