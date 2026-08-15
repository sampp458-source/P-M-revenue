import { Bone, Check, CircleUserRound, Dumbbell, Flower2, Heart, Medal, MessageCircleHeart, PawPrint, Salad, Sparkles, Star } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
      className="relative flex shrink-0 flex-col overflow-hidden bg-[#fff8e9] p-[46px] text-[#3d3a40]"
      style={{
        width: JOURNAL_REPORT_WIDTH,
        height: JOURNAL_REPORT_HEIGHT,
        fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
        backgroundImage: "radial-gradient(circle at 2px 2px, rgb(203 177 137 / 0.12) 1.5px, transparent 1.6px)",
        backgroundSize: "28px 28px",
      }}
    >
      <JournalDecoration />
      <span className="pointer-events-none absolute inset-[17px] rounded-[52px] border-[3px] border-[#ead7b9]" />
      <ReportHeader viewModel={viewModel} />

      <main className="relative z-10 mt-[14px] grid min-h-0 flex-1 grid-rows-[185px_220px_95px_190px_minmax(0,1fr)] gap-[12px]">
        <div className="grid grid-cols-[0.9fr_1.1fr] gap-[12px]">
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

        <div className="grid grid-cols-[0.78fr_1.22fr] gap-[12px]">
          <JournalSection title="유치원에서 먹은 것" icon={<Salad size={24} />} paletteName="amber" shape="note">
            <Options options={viewModel.mealOptions} columns={2} />
            <Bone className="absolute bottom-[11px] right-[16px] -rotate-12 text-[#d9b76e]/55" size={34} />
          </JournalSection>
          <RelationshipStory viewModel={viewModel} />
        </div>

        <BestFriendRibbon name={viewModel.bestFriendName ?? ""} />

        <div className="grid grid-cols-2 gap-[12px]">
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
    <header className="relative z-10 h-[215px] shrink-0 overflow-hidden rounded-[62px_62px_42px_42px] bg-[#d9edf2] px-[34px] py-[20px] shadow-[inset_0_-6px_0_rgb(255_255_255_/_0.35)]">
      <span className="absolute -left-[18px] top-[52px] h-[64px] w-[64px] rounded-full bg-[#f7dfd4]" />
      <span className="absolute -right-[14px] bottom-[26px] h-[76px] w-[76px] rounded-full bg-[#f8e8b9]" />
      <JournalDogHero variant="coral" className="absolute left-[40px] top-[26px] h-[112px] w-[112px] -rotate-3" />
      <JournalDogHero variant="blue" className="absolute right-[40px] top-[25px] h-[112px] w-[112px] rotate-3" />

      <div className="mx-auto flex w-[570px] flex-col items-center">
        <div className="flex items-center gap-[10px]">
          <img src={pmLogo} alt="P&M" className="h-[47px] w-[47px] rounded-[15px] bg-[#315f78] object-contain p-[3px] shadow-[0_5px_13px_rgb(49_95_120_/_0.18)]" />
          <p className="text-[24px] font-black tracking-[0.16em] text-[#315f78]">P&amp;M</p>
        </div>
        <div className="relative mt-[5px] flex h-[70px] w-[520px] items-center justify-center bg-[#315f78] text-white shadow-[0_8px_18px_rgb(49_95_120_/_0.18)] [clip-path:polygon(0_0,7%_50%,0_100%,100%_100%,93%_50%,100%_0)]">
          <Star className="mr-[14px] text-[#f5d786]" fill="#f5d786" size={21} />
          <h1 className="text-[47px] font-black tracking-[-0.055em]">오늘의 하루 일지</h1>
          <Star className="ml-[14px] text-[#f5d786]" fill="#f5d786" size={21} />
        </div>
      </div>

      <div className="absolute inset-x-[52px] bottom-[17px] flex items-end gap-[18px]">
        <Heart className="mb-[5px] shrink-0 text-[#cf7b78]" fill="#efbbb5" size={25} />
        <p className={longTextClass(viewModel.dogName, "min-w-0 flex-1 break-words font-black tracking-[-0.045em] text-[#315f78]")}>{viewModel.dogName}</p>
        <span className="mb-[8px] h-0 min-w-[100px] flex-1 border-b-[3px] border-dotted border-[#8fb4c1]" />
        <p className="shrink-0 text-[23px] font-extrabold tabular-nums text-[#5d7781]">{viewModel.displayDate}</p>
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
    <section data-journal-section="ribbon" className="relative flex min-w-0 items-center justify-center overflow-hidden px-[40px]" aria-label="오늘의 제일 친한 친구">
      <span className="absolute left-[4px] top-[16px] h-[62px] w-[84px] bg-[#92c2ca] [clip-path:polygon(0_0,100%_0,82%_50%,100%_100%,0_100%,18%_50%)]" />
      <span className="absolute right-[4px] top-[16px] h-[62px] w-[84px] bg-[#92c2ca] [clip-path:polygon(0_0,100%_0,82%_50%,100%_100%,0_100%,18%_50%)]" />
      <div className="relative z-10 flex h-[82px] w-full items-center rounded-[24px_40px_24px_40px] bg-[#d9edf2] px-[28px] shadow-[0_6px_0_#b7d7dc]">
        <Star className="shrink-0 text-[#e0ac48]" fill="#f5d586" size={25} />
        <p className="ml-[14px] text-[22px] font-extrabold text-[#4a626b]">오늘의 제일 친한 친구는</p>
        <strong className={longTextClass(name, "mx-[16px] min-w-0 flex-1 break-words text-center font-black tracking-[-0.04em] text-[#315f78]")}>{name || "\u00a0"}</strong>
        <p className="text-[22px] font-extrabold text-[#4a626b]">예요</p>
        <Heart className="ml-[13px] shrink-0 text-[#cf7b78]" fill="#efbbb5" size={26} />
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
  return (
    <section data-journal-section="letter" aria-label="선생님의 한마디" className="relative min-h-0 overflow-hidden rounded-[34px_50px_38px_54px] bg-[#eee6f4] px-[36px] pb-[24px] pt-[18px] shadow-[inset_0_0_0_4px_rgb(255_255_255_/_0.34)]" style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 41px, rgb(115 95 148 / 0.075) 42px)" }}>
      <span className="absolute right-0 top-0 h-[98px] w-[150px] bg-[#f8e8c8]/60 [clip-path:polygon(100%_0,100%_100%,0_0)]" />
      <JournalDogHero variant="coral" className="absolute bottom-[14px] right-[24px] h-[76px] w-[76px] rotate-6 opacity-90" />
      <Heart className="absolute right-[94px] top-[22px] text-[#cc879e]" fill="#e9bac8" size={25} />
      <h2 aria-label="선생님의 한마디" className="relative mb-[10px] flex items-center gap-[11px] text-[27px] font-black tracking-[-0.025em] text-[#725f91]"><span className="flex h-[42px] w-[42px] items-center justify-center rounded-[15px_22px_15px_22px] bg-white/65"><MessageCircleHeart size={28} /></span>선생님의 한마디 <span aria-hidden="true" className="text-[15px] font-extrabold tracking-[0.12em] text-[#a494b5]">WITH LOVE</span></h2>
      <span className="absolute left-[32px] top-[67px] text-[54px] font-black leading-none text-[#c6b5d7]/70">“</span>
      <p data-testid="journal-report-comment" data-comment-density={commentDensity(comment)} className={`${commentClass(comment)} relative h-[calc(100%-50px)] whitespace-pre-wrap break-words pl-[28px] pr-[72px] font-semibold text-[#4b4653]`}>{comment}</p>
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
    <div className={`relative flex min-w-0 items-center px-[6px] ${compact ? "min-h-[32px] text-[16px]" : "min-h-[41px] text-[18px]"} ${option.selected ? "rounded-[14px_20px_14px_20px] bg-white/75 font-black text-[#315f78] shadow-[0_3px_8px_rgb(75_70_73_/_0.055)]" : "font-semibold text-[#817d79]"}`} data-selected={option.selected ? "true" : "false"}>
      <span className={`mr-[7px] flex h-[20px] w-[20px] shrink-0 items-center justify-center ${option.selected ? "rotate-[-4deg] rounded-[7px_10px_7px_10px] bg-[#4f7c90] text-white" : "rounded-full border-[2px] border-[#b7afa5] text-transparent"}`}><Check size={13} strokeWidth={3.6} /></span>
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

