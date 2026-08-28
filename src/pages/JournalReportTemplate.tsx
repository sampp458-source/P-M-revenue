import { Check, CircleUserRound, Dumbbell, Flower2, Heart, Medal, MessageCircleHeart, PawPrint, Salad, Sparkles } from "lucide-react";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { JournalCharacterName, JournalSectionIllustrationName } from "../assets/journal/journalAssets";
import { JOURNAL_BUNDLED_ASSET_SOURCES, type JournalAssetSourceMap } from "./journalAssetSources";
import { journalViewModelRevision, JOURNAL_ASSET_VERSION, JOURNAL_RENDERER_VERSION, JOURNAL_TEMPLATE_VERSION, type JournalRequiredAssetId } from "./journalRenderContract";
import {
  JOURNAL_REPORT_FONT_FAMILY,
  JOURNAL_REPORT_HEIGHT,
  JOURNAL_REPORT_LAYOUT,
  JOURNAL_REPORT_PALETTE,
  JOURNAL_REPORT_TYPOGRAPHY,
  JOURNAL_REPORT_WIDTH,
  journalActivityFontSize,
  journalCommentTypography,
  journalDogNameFontSize,
} from "./journalReportScene";
import type { JournalPreviewActivity, JournalPreviewOption, JournalPreviewViewModel } from "./journalPreviewViewModel";
import { normalizedJournalBestFriendDisplayTargets, resolveJournalBestFriendLayout, type JournalBestFriendDisplayTarget } from "./journalBestFriendPresentation";

export { JOURNAL_REPORT_WIDTH, JOURNAL_REPORT_HEIGHT } from "./journalReportScene";

type Palette = "coral" | "green" | "amber" | "lavender";
const palette = {
  coral: { ...JOURNAL_REPORT_PALETTE.coral, ink: JOURNAL_REPORT_PALETTE.ink, highlight: "rgb(255 233 237 / 0.9)" },
  green: { ...JOURNAL_REPORT_PALETTE.green, ink: JOURNAL_REPORT_PALETTE.ink, highlight: "rgb(230 247 239 / 0.95)" },
  amber: { ...JOURNAL_REPORT_PALETTE.amber, ink: JOURNAL_REPORT_PALETTE.ink, highlight: "rgb(255 243 188 / 0.9)" },
  lavender: { ...JOURNAL_REPORT_PALETTE.lavender, ink: JOURNAL_REPORT_PALETTE.ink, highlight: "rgb(241 235 255 / 0.95)" },
} as const;

