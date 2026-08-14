// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { Button, FormAlert, FormSection, Modal, ModalActions, ResponsiveActionGroup } from "./ui";

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
});

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

  it("provides one section, error, modal context, size, and responsive action contract", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    render(
      <Modal open title="외출 처리" description="감자 · 장기호텔" size="large" onClose={() => undefined}>
        <FormSection title="이용 정보" description="날짜와 시간을 확인합니다.">
          <FormAlert>필수 항목을 확인해 주세요.</FormAlert>
        </FormSection>
        <ResponsiveActionGroup
          primary={<Button>복귀 처리</Button>}
          secondary={<Button variant="secondary">복귀 예정 변경</Button>}
          destructive={<Button variant="danger">객실 임시 해제</Button>}
        />
      </Modal>,
    );

    expect(screen.getByRole("dialog")).toHaveClass("max-w-3xl");
    expect(screen.getByText("감자 · 장기호텔")).toBeVisible();
    expect(screen.getByRole("heading", { name: "이용 정보" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("필수 항목");
    expect(screen.getByText("더보기 ···")).toHaveClass("min-h-11");
    expect(screen.getByText("더보기 ···")).toHaveClass("min-h-11");
    expect(screen.getByTestId("responsive-action-group").querySelectorAll("button")).toHaveLength(3);
  });
});
