// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerFamilyBookingForm } from "./CustomerFamilyBookingMock";

const dogs = Array.from({ length: 5 }, (_, index) => ({
  id: `dog-${index + 1}`,
  name: ["동동이", "마루", "콩이", "아주긴반려견이름테스트", "보리"][index],
  breed: "믹스",
}));

afterEach(cleanup);

describe("CustomerFamilyBookingForm", () => {
  it("keeps five Dog reservations independent after copying common values", () => {
    const onComplete = vi.fn();
    const { container } = render(
      <CustomerFamilyBookingForm
        customerId="customer-1"
        customerName="김혜리"
        dogs={dogs}
        onCancel={vi.fn()}
        onComplete={onComplete}
      />,
    );

    dogs.forEach((dog) => fireEvent.click(screen.getByRole("button", { name: `${dog.name} 믹스` })));
    expect(screen.getByText("5마리 선택")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("전체 시작일"), { target: { value: "2026-08-10" } });
    fireEvent.change(screen.getByLabelText(/전체 종료일/), { target: { value: "2026-08-12" } });
    fireEvent.click(screen.getByRole("button", { name: "전체 기간 적용" }));

    const dateInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="date"]'),
    );
    const starts = dateInputs.filter((_, index) => index >= 2 && index % 2 === 0);
    const ends = dateInputs.filter((_, index) => index >= 3 && index % 2 === 1);
    expect(starts).toHaveLength(5);
    expect(starts.every((input) => input.value === "2026-08-10")).toBe(true);
    expect(ends.every((input) => input.value === "2026-08-12")).toBe(true);

    fireEvent.change(ends[1], { target: { value: "2026-08-14" } });
    expect(ends[0].value).toBe("2026-08-12");
    expect(ends[1].value).toBe("2026-08-14");

    const secondCard = screen.getByRole("button", { name: /2 마루 호텔/ }).closest("article");
    expect(secondCard).not.toBeNull();
    fireEvent.click(within(secondCard!).getByRole("button", { name: "교육" }));
    expect(secondCard!.querySelector('input[type="time"]')).toBeNull();
    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(8);
  });

  it("offers a shared DELUXE preview only to eligible Hotel Dogs", () => {
    const onComplete = vi.fn();
    render(
      <CustomerFamilyBookingForm
        customerId="customer-1"
        customerName="김혜리"
        dogs={dogs.slice(0, 2)}
        onCancel={vi.fn()}
        onComplete={onComplete}
      />,
    );

    dogs.slice(0, 2).forEach((dog) => fireEvent.click(screen.getByRole("button", { name: `${dog.name} 믹스` })));
    const roomTypes = dogs.slice(0, 2).map((dog, index) => {
      const card = screen.getByRole("button", { name: new RegExp(`${index + 1} ${dog.name} 호텔`) }).closest("article");
      expect(card).not.toBeNull();
      return within(card!).getByRole("combobox") as HTMLSelectElement;
    });
    roomTypes.forEach((select) => fireEvent.change(select, { target: { value: "deluxe" } }));

    const sharedRoom = screen.getByRole("checkbox", { name: /같은 DELUXE 방 사용/ });
    fireEvent.click(sharedRoom);
    fireEvent.click(screen.getByRole("button", { name: "예약 생성" }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const booking = onComplete.mock.calls[0][0];
    expect(booking.dogs).toHaveLength(2);
    expect(booking.dogs.every((dog: { sharedRoomGroupKey: string | null }) => dog.sharedRoomGroupKey)).toBe(true);
  });

  it("creates a fresh request id for each newly mounted creation attempt", () => {
    const firstComplete = vi.fn();
    const first = render(
      <CustomerFamilyBookingForm
        customerId="customer-1"
        customerName="김혜리"
        dogs={dogs.slice(0, 1)}
        onCancel={vi.fn()}
        onComplete={firstComplete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "동동이 믹스" }));
    fireEvent.click(screen.getByRole("button", { name: "예약 생성" }));
    const firstRequestId = firstComplete.mock.calls[0][0].requestId;
    fireEvent.click(screen.getByRole("button", { name: "예약 생성" }));
    expect(firstComplete.mock.calls[1][0].requestId).toBe(firstRequestId);
    first.unmount();

    const secondComplete = vi.fn();
    render(
      <CustomerFamilyBookingForm
        customerId="customer-1"
        customerName="김혜리"
        dogs={dogs.slice(0, 1)}
        onCancel={vi.fn()}
        onComplete={secondComplete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "동동이 믹스" }));
    fireEvent.click(screen.getByRole("button", { name: "예약 생성" }));

    expect(firstRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secondComplete.mock.calls[0][0].requestId).not.toBe(firstRequestId);
  });
});
