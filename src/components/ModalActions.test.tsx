// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { Button, Modal, ModalActions } from "./ui";

afterEach(cleanup);

describe("ModalActions", () => {
  it("keeps primary actions sticky and safe-area aware on mobile but natural on desktop", () => {
    render(
      <Modal open title="모바일 작업" onClose={() => undefined}>
        <div className="min-h-[900px]">긴 양식</div>
        <ModalActions>
          <Button variant="secondary">취소</Button>
          <Button>저장</Button>
        </ModalActions>
      </Modal>,
    );

    const actions = screen.getByTestId("modal-actions");
    expect(actions).toHaveClass("sticky", "-bottom-5", "grid", "grid-cols-2");
    expect(actions.className).toContain("env(safe-area-inset-bottom)");
    expect(actions).toHaveClass("sm:static", "sm:flex", "sm:justify-end");
    expect(screen.getByRole("button", { name: "취소" })).toBeVisible();
    expect(screen.getByRole("button", { name: "저장" })).toBeVisible();
  });

  it("keeps the operational modal surfaces on the shared footer contract", () => {
    for (const file of [
      "DaycareReservationModal.tsx",
      "DaycareOperationsPanel.tsx",
      "LongStayRegistrationForm.tsx",
      "LongStayOperationsPanel.tsx",
      "SharedHotelRoomModal.tsx",
      "HotelOperationsModals.tsx",
      "OperationsToday.tsx",
    ]) {
      expect(readFileSync(resolve(process.cwd(), "src/pages", file), "utf8")).toContain("<ModalActions>");
    }
  });
});
