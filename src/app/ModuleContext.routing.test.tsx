// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { ModuleProvider, useModule } from "./ModuleContext";

const authMock = vi.hoisted(() => ({ user: { id: "routing-user" } }));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => authMock,
}));

function RoutingHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  const { chooseModule, switchModule } = useModule();
  return (
    <>
      <output aria-label="현재 경로">{location.pathname}</output>
      <button type="button" onClick={() => chooseModule("operations")}>스케줄 관리</button>
      <button type="button" onClick={() => chooseModule("finance")}>매출 관리</button>
      <button type="button" onClick={() => chooseModule("journal")}>일지 관리</button>
      <button type="button" onClick={() => switchModule("operations")}>스케줄 홈</button>
      <button type="button" onClick={() => switchModule("finance")}>매출 홈</button>
      <button type="button" onClick={() => switchModule("journal")}>일지 홈</button>
      <button type="button" onClick={() => navigate(-1)}>뒤로</button>
      <button type="button" onClick={() => navigate(1)}>앞으로</button>
    </>
  );
}

function renderHarness(path = "/select-module") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ModuleProvider>
        <RoutingHarness />
      </ModuleProvider>
    </MemoryRouter>,
  );
}

describe("workspace routing through ModuleProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not restore the legacy Journal path when Schedule is selected", async () => {
    localStorage.setItem(
      "pm-os:last-operations-path:routing-user",
      "/operations/journal",
    );
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "스케줄 관리" }));

    await waitFor(() =>
      expect(screen.getByLabelText("현재 경로").textContent).toBe(
        "/operations/today",
      ),
    );
  });

  it("keeps Schedule, Sales, and Journal selections independent after repeated entry", async () => {
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "일지 관리" }));
    await waitFor(() =>
      expect(screen.getByLabelText("현재 경로").textContent).toBe(
        "/journal/today",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "스케줄 관리" }));
    await waitFor(() =>
      expect(screen.getByLabelText("현재 경로").textContent).toBe(
        "/operations/today",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "매출 관리" }));
    await waitFor(() =>
      expect(screen.getByLabelText("현재 경로").textContent).toBe(
        "/dashboard",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "스케줄 관리" }));
    await waitFor(() =>
      expect(screen.getByLabelText("현재 경로").textContent).toBe(
        "/operations/today",
      ),
    );
  });

  it.each([
    ["/operations/hotel", "일지 홈", "/journal/today"],
    ["/journal/today", "스케줄 홈", "/operations/today"],
    ["/operations/calendar", "매출 홈", "/dashboard"],
    ["/sales", "스케줄 홈", "/operations/today"],
  ])("switches %s to the selected canonical home", async (path, action, expected) => {
    localStorage.setItem(
      "pm-os:last-operations-path:routing-user",
      "/operations/hotel",
    );
    localStorage.setItem("pm-os:last-finance-path:routing-user", "/sales");
    renderHarness(path);

    fireEvent.click(screen.getByRole("button", { name: action }));

    await waitFor(() =>
      expect(screen.getByLabelText("현재 경로").textContent).toBe(expected),
    );
  });

  it("moves the currently selected management area to its canonical home", async () => {
    renderHarness("/operations/hotel");
    fireEvent.click(screen.getByRole("button", { name: "스케줄 홈" }));
    await waitFor(() =>
      expect(screen.getByLabelText("현재 경로").textContent).toBe(
        "/operations/today",
      ),
    );
  });

  it("keeps switch navigation in browser back and forward history", async () => {
    renderHarness("/operations/hotel");
    fireEvent.click(screen.getByRole("button", { name: "일지 홈" }));
    await waitFor(() =>
      expect(screen.getByLabelText("현재 경로").textContent).toBe(
        "/journal/today",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
    await waitFor(() =>
      expect(screen.getByLabelText("현재 경로").textContent).toBe(
        "/operations/hotel",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "앞으로" }));
    await waitFor(() =>
      expect(screen.getByLabelText("현재 경로").textContent).toBe(
        "/journal/today",
      ),
    );
  });
});
