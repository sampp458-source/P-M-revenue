import { Bone, Check, CircleUserRound, Dumbbell, Flower2, Heart, Medal, MessageCircleHeart, PawPrint, Salad, Sparkles, Star } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { journalCharacters, type JournalCharacterName } from "../assets/journal/journalAssets";
import pmLogo from "../assets/pm-logo.png";
import type { JournalPreviewActivity, JournalPreviewOption, JournalPreviewViewModel } from "./journalPreviewViewModel";

export const JOURNAL_REPORT_WIDTH = 1080;
export const JOURNAL_REPORT_HEIGHT = 1440;

type Palette = "coral" | "green" | "amber" | "lavender";
const palette = {
  coral: { surface: "#f9e3df", accent: "#af5b55", ink: "#70433f" },
  green: { surface: "#e3f0df", accent: "#537c5b", ink: "#425c48" },
  amber: { surface: "#f9ebbd", accent: "#966b2e", ink: "#66502f" },
  lavender: { surface: "#e9e2f3", accent: "#735f94", ink: "#554b66" },
} as const;

export function JournalReportTemplate({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  return (
    <article
      data-testid="journal-report-template"
      aria-label={`${viewModel.dogName} 하루 일지 결과지`}
      className="relative flex shrink-0 flex-col overflow-hidden bg-[#fff8ea] p-[46px] text-[#4f403b]"
      style={{
        width: JOURNAL_REPORT_WIDTH,
        height: JOURNAL_REPORT_HEIGHT,
        fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
        backgroundImage: "radial-gradient(circle at 2px 2px, rgb(197 151 117 / 0.085) 1.35px, transparent 1.45px)",
        backgroundSize: "31px 31px",
      }}
    >
      <JournalDecoration />
      <span className="pointer-events-none absolute inset-[17px] rounded-[52px] border-[3px] border-[#ead8bf]" />
      <ReportHeader viewModel={viewModel} />

      <main className="relative z-10 mt-[12px] grid min-h-0 flex-1 grid-rows-[175px_205px_115px_180px_minmax(0,1fr)] gap-[10px]">
        <div className="grid grid-cols-[0.9fr_1.1fr] gap-[10px]">
          <JournalSection title="오늘의 컨디션" icon={<Sparkles size={24} />} paletteName="coral" shape="cloud">
            <Options options={viewModel.conditionOptions} columns={2} compact />
          </JournalSection>
          <JournalSection title="배변 상태" icon={<Flower2 size={24} />} paletteName="green" shape="garden">
            <div className="grid grid-cols-[0.58fr_0.58fr_1.84fr] gap-[10px]">
              <Binary label="소변" options={viewModel.urinationOptions} />
              <Binary label="대변" options={viewModel.defecationOptions} />
              <div><SmallLabel>대변 상태</SmallLabel><Options options={viewModel.stoolOptions} columns={2} compact /></div>
            </div>
          </JournalSection>
        </div>

        <div className="grid grid-cols-[0.78fr_1.22fr] gap-[10px]">
          <JournalSection title="유치원에서 먹은 것" icon={<Salad size={24} />} paletteName="amber" shape="note">
            <Options options={viewModel.mealOptions} columns={2} />
            <Bone className="absolute bottom-[11px] right-[16px] -rotate-12 text-[#d9b76e]/55" size={34} />
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
    <header className="relative z-10 h-[235px] shrink-0 overflow-hidden rounded-[52px_52px_38px_38px] border-[3px] border-[#ead4bf] bg-[#f8eadc] px-[34px] py-[17px] shadow-[inset_0_-5px_0_rgb(255_255_255_/_0.38)]">
      <span className="absolute left-[26px] top-[24px] h-[150px] w-[150px] rounded-full bg-[#fff8ea]/80" />
      <span className="absolute right-[24px] top-[28px] h-[144px] w-[174px] rounded-[48px] bg-[#ddebeb]/70" />
      <JournalCharacter name="dogAWaving" className="absolute -left-[1px] top-[10px] h-[178px] w-[178px] object-contain" />
      <JournalCharacter name="dogBPeeking" className="absolute right-[8px] top-[41px] h-[142px] w-[205px] object-contain" />

      <div className="mx-auto flex w-[590px] flex-col items-center">
        <div className="flex items-center gap-[9px]">
          <img src={pmLogo} alt="P&M" className="h-[42px] w-[42px] rounded-[13px] bg-[#315f78] object-contain p-[3px] shadow-[0_4px_11px_rgb(49_95_120_/_0.15)]" />
          <p className="text-[22px] font-black tracking-[0.17em] text-[#315f78]">P&amp;M</p>
        </div>
        <div className="relative mt-[1px] px-[38px] pb-[10px]">
          <span className="absolute inset-x-[18px] bottom-[5px] h-[15px] -rotate-1 rounded-full bg-[#efb2a8]/58" />
          <h1 className="relative text-[49px] font-black tracking-[-0.055em] text-[#315f78]">오늘의 하루 일지</h1>
        </div>
        <p className="mt-[-3px] text-[14px] font-extrabold tracking-[0.2em] text-[#9d776d]">P&amp;M CHARACTER DIARY</p>
      </div>

      <div className="absolute inset-x-[48px] bottom-[14px] flex items-end gap-[16px] rounded-[22px] bg-white/46 px-[20px] py-[8px]">
        <p className={longTextClass(viewModel.dogName, "min-w-0 flex-1 break-words font-black tracking-[-0.045em] text-[#315f78]")}>{viewModel.dogName}</p>
        <span className="mb-[7px] h-0 min-w-[80px] flex-1 border-b-[3px] border-dotted border-[#d1a79a]" />
        <p className="shrink-0 text-[22px] font-extrabold tabular-nums text-[#6d5148]">{viewModel.displayDate}</p>
      </div>
    </header>
  );
}

function JournalSection({ title, icon, paletteName, shape, children }: { title: string; icon: ReactNode; paletteName: Palette; shape: "cloud" | "garden" | "note"; children: ReactNode }) {
  const colors = palette[paletteName];
  const shapeClass = shape === "cloud" ? "rounded-[54px_30px_50px_34px]" : shape === "garden" ? "rounded-[28px_58px_32px_48px]" : "rounded-[30px_44px_38px_24px]";
  return (
    <section data-journal-section={shape} className={`relative overflow-hidden px-[22px] py-[15px] ${shapeClass}`} style={{ backgroundColor: colors.surface }} aria-label={title}>
      {shape === "cloud" ? <><span className="absolute -left-[7px] -top-[9px] h-[52px] w-[70px] rounded-full bg-white/25" /><span className="absolute right-[22px] top-[8px] h-[32px] w-[46px] rounded-full bg-white/25" /></> : null}
      {shape === "garden" ? <><Flower2 className="absolute bottom-[8px] right-[12px] text-white/45" size={34} /><span className="absolute bottom-0 left-[58px] h-[18px] w-[95px] rounded-t-full bg-white/18" /></> : null}
      {shape === "note" ? <span className="absolute left-1/2 top-0 h-[17px] w-[92px] -translate-x-1/2 bg-[#efcfa0]/65 [clip-path:polygon(8%_0,100%_0,92%_100%,0_100%)]" /> : null}
      <SectionHeading title={title} icon={icon} color={colors.accent} />
      <div className="relative" style={{ color: colors.ink }}>{children}</div>
    </section>
  );
}

function RelationshipStory({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  return (
    <section data-journal-section="story" aria-label="오늘의 관계" className="relative overflow-hidden rounded-[52px_30px_46px_28px] bg-[#e9e2f3] px-[18px] py-[14px]">
      <Heart className="absolute left-1/2 top-[17px] -translate-x-1/2 text-[#c88ca2]" fill="#e8bdca" size={24} />
      <SectionHeading title="오늘의 관계" icon={<CircleUserRound size={24} />} color="#735f94" />
      <div className="grid grid-cols-2 gap-[10px]">
        <Relationship label="선생님과" options={viewModel.teacherRelationshipOptions} scene="teacher" />
        <Relationship label="친구들과" options={viewModel.friendRelationshipOptions} scene="friends" />
      </div>
    </section>
  );
}

function Relationship({ label, options, scene }: { label: string; options: JournalPreviewOption[]; scene: "teacher" | "friends" }) {
  return (
    <div className={`relative rounded-[28px_18px_26px_20px] px-[10px] py-[8px] ${scene === "teacher" ? "bg-[#fff6f1]/75" : "bg-[#eef7f4]/75"}`}>
      <div className="mb-[3px] flex items-center justify-between"><SmallLabel>{label}</SmallLabel>{scene === "teacher" ? <Heart className="text-[#d58d8a]" fill="#efc3bd" size={18} /> : <PawPrint className="text-[#6d998d]" size={20} />}</div>
      <div className="grid gap-[1px]">{options.map((option) => <Option key={option.code} option={option} compact />)}</div>
    </div>
  );
}

function BestFriendRibbon({ name }: { name: string }) {
  return (
    <section data-journal-section="ribbon" className="relative grid min-w-0 grid-cols-[170px_1fr] items-center overflow-hidden border-y-[3px] border-dashed border-[#d7b49f] bg-[#fff1de]/76 px-[24px]" aria-label="오늘의 제일 친한 친구">
      <JournalCharacter name="bestFriendDuo" className="h-[112px] w-[158px] self-end object-contain object-bottom" />
      <div className="relative z-10 flex min-w-0 items-center justify-center gap-[13px]">
        <p className="shrink-0 text-[21px] font-extrabold text-[#765d54]">오늘의 제일 친한 친구는</p>
        <strong className={longTextClass(name, "min-w-0 break-words border-b-[6px] border-[#efb2a8]/65 px-[15px] pb-[1px] text-center font-black tracking-[-0.04em] text-[#315f78]")}>{name || "\u00a0"}</strong>
        <p className="shrink-0 text-[21px] font-extrabold text-[#765d54]">예요</p>
      </div>
    </section>
  );
}

function ActivityCard({ activity, icon, paletteName, motif }: { activity: JournalPreviewActivity; icon: ReactNode; paletteName: Palette; motif: "medal" | "movement" }) {
  const colors = palette[paletteName];
  const activityClass = activity.activityName.length > 50 ? "text-[16px] leading-[1.22]" : activity.activityName.length > 28 ? "text-[19px] leading-[1.24]" : "text-[24px] leading-[1.24]";
  return (
    <section data-journal-section={motif} aria-label={activity.title} className={`relative overflow-hidden px-[21px] py-[14px] ${motif === "medal" ? "rounded-[26px_48px_28px_42px]" : "rounded-[48px_26px_42px_28px]"}`} style={{ backgroundColor: colors.surface }}>
      {motif === "medal" ? <Star className="absolute right-[19px] top-[16px] text-[#dfa849]" fill="#f3d184" size={22} /> : <><span className="absolute right-[17px] top-[17px] h-[12px] w-[42px] rounded-full bg-[#8fbaa0]/45" /><span className="absolute right-[24px] top-[37px] h-[9px] w-[28px] rounded-full bg-[#8fbaa0]/30" /></>}
      <SectionHeading title={activity.title} icon={icon} color={colors.accent} />
      <div className={`flex h-[54px] items-center justify-center border-b-[3px] border-dotted border-white/85 px-[12px] pb-[5px] text-center font-black text-[#4b4a4f] ${activityClass}`}><span className="max-w-full whitespace-normal break-words">{activity.activityName || "\u00a0"}</span></div>
      <div className="mt-[6px]"><Options options={activity.options} columns={3} compact /></div>
    </section>
  );
}

function TeacherComment({ comment }: { comment: string }) {
  const density = commentDensity(comment);
  const characterClass = density === "very-long" ? "h-[88px] w-[80px] opacity-70" : density === "long" ? "h-[118px] w-[108px] opacity-85" : "h-[166px] w-[150px]";
  const textInset = density === "very-long" ? "pr-[86px]" : density === "long" ? "pr-[122px]" : "pr-[166px]";
  return (
    <section data-journal-section="letter" aria-label="선생님의 한마디" className="relative min-h-0 overflow-hidden rounded-[30px_52px_34px_48px] border-[3px] border-[#d9c9e2] bg-[#f1eaf5] px-[34px] pb-[22px] pt-[16px] shadow-[inset_0_0_0_5px_rgb(255_255_255_/_0.35)]" style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 40px, rgb(109 81 72 / 0.065) 41px)" }}>
      <span className="absolute right-0 top-0 h-[88px] w-[132px] bg-[#fff1de]/65 [clip-path:polygon(100%_0,100%_100%,0_0)]" />
      <JournalCharacter name="dogAHeartLetter" className={`absolute bottom-[7px] right-[11px] object-contain object-bottom ${characterClass}`} />
      <h2 aria-label="선생님의 한마디" className="relative mb-[8px] flex items-center gap-[10px] text-[27px] font-black tracking-[-0.025em] text-[#725f91]"><span className="flex h-[40px] w-[40px] items-center justify-center rounded-[15px_20px_14px_21px] bg-white/62"><MessageCircleHeart size={27} /></span>선생님의 한마디 <span aria-hidden="true" className="text-[14px] font-extrabold tracking-[0.12em] text-[#a494b5]">WITH LOVE</span></h2>
      <span className="absolute left-[30px] top-[61px] text-[50px] font-black leading-none text-[#c6b5d7]/62">“</span>
      <p data-testid="journal-report-comment" data-comment-density={density} className={`${commentClass(comment)} ${textInset} relative h-[calc(100%-48px)] whitespace-pre-wrap break-words pl-[27px] font-semibold text-[#4b4653]`}>{comment}</p>
    </section>
  );
}

function SectionHeading({ title, icon, color }: { title: string; icon: ReactNode; color: string }) {
  return <h2 className="relative mb-[8px] flex items-center gap-[8px] text-[22px] font-black tracking-[-0.025em]" style={{ color }}><span className="flex h-[34px] w-[34px] items-center justify-center rounded-[13px_19px_13px_19px] bg-white/65">{icon}</span>{title}</h2>;
}

function Options({ options, columns, compact = false }: { options: JournalPreviewOption[]; columns: 2 | 3; compact?: boolean }) {
  const columnClass = columns === 3 ? "grid-cols-3" : "grid-cols-2";
  return <div className={`grid gap-x-[7px] gap-y-[5px] ${columnClass}`}>{options.map((option) => <Option key={option.code} option={option} compact={compact} />)}</div>;
}

function Option({ option, compact = false }: { option: JournalPreviewOption; compact?: boolean }) {
  return (
    <div className={`relative flex min-w-0 items-center px-[5px] ${compact ? "min-h-[30px] text-[16px]" : "min-h-[38px] text-[18px]"} ${option.selected ? "font-black text-[#315f78] [background:linear-gradient(transparent_58%,rgb(239_178_168_/_0.42)_58%)]" : "font-semibold text-[#978b83]"}`} data-selected={option.selected ? "true" : "false"}>
      <span className={`mr-[7px] flex h-[20px] w-[20px] shrink-0 rotate-[-7deg] items-center justify-center font-black ${option.selected ? "text-[#d06f67]" : "text-[#c8bcb2]"}`}>{option.selected ? <Check size={18} strokeWidth={3.5} /> : <span className="text-[19px] leading-none">·</span>}</span>
      <span className="min-w-0 break-keep leading-[1.16]">{option.label}</span>
    </div>
  );
}

function Binary({ label, options }: { label: string; options: JournalPreviewOption[] }) {
  return <div><SmallLabel>{label}</SmallLabel><Options options={options} columns={2} compact /></div>;
}

function SmallLabel({ children }: { children: ReactNode }) {
  return <p className="mb-[3px] text-[15px] font-extrabold text-[#676b65]">{children}</p>;
}

function JournalCharacter({ name, className = "" }: { name: JournalCharacterName; className?: string }) {
  return <img data-testid={`journal-character-${name}`} src={journalCharacters[name]} alt="" aria-hidden="true" draggable={false} className={className} />;
}

function commentDensity(comment: string) {
  if (comment.length <= 180) return "short";
  if (comment.length <= 280) return "medium";
  if (comment.length <= 380) return "long";
  return "very-long";
}

function commentClass(comment: string) {
  const density = commentDensity(comment);
  if (density === "short") return "text-[29px] leading-[1.56]";
  if (density === "medium") return "text-[25px] leading-[1.47]";
  if (density === "long") return "text-[22px] leading-[1.4]";
  return "text-[19px] leading-[1.34]";
}

function longTextClass(value: string, base: string) {
  const size = value.length > 24 ? "text-[20px] leading-[1.18]" : value.length > 14 ? "text-[25px] leading-[1.18]" : "text-[32px] leading-[1.12]";
  return `${base} ${size}`;
}

function JournalDecoration() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute right-0 top-0 h-[158px] w-[158px] rounded-bl-full bg-[#f3dfce]/70" />
      <span className="absolute bottom-0 left-0 h-[145px] w-[145px] rounded-tr-full bg-[#ddeadf]/70" />
      <span className="absolute bottom-[40px] right-[45px] h-[15px] w-[15px] rounded-full bg-[#dfd4eb]/70" />
    </div>
  );
}
