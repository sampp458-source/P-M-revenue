import { Check, CircleUserRound, Dumbbell, Flower2, Heart, Medal, MessageCircleHeart, PawPrint, Salad, Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { journalCharacters, journalSectionIllustrations, type JournalCharacterName, type JournalSectionIllustrationName } from "../assets/journal/journalAssets";
import pmLogo from "../assets/pm-logo.png";
import type { JournalPreviewActivity, JournalPreviewOption, JournalPreviewViewModel } from "./journalPreviewViewModel";

export const JOURNAL_REPORT_WIDTH = 1080;
export const JOURNAL_REPORT_HEIGHT = 1440;

type Palette = "coral" | "green" | "amber" | "lavender";
const palette = {
  coral: { surface: "#fffafb", accent: "#ff7f82", ink: "#25384a", border: "#ffd9df", highlight: "rgb(255 233 237 / 0.9)" },
  green: { surface: "#fbfffd", accent: "#62b98a", ink: "#25384a", border: "#cfeede", highlight: "rgb(230 247 239 / 0.95)" },
  amber: { surface: "#fffef8", accent: "#d3a82f", ink: "#25384a", border: "#f5e39d", highlight: "rgb(255 243 188 / 0.9)" },
  lavender: { surface: "#fdfcff", accent: "#8a75bc", ink: "#25384a", border: "#ddd4fa", highlight: "rgb(241 235 255 / 0.95)" },
} as const;

export function JournalReportTemplate({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  return (
    <article
      data-testid="journal-report-template"
      aria-label={`${viewModel.dogName} 하루 일지 결과지`}
      className="relative flex shrink-0 flex-col overflow-hidden bg-[#fffcf8] p-[46px] text-[#25384a]"
      style={{
        width: JOURNAL_REPORT_WIDTH,
        height: JOURNAL_REPORT_HEIGHT,
        fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
      }}
    >
      <span className="pointer-events-none absolute inset-[17px] rounded-[52px] border-[3px] border-[#e6eef4]" />
      <ReportHeader viewModel={viewModel} />

      <main className="relative z-10 mt-[12px] grid min-h-0 flex-1 grid-rows-[175px_205px_115px_180px_minmax(0,1fr)] gap-[10px]">
        <div className="grid grid-cols-[0.9fr_1.1fr] gap-[10px]">
          <JournalSection title="오늘의 컨디션" icon={<Sparkles size={24} />} paletteName="coral" shape="cloud">
            <Options options={viewModel.conditionOptions} columns={2} compact />
          </JournalSection>
          <JournalSection title="배변 상태" icon={<Flower2 size={24} />} paletteName="green" shape="garden">
            <div className="grid grid-cols-[0.58fr_0.58fr_1.84fr] gap-[8px]">
              <Binary label="소변" options={viewModel.urinationOptions} />
              <Binary label="대변" options={viewModel.defecationOptions} />
              <div><SmallLabel>대변 상태</SmallLabel><Options options={viewModel.stoolOptions} columns={2} compact /></div>
            </div>
          </JournalSection>
        </div>

        <div className="grid grid-cols-[0.78fr_1.22fr] gap-[10px]">
          <JournalSection title="유치원에서 먹은 것" icon={<Salad size={24} />} paletteName="amber" shape="note" illustration="meal">
            <Options options={viewModel.mealOptions} columns={2} />
          </JournalSection>
          <RelationshipStory viewModel={viewModel} />
        </div>

        <BestFriendRibbon name={viewModel.bestFriendName ?? ""} />

        <div className="grid grid-cols-2 gap-[10px]">
          <ActivityCard activity={viewModel.manners} icon={<Medal size={25} />} paletteName="coral" motif="medal" />
          <ActivityCard activity={viewModel.physical} icon={<Dumbbell size={25} />} paletteName="green" motif="movement" />
        </div>

        <TeacherComment comment={viewModel.teacherComment} />
      </main>
    </article>
  );
}

export function JournalReportPreview({ viewModel, className = "" }: { viewModel: JournalPreviewViewModel; className?: string }) {
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
        <JournalReportTemplate viewModel={viewModel} />
      </div>
    </div>
  );
}

function ReportHeader({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  return (
    <header className="relative z-10 h-[235px] shrink-0 overflow-hidden rounded-[52px_52px_38px_38px] border-[3px] border-[#dbeaf4] bg-white px-[34px] py-[17px] shadow-[0_8px_24px_rgb(47_98_132_/_0.055)]">
      <span className="absolute left-[26px] top-[24px] h-[150px] w-[150px] rounded-full bg-[#ffe9ed]/52" />
      <span className="absolute right-[24px] top-[28px] h-[144px] w-[174px] rounded-[48px] bg-[#e8f4fc]/78" />
      <JournalCharacter name="dogAWaving" className="absolute -left-[1px] top-[10px] h-[178px] w-[178px] object-contain" />
      <JournalCharacter name="dogBPeeking" className="absolute right-[8px] top-[41px] h-[142px] w-[205px] object-contain" />

      <div className="mx-auto flex w-[590px] flex-col items-center">
        <div className="flex items-center gap-[9px]">
          <img src={pmLogo} alt="P&M" className="h-[42px] w-[42px] rounded-[13px] bg-[#2f6284] object-contain p-[3px] shadow-[0_4px_11px_rgb(47_98_132_/_0.12)]" />
          <p className="text-[22px] font-black tracking-[0.17em] text-[#2f6284]">P&amp;M</p>
        </div>
        <div className="relative mt-[7px] px-[42px] pb-[11px]">
          <span className="absolute inset-x-[18px] bottom-[5px] h-[15px] -rotate-1 rounded-full bg-[#ff7f82]/42" />
          <h1 className="relative text-[52px] font-black tracking-[-0.055em] text-[#2f6284]">하루 일지</h1>
        </div>
      </div>

      <div className="absolute inset-x-[48px] bottom-[14px] flex items-end gap-[16px] rounded-[22px] border border-[#e6eef4] bg-[#fffcf8]/94 px-[20px] py-[8px]">
        <p className={longTextClass(viewModel.dogName, "min-w-0 flex-1 break-words font-black tracking-[-0.045em] text-[#2f6284]")}>{viewModel.dogName}</p>
        <span className="mb-[7px] h-0 min-w-[80px] flex-1 border-b-[3px] border-dotted border-[#ffb8bc]" />
        <p className="shrink-0 text-[22px] font-extrabold tabular-nums text-[#607488]">{viewModel.displayDate}</p>
      </div>
    </header>
  );
}

function JournalSection({ title, icon, paletteName, shape, illustration, children }: { title: string; icon: ReactNode; paletteName: Palette; shape: "cloud" | "garden" | "note"; illustration?: JournalSectionIllustrationName; children: ReactNode }) {
  const colors = palette[paletteName];
  const shapeClass = shape === "cloud" ? "rounded-[54px_30px_50px_34px]" : shape === "garden" ? "rounded-[28px_58px_32px_48px]" : "rounded-[30px_44px_38px_24px]";
  return (
    <section data-journal-section={shape} className={`relative overflow-hidden border-[3px] px-[20px] py-[12px] shadow-[0_6px_18px_rgb(47_98_132_/_0.035)] ${shapeClass}`} style={{ backgroundColor: colors.surface, borderColor: colors.border, "--journal-selected": colors.highlight } as React.CSSProperties} aria-label={title}>
      {shape === "cloud" ? <><span className="absolute -left-[7px] -top-[9px] h-[52px] w-[70px] rounded-full bg-[#ffe9ed]/60" /><span className="absolute right-[22px] top-[8px] h-[32px] w-[46px] rounded-full bg-[#ffe9ed]/42" /></> : null}
      {shape === "garden" ? <><Flower2 className="absolute bottom-[8px] right-[12px] text-[#62b98a]/30" size={34} /><span className="absolute bottom-0 left-[58px] h-[18px] w-[95px] rounded-t-full bg-[#e6f7ef]/72" /></> : null}
      {shape === "note" ? <span className="absolute left-1/2 top-0 h-[12px] w-[92px] -translate-x-1/2 rounded-b-full bg-[#fff3bc]" /> : null}
      {illustration ? <JournalSectionIllustration name={illustration} className="absolute right-[9px] top-[5px] h-[66px] w-[88px] rotate-[2deg] opacity-90" /> : null}
      <SectionHeading title={title} icon={icon} color={colors.accent} />
      <div className="relative" style={{ color: colors.ink }}>{children}</div>
    </section>
  );
}

function RelationshipStory({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  return (
    <section data-journal-section="story" aria-label="오늘의 관계" className="relative overflow-hidden rounded-[52px_30px_46px_28px] border-[3px] border-[#ddd4fa] bg-[#fdfcff] px-[16px] py-[11px] shadow-[0_6px_18px_rgb(47_98_132_/_0.035)]" style={{ "--journal-selected": "rgb(241 235 255 / 0.95)" } as React.CSSProperties}>
      <Heart className="absolute left-1/2 top-[17px] -translate-x-1/2 text-[#ff7f82]" fill="#ffe9ed" size={24} />
      <SectionHeading title="오늘의 관계" icon={<CircleUserRound size={24} />} color="#8a75bc" />
      <div className="grid grid-cols-2 gap-[8px]">
        <Relationship label="선생님과" options={viewModel.teacherRelationshipOptions} scene="teacher" />
        <Relationship label="친구들과" options={viewModel.friendRelationshipOptions} scene="friends" />
      </div>
    </section>
  );
}

function Relationship({ label, options, scene }: { label: string; options: JournalPreviewOption[]; scene: "teacher" | "friends" }) {
  return (
    <div className={`relative rounded-[28px_18px_26px_20px] border px-[9px] py-[5px] ${scene === "teacher" ? "border-[#ffe0e5] bg-[#fffafb]" : "border-[#d9ebf7] bg-[#fafdff]"}`}>
      <div className="mb-[1px] flex items-center justify-between"><SmallLabel>{label}</SmallLabel>{scene === "teacher" ? <Heart className="text-[#ff7f82]" fill="#ffe9ed" size={18} /> : <PawPrint className="text-[#5d9ac2]" size={20} />}</div>
      <div className="grid gap-[1px]">{options.map((option, index) => <Option key={option.code} option={option} compact variant={index} />)}</div>
    </div>
  );
}

function BestFriendRibbon({ name }: { name: string }) {
  return (
    <section data-journal-section="ribbon" className="relative flex min-w-0 items-center justify-center overflow-hidden border-y-[3px] border-dashed border-[#b9dced] bg-[#fbfdff] px-[28px]" aria-label="오늘의 제일 친한 친구">
      <div className="relative flex h-full w-[760px] items-center justify-center">
        <span className="absolute left-[146px] top-[21px] h-[58px] w-[68px] rotate-[-8deg] rounded-[50%] bg-[#ffe9ed]/55" />
        <JournalCharacter name="bestFriendDuo" className="relative z-10 mr-[-18px] h-[108px] w-[236px] self-end object-contain object-bottom" />
        <div className="relative z-10 flex w-[500px] min-w-0 flex-col items-center justify-center">
          <p className="text-[17px] font-extrabold tracking-[-0.02em] text-[#607488]">오늘의 제일 친한 친구는</p>
          <div className="mt-[-4px] flex min-w-0 items-end justify-center gap-[11px]">
            <strong data-testid="journal-best-friend-name" className={bestFriendNameClass(name)}>{name || "\u00a0"}</strong>
            <p className="mb-[5px] shrink-0 text-[20px] font-extrabold text-[#607488]">예요 <span className="text-[#ff7f82]">♡</span></p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ActivityCard({ activity, icon, paletteName, motif }: { activity: JournalPreviewActivity; icon: ReactNode; paletteName: Palette; motif: "medal" | "movement" }) {
  const colors = palette[paletteName];
  const activityClass = activity.activityName.length > 50 ? "text-[17px] leading-[1.18]" : activity.activityName.length > 28 ? "text-[21px] leading-[1.2]" : "text-[28px] leading-[1.2]";
  return (
    <section data-journal-section={motif} aria-label={activity.title} className={`relative overflow-hidden border-[3px] px-[19px] py-[8px] shadow-[0_6px_18px_rgb(47_98_132_/_0.035)] ${motif === "medal" ? "rounded-[26px_48px_28px_42px]" : "rounded-[48px_26px_42px_28px]"}`} style={{ backgroundColor: colors.surface, borderColor: colors.border, "--journal-selected": colors.highlight } as React.CSSProperties}>
      <JournalSectionIllustration name={motif === "medal" ? "manners" : "physical"} className={`absolute right-[10px] top-[3px] object-contain opacity-88 ${motif === "medal" ? "h-[52px] w-[78px] rotate-[2deg]" : "h-[54px] w-[82px] rotate-[-2deg]"}`} />
      <SectionHeading title={activity.title} icon={icon} color={colors.accent} />
      <div className={`flex h-[47px] items-center justify-center border-b-[3px] border-dotted border-[#dbe7ef] px-[10px] pb-[3px] text-center font-black text-[#25384a] ${activityClass}`}><span className="max-w-full whitespace-normal break-words">{activity.activityName || "\u00a0"}</span></div>
      <div className="mt-[1px]"><Options options={activity.options} columns={3} compact /></div>
    </section>
  );
}

function TeacherComment({ comment }: { comment: string }) {
  const density = commentDensity(comment);
  const characterClass = density === "minimum-safe" ? "h-[80px] w-[72px] opacity-70" : density === "compact" ? "h-[98px] w-[90px] opacity-80" : density === "standard" ? "h-[124px] w-[112px] opacity-90" : density === "large" ? "h-[160px] w-[145px]" : "h-[174px] w-[158px]";
  const textInset = density === "minimum-safe" ? "pr-[78px]" : density === "compact" ? "pr-[98px]" : density === "standard" ? "pr-[120px]" : density === "large" ? "pr-[154px]" : "pr-[166px]";
  return (
    <section data-journal-section="letter" aria-label="선생님의 한마디" className="relative min-h-0 overflow-hidden rounded-[30px_52px_34px_48px] border-[3px] border-[#ffd9df] bg-white px-[34px] pb-[22px] pt-[16px] shadow-[0_8px_22px_rgb(47_98_132_/_0.04)]">
      <span className="absolute right-0 top-0 h-[88px] w-[132px] bg-[#ffe9ed]/66 [clip-path:polygon(100%_0,100%_100%,0_0)]" />
      <JournalCharacter name="dogAHeartLetter" className={`absolute bottom-[7px] right-[11px] object-contain object-bottom ${characterClass}`} />
      <h2 aria-label="선생님의 한마디" className="relative mb-[8px] flex items-center gap-[10px] text-[27px] font-black tracking-[-0.025em] text-[#2f6284]"><span className="flex h-[40px] w-[40px] items-center justify-center rounded-[15px_20px_14px_21px] bg-[#ffe9ed] text-[#ff7f82]"><MessageCircleHeart size={27} /></span>선생님의 한마디</h2>
      <span className="absolute left-[30px] top-[61px] text-[50px] font-black leading-none text-[#ffb8bc]/58">“</span>
      <p data-testid="journal-report-comment" data-comment-density={density} className={`${commentClass(comment)} ${textInset} relative h-[calc(100%-48px)] whitespace-pre-wrap break-words pl-[27px] font-normal tracking-[-0.01em] text-[#25384a]`}>{comment}</p>
    </section>
  );
}

function SectionHeading({ title, icon, color }: { title: string; icon: ReactNode; color: string }) {
  return <h2 className="relative mb-[5px] flex items-center gap-[8px] text-[26px] font-black tracking-[-0.025em]" style={{ color }}><span className="flex h-[36px] w-[36px] items-center justify-center rounded-[13px_20px_14px_21px] bg-[#f6f9fb]">{icon}</span>{title}</h2>;
}

function Options({ options, columns, compact = false }: { options: JournalPreviewOption[]; columns: 2 | 3; compact?: boolean }) {
  const columnClass = columns === 3 ? "grid-cols-3" : "grid-cols-2";
  return <div className={`grid gap-x-[6px] gap-y-[2px] ${columnClass}`}>{options.map((option, index) => <Option key={option.code} option={option} compact={compact} variant={index} />)}</div>;
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

function Option({ option, compact = false, variant = 0 }: { option: JournalPreviewOption; compact?: boolean; variant?: number }) {
  const variantIndex = variant % markVariants.length;
  return (
    <div className={`relative flex min-w-0 items-center px-[4px] ${compact ? "min-h-[31px] text-[19px]" : "min-h-[36px] text-[22px]"} ${option.selected ? "font-black text-[#25384a]" : "font-semibold text-[#667786]"}`} style={option.selected ? { background: highlightVariants[variantIndex] } : undefined} data-selected={option.selected ? "true" : "false"} data-mark-variant={variantIndex}>
      <span className={`mr-[6px] flex h-[23px] w-[23px] shrink-0 items-center justify-center border font-black ${markVariants[variantIndex]} ${option.selected ? "border-[2px] border-[#ff9da2]/75 text-[#ff646a]" : "border-[1.5px] border-[#aebdc8] text-transparent"}`}>{option.selected ? <Check className="rotate-[-4deg]" size={18} strokeWidth={3.4} /> : <span aria-hidden="true">·</span>}</span>
      <span className="min-w-0 break-keep leading-[1.14]">{option.label}</span>
    </div>
  );
}

function Binary({ label, options }: { label: string; options: JournalPreviewOption[] }) {
  return <div><SmallLabel>{label}</SmallLabel><Options options={options} columns={2} compact /></div>;
}

function SmallLabel({ children }: { children: ReactNode }) {
  return <p className="mb-[1px] text-[18px] font-extrabold text-[#52697c]">{children}</p>;
}

function JournalCharacter({ name, className = "" }: { name: JournalCharacterName; className?: string }) {
  return <img data-testid={`journal-character-${name}`} src={journalCharacters[name]} alt="" aria-hidden="true" draggable={false} className={className} />;
}

function JournalSectionIllustration({ name, className = "" }: { name: JournalSectionIllustrationName; className?: string }) {
  return <img data-testid={`journal-section-illustration-${name}`} src={journalSectionIllustrations[name]} alt="" aria-hidden="true" draggable={false} className={`pointer-events-none object-contain ${className}`} />;
}

function commentDensity(comment: string) {
  if (comment.length <= 120) return "hero";
  if (comment.length <= 220) return "large";
  if (comment.length <= 320) return "standard";
  if (comment.length <= 420) return "compact";
  return "minimum-safe";
}

function commentClass(comment: string) {
  const density = commentDensity(comment);
  if (density === "hero") return "text-[34px] leading-[1.58]";
  if (density === "large") return "text-[29px] leading-[1.52]";
  if (density === "standard") return "text-[24px] leading-[1.45]";
  if (density === "compact") return "text-[21px] leading-[1.38]";
  return "text-[19px] leading-[1.32]";
}

function bestFriendNameClass(name: string) {
  const size = name.length > 24 ? "text-[22px] leading-[1.08]" : name.length > 14 ? "text-[30px] leading-[1.08]" : "text-[44px] leading-[1.04]";
  return `min-w-0 break-words border-b-[8px] border-[#ff7f82]/38 px-[20px] pb-[1px] text-center font-black tracking-[-0.05em] text-[#2f6284] ${size}`;
}

function longTextClass(value: string, base: string) {
  const size = value.length > 24 ? "text-[20px] leading-[1.18]" : value.length > 14 ? "text-[25px] leading-[1.18]" : "text-[32px] leading-[1.12]";
  return `${base} ${size}`;
}