export function JournalReportTemplate({
  viewModel,
  reportRef,
  testId = "journal-report-template",
  assetSources = JOURNAL_BUNDLED_ASSET_SOURCES,
  teacherCommentFontFamily = JOURNAL_REPORT_FONT_FAMILY,
}: {
  viewModel: JournalPreviewViewModel;
  reportRef?: Ref<HTMLElement>;
  testId?: string;
  assetSources?: JournalAssetSourceMap;
  teacherCommentFontFamily?: string;
}) {
  return (
    <JournalAssetSourceContext.Provider value={assetSources}>
      <article
        ref={reportRef}
        data-testid={testId}
        data-journal-source="typed-view-model"
        data-journal-renderer-version={JOURNAL_RENDERER_VERSION}
        data-journal-template-version={JOURNAL_TEMPLATE_VERSION}
        data-journal-asset-version={JOURNAL_ASSET_VERSION}
        data-journal-entry-id={viewModel.entryId}
        data-journal-view-model-revision={journalViewModelRevision(viewModel)}
        aria-label={`${viewModel.dogName} 하루 일지 결과지`}
        className="relative flex shrink-0 flex-col overflow-hidden bg-[#fffcf8] text-[#25384a]"
        style={{
          width: JOURNAL_REPORT_WIDTH,
          height: JOURNAL_REPORT_HEIGHT,
          padding: JOURNAL_REPORT_LAYOUT.pagePadding,
          fontFamily: JOURNAL_REPORT_FONT_FAMILY,
        }}
      >
        <span className="pointer-events-none absolute inset-[17px] rounded-[52px] border-[3px] border-[#e6eef4]" />
        <ReportHeader viewModel={viewModel} />

        <main
          className="relative z-10 grid min-h-0 flex-1 grid-rows-[170px_206px_120px_178px_minmax(0,1fr)]"
          style={{ marginTop: JOURNAL_REPORT_LAYOUT.mainGap * 2, gap: JOURNAL_REPORT_LAYOUT.mainGap }}
        >
          <DailyStatusComposition viewModel={viewModel} />

          <MealRelationshipComposition viewModel={viewModel} />

          <BestFriendRibbon targets={normalizedJournalBestFriendDisplayTargets(viewModel)} />

          <div data-card-surface="activities" className="relative grid grid-cols-[0.96fr_1.04fr] gap-[20px] overflow-hidden rounded-[36px_20px_42px_24px] bg-[linear-gradient(104deg,#fffafb_0%,#fffafb_46%,#fbfffd_54%,#fbfffd_100%)] px-[8px]">
            <span className="absolute left-1/2 top-[28px] h-[118px] border-l-2 border-dotted border-[#dbe7ef]/80" />
            <ActivityCard activity={viewModel.manners} icon={<Medal size={25} />} paletteName="coral" motif="medal" />
            <ActivityCard activity={viewModel.physical} icon={<Dumbbell size={25} />} paletteName="green" motif="movement" />
          </div>

          <TeacherComment comment={viewModel.teacherComment} fontFamily={teacherCommentFontFamily} />
        </main>
      </article>
    </JournalAssetSourceContext.Provider>
  );
}

const JournalAssetSourceContext = createContext<JournalAssetSourceMap>(JOURNAL_BUNDLED_ASSET_SOURCES);

