// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSwitcher } from "./AppSwitcher";

afterEach(cleanup);

describe("AppSwitcher 접근성", () => {
  it("현재 모듈과 설명을 표시하고 Enter로 다른 모듈을 선택한다", async () => {
    const onSwitch = vi.fn();
    render(<AppSwitcher module="operations" onSwitch={onSwitch} />);

    const trigger = screen.getByRole("button", { name: /스케줄 관리/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(
      screen
        .getByRole("menuitemradio", { name: /수업과 회사 일정/ })
        .getAttribute("aria-checked"),
    ).toBe("true");

    const finance = screen.getByRole("menuitemradio", {
      name: /매출·수납·미수·환불/,
    });
    finance.focus();
    fireEvent.keyDown(finance, { key: "Enter" });
    expect(onSwitch).toHaveBeenCalledWith("finance");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("방향키로 이동하고 ESC로 닫은 뒤 Trigger에 Focus를 돌려준다", async () => {
    render(<AppSwitcher module="operations" onSwitch={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /스케줄 관리/ });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const current = screen.getByRole("menuitemradio", {
      name: /수업과 회사 일정/,
    });
    const finance = screen.getByRole("menuitemradio", {
      name: /매출·수납·미수·환불/,
    });
    await waitFor(() => expect(document.activeElement).toBe(current));
    fireEvent.keyDown(current, { key: "ArrowDown" });
    expect(document.activeElement).toBe(finance);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("바깥 영역을 누르면 메뉴를 닫는다", () => {
    render(
      <div>
        <AppSwitcher module="finance" onSwitch={vi.fn()} />
        <button type="button">바깥 영역</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /매출 관리/ }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "바깥 영역" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
