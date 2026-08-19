// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { JournalReportTemplate, JOURNAL_REPORT_HEIGHT, JOURNAL_REPORT_WIDTH } from "./JournalReportTemplate";
import { buildJournalPreviewViewModel } from "./journalPreviewViewModel";
import type { JournalDraft, JournalRosterEntry } from "./journalRepository";

const entry = (overrides: Partial<JournalRosterEntry> = {}): JournalRosterEntry => ({
  id: "entry-1", journalDayId: "day-1", businessDate: "2026-08-15",
  dog: { id: "dog-1", name: "크리미" }, customer: { id: "customer-1", name: "박보호" }, status: "COMPLETED",
  conditionCodes: [], urination: null, defecation: null, stoolCondition: null, mealCodes: [],
  teacherRelationship: null, friendRelationship: null, bestFriendDogId: null,
  mannersActivityName: null, mannersEvaluation: null, physicalActivityName: null, physicalEvaluation: null,
  teacherComment: null, version: 1, createdAt: "2026-08-15T00:00:00Z", updatedAt: "2026-08-15T00:00:00Z", ...overrides,
});

const draft = (overrides: Partial<JournalDraft> = {}): JournalDraft => ({
  conditionCodes: ["active"], urination: true, defecation: true, stoolCondition: "good",
  mealCodes: ["daycare_food"], teacherRelationship: "loves_teacher", friendRelationship: "loves_friends",
  bestFriendDogId: "dog-2", mannersActivityName: "기다려", mannersEvaluation: "excellent",
  physicalActivityName: "노즈워크", physicalEvaluation: "fun", teacherComment: "오늘도 친구들과 즐겁게 지냈어요.", ...overrides,
});

const friend = entry({ id: "entry-2", dog: { id: "dog-2", name: "몽이" } });
const renderReport = (draftValue = draft(), entryValue = entry()) => render(
  <JournalReportTemplate viewModel={buildJournalPreviewViewModel(entryValue, draftValue, [entryValue, friend])} />,
);

afterEach(cleanup);

