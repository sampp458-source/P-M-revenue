// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it } from "vitest";
import { HotelOperationJourney } from "./HotelOperationJourney";
afterEach(cleanup);
it("announces the current step without introducing submit or navigation controls", () => {
  const { container, rerender } = render(<HotelOperationJourney timeReady={false} roomReady={false} recovery />);
  expect(container.querySelector('[aria-current="step"]')).toHaveTextContent("실제 시각");
  expect(screen.getByText("누락 기록 확인")).toBeVisible();
  rerender(<HotelOperationJourney timeReady roomReady={false} />);
  expect(container.querySelector('[aria-current="step"]')).toHaveTextContent("객실 확인");
  rerender(<HotelOperationJourney timeReady roomReady />);
  expect(container.querySelector('[aria-current="step"]')).toHaveTextContent("최종 확정");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rerender(<HotelOperationJourney timeReady roomReady={false} />);
  expect(container.querySelector('[aria-current="step"]')).toHaveTextContent("객실 확인");
  expect(container.querySelectorAll('[data-complete]')).toHaveLength(1);
});