function DailyStatusComposition({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  return (
    <section data-journal-section="daily-status" data-card-surface="daily-status" aria-label="오늘의 상태" className="relative grid grid-cols-[0.9fr_1.1fr] overflow-hidden rounded-[46px_22px_38px_28px] bg-[linear-gradient(102deg,#fffafb_0%,#fffafb_45%,#fbfffd_45%,#fbfffd_100%)] px-[24px]">
      <span className="absolute -left-[10px] top-[8px] h-[58px] w-[96px] rotate-[-5deg] rounded-[50%] bg-[#ffe9ed]/62" />
      <span className="absolute right-[18px] bottom-[5px] h-[38px] w-[118px] rotate-[2deg] rounded-[50%] bg-[#e6f7ef]/72" />
      <div className="relative py-[4px] pr-[28px]" style={{ "--journal-selected": palette.coral.highlight } as React.CSSProperties}>
        <SectionHeading title="오늘의 컨디션" icon={<Sparkles size={24} />} color={palette.coral.accent} />
        <Options options={viewModel.conditionOptions} columns={2} compact />
        <span className="absolute bottom-[8px] left-[42px] h-[5px] w-[144px] rotate-[-1deg] rounded-full bg-[#ffb8bc]/32" />
      </div>
      <div className="relative py-[4px] pl-[30px]" style={{ "--journal-selected": palette.green.highlight } as React.CSSProperties}>
        <span className="absolute left-0 top-[22px] h-[104px] border-l-2 border-dotted border-[#cfeede]" />
        <SectionHeading title="배변 상태" icon={<Flower2 size={24} />} color={palette.green.accent} />
        <div className="grid grid-cols-[0.55fr_0.55fr_1.9fr] gap-[8px]">
          <Binary label="소변" options={viewModel.urinationOptions} />
          <Binary label="대변" options={viewModel.defecationOptions} />
          <div data-testid="journal-stool-status"><SmallLabel>대변 상태</SmallLabel><Options options={viewModel.stoolOptions} columns={2} compact singleLine /></div>
        </div>
      </div>
    </section>
  );
}

function MealRelationshipComposition({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  return (
    <section data-journal-section="meal-relationship" data-card-surface="story" aria-label="식사와 관계 이야기" className="relative grid grid-cols-[0.74fr_1.26fr] gap-[22px] overflow-visible px-[9px]">
      <div className="relative self-stretch rounded-[30px_48px_24px_38px] bg-[#fffef8] px-[17px] py-[12px]" style={{ "--journal-selected": palette.amber.highlight } as React.CSSProperties}>
        <span className="absolute -left-[8px] top-[17px] h-[132px] w-[116px] rotate-[-5deg] rounded-[48%] bg-[#fff3bc]/38" />
        <JournalSectionIllustration name="meal" className="absolute -right-[5px] -top-[13px] h-[90px] w-[120px] rotate-[3deg] opacity-90" />
        <SectionHeading title="유치원에서 먹은 것" icon={<Salad size={24} />} color={palette.amber.accent} />
        <span className="mb-[5px] ml-[42px] block h-[5px] w-[126px] rotate-[-1deg] rounded-full bg-[#f5e39d]/72" />
        <Options options={viewModel.mealOptions} columns={2} />
      </div>
      <RelationshipStory viewModel={viewModel} />
    </section>
  );
}

export function JournalReportPreview({ viewModel, className = "", teacherCommentFontFamily = JOURNAL_REPORT_FONT_FAMILY }: { viewModel: JournalPreviewViewModel; className?: string; teacherCommentFontFamily?: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => setScale((wrapper.clientWidth || JOURNAL_REPORT_WIDTH) / JOURNAL_REPORT_WIDTH);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className={`relative aspect-[3/4] w-full overflow-hidden ${className}`} data-testid="journal-report-preview">
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
        <JournalReportTemplate viewModel={viewModel} teacherCommentFontFamily={teacherCommentFontFamily} />
      </div>
    </div>
  );
}

function ReportHeader({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  const sources = useContext(JournalAssetSourceContext);
  return (
    <header data-card-surface="header" className="relative z-10 h-[235px] shrink-0 overflow-hidden rounded-[52px_52px_38px_38px] border-[3px] border-[#dbeaf4] bg-white px-[34px] py-[17px] shadow-[0_8px_24px_rgb(47_98_132_/_0.055)]">
      <span className="absolute left-[26px] top-[24px] h-[150px] w-[150px] rounded-full bg-[#ffe9ed]/52" />
      <span className="absolute right-[24px] top-[28px] h-[144px] w-[174px] rounded-[48px] bg-[#e8f4fc]/78" />
      <JournalCharacter name="dogAWaving" className="absolute left-[50px] top-[6px] h-[150px] w-[150px] object-contain" />
      <JournalCharacter name="dogBPeeking" className="absolute right-[8px] top-[41px] h-[142px] w-[205px] object-contain" />

      <div className="mx-auto flex w-[590px] flex-col items-center">
        <img
          src={sources["official-logo"]}
          alt="P&M"
          data-testid="journal-official-logo"
          className="h-[86px] w-[220px] object-contain"
          style={{ filter: "brightness(0) saturate(100%) invert(32%) sepia(22%) saturate(1195%) hue-rotate(158deg) brightness(92%) contrast(90%)" }}
          onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
        />
        <div className="relative mt-[-13px] px-[42px] pb-[11px]">
          <span className="absolute inset-x-[18px] bottom-[5px] h-[15px] -rotate-1 rounded-full bg-[#ff7f82]/42" />
          <h1 className="relative text-[52px] font-black tracking-[-0.055em] text-[#2f6284]">하루 일지</h1>
        </div>
      </div>

      <p data-testid="journal-dog-name" className={headerDogNameClass(viewModel.dogName)}>{viewModel.dogName}</p>
      <p data-testid="journal-report-date" className="absolute bottom-[14px] right-[29px] w-[190px] text-center text-[24px] font-bold tabular-nums text-[#718395]">{viewModel.displayDate}</p>
    </header>
  );
}

function RelationshipStory({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  return (
    <div aria-label="오늘의 관계" className="relative self-stretch overflow-hidden rounded-[52px_24px_46px_30px] bg-[#fdfcff] px-[19px] py-[12px]" style={{ "--journal-selected": "rgb(241 235 255 / 0.95)" } as React.CSSProperties}>
      <span className="absolute right-[34px] top-[8px] h-[50px] w-[92px] rotate-[4deg] rounded-[50%] bg-[#f1ebff]/72" />
      <Heart className="absolute right-[48px] top-[20px] text-[#ff7f82]" fill="#ffe9ed" size={22} />
      <SectionHeading title="오늘의 관계" icon={<CircleUserRound size={24} />} color="#8a75bc" />
      <div className="relative grid grid-cols-[0.96fr_1.04fr] gap-[18px]">
        <span className="absolute left-1/2 top-[10px] h-[102px] border-l-2 border-dotted border-[#ddd4fa]/80" />
        <Relationship label="선생님과" options={viewModel.teacherRelationshipOptions} scene="teacher" />
        <Relationship label="친구들과" options={viewModel.friendRelationshipOptions} scene="friends" />
      </div>
    </div>
  );
}

function Relationship({ label, options, scene }: { label: string; options: JournalPreviewOption[]; scene: "teacher" | "friends" }) {
  return (
    <div className={`relative px-[7px] py-[3px] ${scene === "teacher" ? "pr-[13px]" : "pl-[13px]"}`}>
      <div className="mb-[1px] flex items-center justify-between"><SmallLabel>{label}</SmallLabel>{scene === "teacher" ? <Heart className="text-[#ff7f82]" fill="#ffe9ed" size={18} /> : <PawPrint className="text-[#5d9ac2]" size={20} />}</div>
      <div className="grid gap-[1px]">{options.map((option, index) => <Option key={option.code} option={option} compact variant={index} />)}</div>
    </div>
  );
}

function BestFriendRibbon({ targets }: { targets: JournalBestFriendDisplayTarget[] }) {
  const layout = resolveJournalBestFriendLayout(targets);
  return (
    <section data-journal-section="interlude" data-card-surface="best-friend" className="relative flex min-w-0 items-center justify-center overflow-hidden px-[28px]" aria-label="오늘의 제일 친한 친구">
      <span className="absolute left-[183px] top-[15px] h-[90px] w-[610px] rotate-[-1deg] rounded-[48%] bg-[#f5fbff]/88" />
      <span className="absolute left-[352px] bottom-[10px] h-[7px] w-[286px] rotate-[1deg] rounded-full bg-[#b9dced]/48" />
      <div className="relative flex h-full w-[720px] items-center justify-center gap-[8px]">
        <span className="absolute left-[108px] top-[19px] h-[58px] w-[68px] rotate-[-8deg] rounded-[50%] bg-[#ffe9ed]/55" />
        <JournalCharacter name="bestFriendDuo" className="relative z-10 h-[108px] w-[224px] shrink-0 self-end object-contain object-bottom" />
        <div className="relative z-10 flex w-[480px] min-w-0 flex-col items-center justify-center">
          <p className="text-[20px] font-black tracking-[-0.02em] text-[#607488]">오늘의 제일 친한 친구는</p>
          <strong
            data-testid="journal-best-friend-name"
            data-target-count={targets.length}
            data-best-friend-phrase={layout.phrase}
            data-layout-lines={layout.lines.join("|")}
            data-line-count={layout.lineCount}
            data-font-size={layout.fontSize}
            className={bestFriendNameClass()}
            style={{ maxWidth: layout.maxTextWidth, fontSize: layout.fontSize, lineHeight: `${layout.lineHeight}px` }}
          >
            {layout.lines.length > 0 ? layout.lines.map((line, index) => (
              <span key={`${index}-${line}`}>
                {index > 0 ? " " : null}
                <span data-testid={line.endsWith("♡") ? "journal-best-friend-suffix" : undefined} className="block whitespace-nowrap">
                  {line.endsWith("♡") ? <>{line.slice(0, -1)}<span className="text-[#ff7f82]">♡</span></> : line}
                </span>
              </span>
            )) : "\u00a0"}
          </strong>
        </div>
      </div>
    </section>
  );
}

function ActivityCard({ activity, icon, paletteName, motif }: { activity: JournalPreviewActivity; icon: ReactNode; paletteName: Palette; motif: "medal" | "movement" }) {
  const colors = palette[paletteName];
  const activitySize = journalActivityFontSize(activity.activityName.length);
  const activityClass = activitySize === 17 ? "text-[17px] leading-[1.18]" : activitySize === 21 ? "text-[21px] leading-[1.2]" : "text-[28px] leading-[1.2]";
  return (
    <section data-journal-section={motif} aria-label={activity.title} className={`relative overflow-visible px-[17px] py-[8px] ${motif === "medal" ? "pr-[22px]" : "pl-[22px]"}`} style={{ color: colors.ink, "--journal-selected": colors.highlight } as React.CSSProperties}>
      <span className={`absolute inset-x-[8px] bottom-[7px] top-[15px] rounded-[48%] ${motif === "medal" ? "rotate-[-1deg] bg-[#fffafb]" : "rotate-[1deg] bg-[#fbfffd]"}`} />
      <JournalSectionIllustration name={motif === "medal" ? "manners" : "physical"} className={`absolute z-10 object-contain opacity-90 ${motif === "medal" ? "-left-[2px] -top-[5px] h-[52px] w-[76px] rotate-[-3deg]" : "-right-[1px] -top-[9px] h-[62px] w-[94px] rotate-[3deg]"}`} />
      <div className="relative">
      <div className={motif === "medal" ? "pl-[58px]" : "pr-[62px]"}>
      <SectionHeading title={activity.title} icon={icon} color={colors.accent} />
      </div>
      <div className={`flex h-[47px] items-center justify-center px-[10px] pb-[3px] text-center font-black text-[#25384a] ${activityClass}`}><span className="max-w-full whitespace-normal break-words">{activity.activityName || "\u00a0"}</span></div>
      <span className={`mx-auto block h-[4px] w-[58%] rounded-full ${motif === "medal" ? "rotate-[-1deg] bg-[#ffd9df]/75" : "rotate-[1deg] bg-[#cfeede]/80"}`} />
      <div className="mt-[1px]"><Options options={activity.options} columns={3} compact singleLine layout="activity" /></div>
      </div>
    </section>
  );
}

function TeacherComment({ comment, fontFamily }: { comment: string; fontFamily: string }) {
  const typography = journalCommentTypography(comment.length);
  return (
    <section data-journal-section="letter" data-card-surface="teacher-comment" aria-label="선생님의 한마디" className="relative min-h-0 overflow-hidden rounded-[30px_52px_34px_48px] border-[3px] border-[#ffd9df] bg-white px-[34px] pb-[22px] pt-[16px] shadow-[0_8px_22px_rgb(47_98_132_/_0.04)]">
      <span className="absolute right-0 top-0 h-[88px] w-[132px] bg-[#ffe9ed]/66 [clip-path:polygon(100%_0,100%_100%,0_0)]" />
      <JournalCharacter name="dogAHeartLetter" className="absolute bottom-[7px] right-[11px] h-[174px] w-[158px] object-contain object-bottom" />
      <h2 aria-label="선생님의 한마디" className="relative mb-[8px] flex items-center gap-[10px] text-[27px] font-black tracking-[-0.025em] text-[#2f6284]" style={{ fontSize: JOURNAL_REPORT_TYPOGRAPHY.commentHeading.size, lineHeight: `${JOURNAL_REPORT_TYPOGRAPHY.commentHeading.lineHeight}px`, letterSpacing: JOURNAL_REPORT_TYPOGRAPHY.commentHeading.letterSpacing }}><span className="flex h-[40px] w-[40px] items-center justify-center rounded-[15px_20px_14px_21px] bg-[#ffe9ed] text-[#ff7f82]"><MessageCircleHeart size={27} /></span>선생님의 한마디</h2>
      <span className="absolute left-[30px] top-[61px] text-[50px] font-black leading-none text-[#ffb8bc]/58">“</span>
      <p data-testid="journal-report-comment" data-comment-density={typography.density} className="relative h-[calc(100%-48px)] whitespace-pre-wrap break-words pl-[27px] font-normal tracking-[-0.01em] text-[#25384a]" style={{ width: `${typography.textWidth + 27}px`, fontFamily, fontSize: `${typography.size}px`, lineHeight: typography.lineHeight }}>{comment}</p>
    </section>
  );
}

function SectionHeading({ title, icon, color }: { title: string; icon: ReactNode; color: string }) {
  return <h2 className="relative mb-[5px] flex items-center gap-[8px] text-[26px] font-black tracking-[-0.025em]" style={{ color, fontSize: JOURNAL_REPORT_TYPOGRAPHY.heading.size, lineHeight: `${JOURNAL_REPORT_TYPOGRAPHY.heading.lineHeight}px`, letterSpacing: JOURNAL_REPORT_TYPOGRAPHY.heading.letterSpacing }}><span className="flex h-[36px] w-[36px] items-center justify-center rounded-[13px_20px_14px_21px] bg-[#f6f9fb]">{icon}</span>{title}</h2>;
}

function Options({
  options,
  columns,
  compact = false,
  singleLine = false,
  layout = "equal",
}: {
  options: JournalPreviewOption[];
  columns: 2 | 3;
  compact?: boolean;
  singleLine?: boolean;
  layout?: "equal" | "activity";
}) {
  const columnClass = layout === "activity" ? "grid-cols-[0.9fr_1.55fr]" : columns === 3 ? "grid-cols-3" : "grid-cols-2";
  return (
    <div data-option-layout={layout === "activity" ? "two-plus-one-left" : "equal"} className={`grid gap-x-[3px] gap-y-[2px] ${columnClass}`}>
      {options.map((option, index) => (
        <Option
          key={option.code}
          option={option}
          compact={compact}
          variant={index}
          singleLine={singleLine}
          className={layout === "activity" && index === 2 ? "col-span-2 justify-self-start" : ""}
        />
      ))}
    </div>
  );
}

const markVariants = [
  "rotate-[-7deg] rounded-[46%_54%_43%_57%]",
  "rotate-[4deg] rounded-[54%_46%_58%_42%]",
  "rotate-[-2deg] rounded-[43%_57%_52%_48%]",
] as const;

const highlightVariants = [
  "linear-gradient(176deg, transparent 47%, var(--journal-selected, rgb(255 233 237 / 0.9)) 47%, var(--journal-selected, rgb(255 233 237 / 0.9)) 89%, transparent 89%)",
  "linear-gradient(179deg, transparent 45%, var(--journal-selected, rgb(255 233 237 / 0.9)) 45%, var(--journal-selected, rgb(255 233 237 / 0.9)) 88%, transparent 88%)",
  "linear-gradient(174deg, transparent 49%, var(--journal-selected, rgb(255 233 237 / 0.9)) 49%, var(--journal-selected, rgb(255 233 237 / 0.9)) 90%, transparent 90%)",
] as const;

function Option({ option, compact = false, variant = 0, singleLine = false, className = "" }: { option: JournalPreviewOption; compact?: boolean; variant?: number; singleLine?: boolean; className?: string }) {
  const variantIndex = variant % markVariants.length;
  return (
    <div className={`relative flex min-w-0 items-center px-[4px] ${compact ? "min-h-[31px] text-[19px]" : "min-h-[36px] text-[22px]"} ${option.selected ? "font-black text-[#25384a]" : "font-semibold text-[#667786]"} ${className}`} style={option.selected ? { background: highlightVariants[variantIndex] } : undefined} data-selected={option.selected ? "true" : "false"} data-mark-variant={variantIndex}>
      <span className={`mr-[6px] flex h-[23px] w-[23px] shrink-0 items-center justify-center border font-black ${markVariants[variantIndex]} ${option.selected ? "border-[2px] border-[#ff9da2]/75 text-[#ff646a]" : "border-[1.5px] border-[#aebdc8] text-transparent"}`}>{option.selected ? <Check className="rotate-[-4deg]" size={18} strokeWidth={3.4} /> : <span aria-hidden="true">·</span>}</span>
      <span className={`min-w-0 break-keep leading-[1.14] ${singleLine ? "whitespace-nowrap" : ""}`}>{option.label}</span>
    </div>
  );
}

function Binary({ label, options }: { label: string; options: JournalPreviewOption[] }) {
  return <div><SmallLabel>{label}</SmallLabel><Options options={options} columns={2} compact /></div>;
}

function SmallLabel({ children }: { children: ReactNode }) {
  return <p className="mb-[1px] text-[18px] font-extrabold text-[#52697c]" style={{ fontSize: JOURNAL_REPORT_TYPOGRAPHY.smallLabel.size, fontWeight: JOURNAL_REPORT_TYPOGRAPHY.smallLabel.weight, lineHeight: `${JOURNAL_REPORT_TYPOGRAPHY.smallLabel.lineHeight}px`, letterSpacing: JOURNAL_REPORT_TYPOGRAPHY.smallLabel.letterSpacing }}>{children}</p>;
}

const characterAssetId: Record<JournalCharacterName, JournalRequiredAssetId> = {
  dogAWaving: "header-dog-a",
  dogBPeeking: "header-dog-b",
  bestFriendDuo: "best-friend-duo",
  dogAHeartLetter: "teacher-comment-dog",
};

const sectionAssetId: Record<JournalSectionIllustrationName, JournalRequiredAssetId> = {
  meal: "meal",
  manners: "manners",
  physical: "physical",
};

function JournalCharacter({ name, className = "" }: { name: JournalCharacterName; className?: string }) {
  const sources = useContext(JournalAssetSourceContext);
  return <img data-testid={`journal-character-${name}`} data-journal-asset={characterAssetId[name]} src={sources[characterAssetId[name]]} alt="" aria-hidden="true" draggable={false} className={className} onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />;
}

function JournalSectionIllustration({ name, className = "" }: { name: JournalSectionIllustrationName; className?: string }) {
  const sources = useContext(JournalAssetSourceContext);
  return <img data-testid={`journal-section-illustration-${name}`} data-journal-asset={sectionAssetId[name]} src={sources[sectionAssetId[name]]} alt="" aria-hidden="true" draggable={false} className={`pointer-events-none object-contain ${className}`} onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />;
}

function bestFriendNameClass() {
  return "mt-[-2px] block break-words border-b-[8px] border-[#ff7f82]/38 px-[12px] pb-[1px] text-center font-black tracking-[-0.05em] text-[#2f6284]";
}

function headerDogNameClass(name: string) {
  const fontSize = journalDogNameFontSize(name.length);
  const size = fontSize === 17 ? "text-[17px] leading-[1.08]" : fontSize === 20 ? "text-[20px] leading-[1.08]" : "text-[32px] leading-[1.12]";
  return `absolute bottom-[10px] left-[8px] w-[270px] break-words text-center font-black tracking-[-0.045em] text-[#2f6284] ${size}`;
}