describe("Journal 1080x1440 report template", () => {
  it("uses one fixed, overflow-hidden canonical canvas with complete information parity", () => {
    renderReport();
    const report = screen.getByTestId("journal-report-template");
    expect(report.style.width).toBe(`${JOURNAL_REPORT_WIDTH}px`);
    expect(report.style.height).toBe(`${JOURNAL_REPORT_HEIGHT}px`);
    expect(report.className).toContain("overflow-hidden");
    expect(report.className).toContain("bg-[#fffcf8]");
    expect(report.className).toContain("text-[#25384a]");
    expect(report.style.backgroundImage).toBe("");
    expect(within(report).getByRole("heading", { name: "하루 일지" })).toBeTruthy();
    expect(within(report).queryByText("오늘의 하루 일지")).toBeNull();
    expect(within(report).queryByText("P&M CHARACTER DIARY")).toBeNull();
    expect(within(report).queryByText("WITH LOVE")).toBeNull();
    expect(report.querySelector("canvas")).toBeNull();
    expect(report.querySelector("[style*='background-image: url']")).toBeNull();
    expect(report.querySelectorAll("[data-testid='journal-dog-hero']")).toHaveLength(0);
    expect(report.querySelectorAll("[data-testid^='journal-character-']")).toHaveLength(4);
    expect(screen.getByTestId("journal-character-dogAWaving").getAttribute("src")).toContain("journal-dog-a-waving.png");
    expect(screen.getByTestId("journal-character-dogBPeeking").getAttribute("src")).toContain("journal-dog-b-peeking.png");
    expect(screen.getByTestId("journal-character-bestFriendDuo").getAttribute("src")).toContain("journal-dog-duo-best-friend.png");
    expect(screen.getByTestId("journal-character-dogAHeartLetter").getAttribute("src")).toContain("journal-dog-a-heart-letter.png");
    expect(report.innerHTML).not.toContain("#fff8ea");
    expect(report.innerHTML).not.toContain("#f9e3df");
    expect(report.innerHTML).not.toContain("#e3f0df");
    expect(report.innerHTML).not.toContain("#f9ebbd");
    expect(report.innerHTML).not.toContain("#e9e2f3");
    expect(new Set(Array.from(report.querySelectorAll("[data-journal-section]")).map((node) => node.getAttribute("data-journal-section"))).size).toBeGreaterThanOrEqual(7);
    for (const heading of ["오늘의 컨디션", "배변 상태", "유치원에서 먹은 것", "오늘의 관계", "예절교육", "체육 시간", "선생님의 한마디"]) {
      expect(within(report).getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(within(report).getByText("몽이")).toBeTruthy();
    expect(within(report).getByText("오늘도 친구들과 즐겁게 지냈어요.")).toBeTruthy();
  });

  it("keeps every option visible while clearly marking multi-selection", () => {
    renderReport(draft({ conditionCodes: ["active", "calm"], mealCodes: [] }));
    const report = screen.getByTestId("journal-report-template");
    for (const label of ["활발해요", "평온해요", "피곤해요", "예민해요", "가져온 사료", "유치원 사료", "가져온 간식", "유치원 간식"]) {
      expect(within(report).getByText(label)).toBeTruthy();
    }
    expect(within(report).getByText("활발해요").closest("[data-selected]")?.getAttribute("data-selected")).toBe("true");
    expect(within(report).getByText("평온해요").closest("[data-selected]")?.getAttribute("data-selected")).toBe("true");
    expect(within(report).getByText("가져온 사료").closest("[data-selected]")?.getAttribute("data-selected")).toBe("false");
    expect(within(report).getByText("활발해요").closest("[data-selected]")?.getAttribute("style")).toContain("linear-gradient(178deg");
    expect(within(report).getByText("가져온 사료").closest("[data-selected]")?.getAttribute("style")).toBeNull();
  });

  it("clears stool selection in the presentation adapter when defecation is NO", () => {
    renderReport(draft({ defecation: false, stoolCondition: "good" }));
    const report = screen.getByTestId("journal-report-template");
    expect(within(report).getByText("좋아요").closest("[data-selected]")?.getAttribute("data-selected")).toBe("false");
    const xOptions = within(report).getAllByText("X").map((node) => node.closest("[data-selected]")?.getAttribute("data-selected"));
    expect(xOptions).toContain("true");
  });

  it.each([
    ["best friend empty", draft({ bestFriendDogId: null })],
    ["activities empty", draft({ mannersActivityName: "", mannersEvaluation: null, physicalActivityName: "", physicalEvaluation: null })],
    ["incomplete", draft({ conditionCodes: [], urination: null, defecation: null, teacherRelationship: null, friendRelationship: null, teacherComment: "" })],
  ])("renders %s without adding invented result values", (_name, value) => {
    renderReport(value);
    expect(screen.getByTestId("journal-report-template")).toBeTruthy();
    expect(screen.queryByText("없음")).toBeNull();
    expect(screen.queryByText("안 먹었어요")).toBeNull();
  });

  it.each([
    ["long dog", entry({ dog: { id: "dog-1", name: "아주사랑스럽고긴이름을가진크리미공주님" } })],
    ["long friend", entry()],
  ])("keeps %s data untruncated", (name, entryValue) => {
    const longFriend = entry({ id: "entry-2", dog: { id: "dog-2", name: "세상에서제일친한몽이왕자님과함께" } });
    const viewModel = buildJournalPreviewViewModel(entryValue, draft(), [entryValue, longFriend]);
    if (name === "long friend") viewModel.bestFriendName = longFriend.dog.name;
    render(<JournalReportTemplate viewModel={viewModel} />);
    const expected = name === "long dog" ? entryValue.dog.name : longFriend.dog.name;
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.getByTestId("journal-report-template").innerHTML).not.toContain("line-clamp");
    expect(screen.getByTestId("journal-report-template").innerHTML).not.toContain("truncate");
  });

  it.each([
    ["manners", { mannersActivityName: "반려견 동물등록지도사 실전교육을 차분하게 끝까지 수행하는 긴 활동" }],
    ["physical", { physicalActivityName: "친구들과 함께하는 균형감각 장애물 통과 체육 활동" }],
  ] as const)("keeps long %s activity text complete", (_name, override) => {
    renderReport(draft(override));
    expect(screen.getByText(Object.values(override)[0])).toBeTruthy();
  });

  it.each([
    ["short", "짧고 즐거운 하루였어요."],
    ["medium", "따뜻하고 즐거운 하루를 보냈습니다. ".repeat(12).slice(0, 220)],
    ["long", "친구들과 차분히 어울리며 다양한 활동을 즐겼습니다. ".repeat(12).slice(0, 350)],
    ["very-long", "오늘의 모습을 보호자님께 정성스럽게 전해 드립니다. ".repeat(25).slice(0, 499)],
  ])("renders the full %s comment with adaptive typography", (density, comment) => {
    renderReport(draft({ teacherComment: comment }));
    const commentNode = screen.getByTestId("journal-report-comment");
    expect(commentNode.textContent).toBe(comment);
    expect(commentNode.dataset.commentDensity).toBe(density);
    expect(commentNode.className).not.toContain("truncate");
    expect(commentNode.className).not.toContain("line-clamp");
  });
});