function JournalDogHero({ variant, className = "" }: { variant: "coral" | "blue"; className?: string }) {
  const fur = variant === "coral" ? "#d98a78" : "#6e9daf";
  const ear = variant === "coral" ? "#aa6258" : "#477789";
  const scarf = variant === "coral" ? "#315f78" : "#d47f78";
  return (
    <svg data-testid="journal-dog-hero" aria-hidden="true" viewBox="0 0 120 120" className={className}>
      <circle cx="60" cy="61" r="52" fill="#fff8ed" />
      <path d="M34 45C14 31 11 52 24 70c5 7 13 5 18-2z" fill={ear} />
      <path d="M86 45c20-14 23 7 10 25-5 7-13 5-18-2z" fill={ear} />
      <path d="M28 63c0-27 14-43 32-43s32 16 32 43c0 25-13 40-32 40S28 88 28 63z" fill={fur} />
      <path d="M38 85c8 11 36 11 44 0l-5 21H43z" fill={scarf} />
      <ellipse cx="60" cy="74" rx="22" ry="18" fill="#f8e1cf" />
      <circle cx="46" cy="59" r="4" fill="#3f3b40" />
      <circle cx="74" cy="59" r="4" fill="#3f3b40" />
      <circle cx="60" cy="70" r="5" fill="#4b4141" />
      <path d="M52 79c4 6 12 6 16 0" fill="none" stroke="#704f4c" strokeWidth="3" strokeLinecap="round" />
      <circle cx="39" cy="72" r="5" fill="#efb2a9" opacity=".75" />
      <circle cx="81" cy="72" r="5" fill="#efb2a9" opacity=".75" />
      <path d="M60 20c-5 7-7 13-4 18 2-5 7-8 13-10-1-5-4-7-9-8z" fill="#f5dfbf" opacity=".9" />
    </svg>
  );
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
      <span className="absolute right-0 top-0 h-[175px] w-[175px] rounded-bl-full bg-[#f2d9c8]" />
      <span className="absolute bottom-0 left-0 h-[165px] w-[165px] rounded-tr-full bg-[#dceade]" />
      <Flower2 className="absolute bottom-[34px] left-[30px] text-[#cf8679]" size={43} />
      <Star className="absolute bottom-[76px] left-[75px] text-[#d9ab4f]" fill="#f1d584" size={20} />
      <Heart className="absolute right-[32px] top-[185px] text-[#ce8583]" fill="#efc0b9" size={25} />
      <span className="absolute bottom-[40px] right-[45px] h-[18px] w-[18px] rounded-full bg-[#dfd4eb]" />
      <span className="absolute bottom-[73px] right-[75px] h-[11px] w-[11px] rounded-full bg-[#d8e7d7]" />
    </div>
  );
}
