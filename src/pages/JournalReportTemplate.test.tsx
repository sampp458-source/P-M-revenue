// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { JournalReportPreview, JournalReportTemplate, JOURNAL_REPORT_HEIGHT, JOURNAL_REPORT_WIDTH } from "./JournalReportTemplate";
import type { JournalAssetSourceMap } from "./journalAssetSources";
import { buildJournalPreviewViewModel } from "./journalPreviewViewModel";
import { JOURNAL_ASSET_VERSION, JOURNAL_RENDERER_VERSION, JOURNAL_REQUIRED_ASSET_IDS, JOURNAL_TEMPLATE_VERSION } from "./journalRenderContract";
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
  it("applies a custom family only to the Teacher Comment body", () => {
    const viewModel = buildJournalPreviewViewModel(entry(), draft(), [entry(), friend]);
    render(<JournalReportTemplate viewModel={viewModel} teacherCommentFontFamily='"pnm-journal-user-font-test", sans-serif' />);
    expect(screen.getByTestId("journal-report-comment").style.fontFamily).toContain("pnm-journal-user-font-test");
    expect(screen.getByTestId("journal-report-template").style.fontFamily).not.toContain("pnm-journal-user-font-test");
  });

  it("injects the complete embedded export bundle without changing the preview template", () => {
    const assetSources = Object.fromEntries([
      ...JOURNAL_REQUIRED_ASSET_IDS,
      "official-logo",
    ].map((id) => [id, `data:image/png;base64,${btoa(id)}`])) as JournalAssetSourceMap;
    const viewModel = buildJournalPreviewViewModel(entry(), draft(), [entry(), friend]);
    render(<JournalReportTemplate viewModel={viewModel} assetSources={assetSources} />);
    const report = screen.getByTestId("journal-report-template");
    expect(report.querySelectorAll("img")).toHaveLength(8);
    expect(Array.from(report.querySelectorAll<HTMLImageElement>("img")).every((image) => image.src.startsWith("data:image/png"))).toBe(true);
    expect(Array.from(report.querySelectorAll("[data-journal-asset]")).map((node) => node.getAttribute("data-journal-asset")).sort())
      .toEqual([...JOURNAL_REQUIRED_ASSET_IDS].sort());
  });

  it("scales the fixed canonical geometry without responsive reflow", () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 540 });
    try {
      const viewModel = buildJournalPreviewViewModel(entry(), draft(), [entry(), friend]);
      render(<JournalReportPreview viewModel={viewModel} />);
      const preview = screen.getByTestId("journal-report-preview");
      const transformLayer = preview.firstElementChild as HTMLElement;
      const report = within(preview).getByTestId("journal-report-template");
      expect(preview.className).toContain("aspect-[3/4]");
      expect(transformLayer.style.transform).toBe("scale(0.5)");
      expect(report.style.width).toBe("1080px");
      expect(report.style.height).toBe("1440px");
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it("uses one fixed, overflow-hidden canonical canvas with complete information parity", () => {
    renderReport();
    const report = screen.getByTestId("journal-report-template");
    expect(report.style.width).toBe(`${JOURNAL_REPORT_WIDTH}px`);
    expect(report.style.height).toBe(`${JOURNAL_REPORT_HEIGHT}px`);
    expect(report.dataset.journalSource).toBe("typed-view-model");
    expect(report.dataset.journalRendererVersion).toBe(JOURNAL_RENDERER_VERSION);
    expect(report.dataset.journalTemplateVersion).toBe(JOURNAL_TEMPLATE_VERSION);
    expect(report.dataset.journalAssetVersion).toBe(JOURNAL_ASSET_VERSION);
    expect(report.className).toContain("overflow-hidden");
    expect(report.className).toContain("bg-[#fffcf8]");
    expect(report.className).toContain("text-[#25384a]");
    expect(report.style.backgroundImage).toBe("");
    expect(within(report).getByRole("heading", { name: "하루 일지" })).toBeTruthy();
    expect(screen.getByTestId("journal-official-logo").getAttribute("src")).toContain("pm-logo.png");
    expect(screen.getByTestId("journal-official-logo").className).toContain("h-[86px]");
    expect(screen.getByTestId("journal-official-logo").className).toContain("w-[220px]");
    expect(within(report).queryByText("P&M")).toBeNull();
    expect(screen.getByTestId("journal-official-logo").className).not.toContain("bg-[#2f6284]");
    expect(screen.getByTestId("journal-dog-name").className).toContain("left-[8px]");
    expect(screen.getByTestId("journal-dog-name").className).toContain("w-[270px]");
    expect(screen.getByTestId("journal-dog-name").className).not.toContain("border");
    expect(screen.getByTestId("journal-report-date").className).toContain("right-[29px]");
    expect(screen.getByTestId("journal-report-date").className).toContain("text-[24px]");
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
    expect(screen.getByTestId("journal-section-illustration-meal").getAttribute("src")).toContain("journal-meal-bowl.png");
    expect(screen.getByTestId("journal-section-illustration-manners").getAttribute("src")).toContain("journal-manners-book-medal.png");
    expect(screen.getByTestId("journal-section-illustration-physical").getAttribute("src")).toContain("journal-physical-ball-motion.png");
    expect(Array.from(report.querySelectorAll("[data-journal-asset]")).map((node) => node.getAttribute("data-journal-asset")).sort())
      .toEqual([...JOURNAL_REQUIRED_ASSET_IDS].sort());
    expect(report.innerHTML).not.toContain("#fff8ea");
    expect(report.innerHTML).not.toContain("#f9e3df");
    expect(report.innerHTML).not.toContain("#e3f0df");
    expect(report.innerHTML).not.toContain("#f9ebbd");
    expect(report.innerHTML).not.toContain("#e9e2f3");
    expect(new Set(Array.from(report.querySelectorAll("[data-journal-section]")).map((node) => node.getAttribute("data-journal-section"))).size).toBe(6);
    expect(report.querySelectorAll("[data-card-surface]")).toHaveLength(6);
    expect(report.querySelector("[data-journal-section='daily-status']")?.className).not.toContain("border-[3px]");
    expect(report.querySelector("[data-journal-section='meal-relationship']")?.className).not.toContain("border-");
    expect(report.querySelector("[data-journal-section='interlude']")?.className).not.toContain("border-");
    for (const heading of ["오늘의 컨디션", "배변 상태", "유치원에서 먹은 것", "오늘의 관계", "예절교육", "체육 시간", "선생님의 한마디"]) {
      expect(within(report).getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(screen.getByTestId("journal-best-friend-name").dataset.bestFriendPhrase).toBe("몽이예요 ♡");
    expect(screen.getByTestId("journal-best-friend-name").dataset.fontSize).toBe("44");
    expect(screen.getByTestId("journal-best-friend-name").style.fontSize).toBe("44px");
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
    expect(within(report).getByText("활발해요").closest("[data-selected]")?.getAttribute("style")).toContain("linear-gradient(176deg");
    expect(within(report).getByText("활발해요").closest("[data-selected]")?.className).toContain("text-[19px]");
    expect(within(report).getByText("평온해요").closest("[data-selected]")?.getAttribute("data-mark-variant")).toBe("1");
    expect(within(report).getByText("피곤해요").closest("[data-selected]")?.getAttribute("data-mark-variant")).toBe("2");
    expect(report.innerHTML).not.toContain("Math.random");
    expect(within(report).getByText("가져온 사료").closest("[data-selected]")?.getAttribute("style")).toBeNull();
  });

  it("clears stool selection in the presentation adapter when defecation is NO", () => {
    renderReport(draft({ defecation: false, stoolCondition: "good" }));
    const report = screen.getByTestId("journal-report-template");
    expect(within(report).getByText("좋아요").closest("[data-selected]")?.getAttribute("data-selected")).toBe("false");
    const xOptions = within(report).getAllByText("X").map((node) => node.closest("[data-selected]")?.getAttribute("data-selected"));
    expect(xOptions).toContain("true");
  });

  it("keeps every canonical stool and activity evaluation on a single line without shrinking body type", () => {
    renderReport();
    const report = screen.getByTestId("journal-report-template");
    for (const label of ["좋아요", "아주 묽어요", "조금 묽어요", "상태 안 좋아요", "참 잘했어요", "다음엔 더 잘할 수 있어요", "아직은 어려워요", "나는야 체육왕", "너무 재미있었어요", "오늘은 쉴래요"]) {
      expect(within(report).getByText(label).className).toContain("whitespace-nowrap");
      expect(within(report).getByText(label).closest("[data-selected]")?.className).toContain("text-[19px]");
    }
    expect(screen.getByTestId("journal-stool-status").innerHTML).toContain("grid-cols-2");
    const mannersLayout = within(report).getByText("아직은 어려워요").closest("[data-option-layout]");
    const physicalLayout = within(report).getByText("오늘은 쉴래요").closest("[data-option-layout]");
    expect(mannersLayout?.getAttribute("data-option-layout")).toBe("two-plus-one-left");
    expect(physicalLayout?.getAttribute("data-option-layout")).toBe("two-plus-one-left");
    expect(within(report).getByText("아직은 어려워요").closest("[data-selected]")?.className).toContain("justify-self-start");
    expect(within(report).getByText("오늘은 쉴래요").closest("[data-selected]")?.className).toContain("justify-self-start");
  });

  it("aligns the adjacent story headings and strengthens the best-friend introduction", () => {
    renderReport();
    const mealHeading = screen.getByRole("heading", { name: "유치원에서 먹은 것" });
    const relationshipHeading = screen.getByRole("heading", { name: "오늘의 관계" });
    expect(mealHeading.parentElement?.className).toContain("py-[12px]");
    expect(relationshipHeading.parentElement?.className).toContain("py-[12px]");
    expect(screen.getByText("오늘의 제일 친한 친구는").className).toContain("text-[20px]");
    expect(screen.getByTestId("journal-character-bestFriendDuo").className).not.toContain("mr-[-34px]");
    expect(screen.getByTestId("journal-character-bestFriendDuo").className).toContain("w-[224px]");
  });

  it("keeps normal and long header identities in deterministic non-title lanes", () => {
    renderReport();
    expect(screen.getByTestId("journal-character-dogAWaving").className).toContain("left-[50px]");
    expect(screen.getByTestId("journal-character-dogAWaving").className).toContain("h-[150px]");
    expect(screen.getByTestId("journal-dog-name").className).toContain("text-[32px]");
    cleanup();

    renderReport(draft(), entry({ dog: { id: "dog-1", name: "아주사랑스러운크리미공주님" } }));
    const longName = screen.getByTestId("journal-dog-name");
    expect(longName.textContent).toBe("아주사랑스러운크리미공주님");
    expect(longName.className).toContain("text-[20px]");
    expect(longName.className).toContain("bottom-[10px]");
    expect(longName.className).not.toContain("truncate");
  });

  it("keeps a long best-friend name complete without the duo overlap offset", () => {
    const longFriend = entry({ id: "entry-2", dog: { id: "dog-2", name: "세상에서제일친한몽이왕자님" } });
    render(<JournalReportTemplate viewModel={buildJournalPreviewViewModel(entry(), draft(), [entry(), longFriend])} />);
    const friendName = screen.getByTestId("journal-best-friend-name");
    expect(friendName.textContent).toBe(`${longFriend.dog.name}이에요 ♡`);
    expect(friendName.dataset.fontSize).toBe("30");
    expect(friendName.style.fontSize).toBe("30px");
    expect(friendName.className).toContain("px-[12px]");
    expect(friendName.className).not.toContain("truncate");
  });

  it("renders ordered multi-Dog and Teacher targets with Korean grammar and at least 22px type", () => {
    const friends = [
      friend,
      entry({ id: "entry-3", dog: { id: "dog-3", name: "가을" } }),
      entry({ id: "entry-4", dog: { id: "dog-4", name: "건달" } }),
      entry({ id: "entry-5", dog: { id: "dog-5", name: "먼지" } }),
    ];
    render(<JournalReportTemplate viewModel={buildJournalPreviewViewModel(entry(), draft({
      bestFriendTargets: [
        { type: "DOG", dogId: "dog-2" },
        { type: "DOG", dogId: "dog-3" },
        { type: "TEACHER", dogId: null },
        { type: "DOG", dogId: "dog-4" },
        { type: "DOG", dogId: "dog-5" },
      ],
    }), [entry(), ...friends])} />);
    const names = screen.getByTestId("journal-best-friend-name");
    expect(names.textContent).toBe("몽이, 가을, 선생님, 건달, 먼지예요 ♡");
    expect(names.dataset.bestFriendPhrase).toBe("몽이, 가을, 선생님, 건달, 먼지예요 ♡");
    expect(names.dataset.targetCount).toBe("5");
    expect(names.dataset.fontSize).toBe("30");
    expect(names.style.fontSize).toBe("30px");
    expect(names.dataset.layoutLines).toBe("몽이, 가을, 선생님,|건달, 먼지예요 ♡");
    expect(screen.getByTestId("journal-best-friend-suffix").textContent).toContain("예요");
  });

  it("keeps the optional empty Best Friend state free of a dangling particle", () => {
    renderReport(draft({ bestFriendDogId: null, bestFriendTargets: [] }));
    expect(screen.getByTestId("journal-best-friend-name").textContent).toBe("\u00a0");
    expect(screen.queryByTestId("journal-best-friend-suffix")).toBeNull();
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
    expect(name === "long dog" ? screen.getByTestId("journal-dog-name").textContent : screen.getByTestId("journal-best-friend-name").dataset.bestFriendPhrase).toContain(expected);
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
    [1, "가"],
    [65, "따뜻하고 즐거운 하루를 보냈습니다. ".repeat(8).slice(0, 65)],
    [182, "따뜻하고 즐거운 하루를 보냈습니다. 🐾 ".repeat(12).slice(0, 182)],
    [320, "친구들과 차분히 어울리며 다양한 활동을 즐겼습니다.\n".repeat(14).slice(0, 320)],
    [420, "친구들과 차분히 어울리며 다양한 활동을 즐겼습니다. 🐾\n".repeat(20).slice(0, 420)],
    [500, "오늘의 모습을 보호자님께 정성스럽게 전해 드립니다. 🐾💛\n".repeat(25).slice(0, 500)],
  ])("renders the full %i-character comment with fixed typography", (_length, comment) => {
    renderReport(draft({ teacherComment: comment }));
    const commentNode = screen.getByTestId("journal-report-comment");
    expect(commentNode.textContent).toBe(comment);
    expect(commentNode.dataset.commentDensity).toBe("fixed");
    expect(commentNode.style.fontSize).toBe("20px");
    expect(commentNode.style.lineHeight).toBe("1.36");
    expect(commentNode.style.width).toBe("751px");
    expect(commentNode.className).not.toContain("truncate");
    expect(commentNode.className).not.toContain("line-clamp");
  });
});
