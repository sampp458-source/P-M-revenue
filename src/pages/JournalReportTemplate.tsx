import { Check, CircleUserRound, Dumbbell, Flower2, GraduationCap, Heart, MessageCircleHeart, PawPrint, Salad, Sparkles, Star } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import pmLogo from "../assets/pm-logo.png";
import type { JournalPreviewActivity, JournalPreviewOption, JournalPreviewViewModel } from "./journalPreviewViewModel";

export const JOURNAL_REPORT_WIDTH = 1080;
export const JOURNAL_REPORT_HEIGHT = 1440;

type Palette = "coral" | "green" | "amber" | "lavender";
const palette = {
  coral: { surface: "#fbe9e2", accent: "#b85f55" },
  green: { surface: "#e8f2e6", accent: "#557d5e" },
  amber: { surface: "#f8edcb", accent: "#986d2f" },
  lavender: { surface: "#ece5f4", accent: "#725f91" },
} as const;

export function JournalReportTemplate({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  return (
    <article
      data-testid="journal-report-template"
      aria-label={`${viewModel.dogName} 하루 일지 결과지`}
      className="relative flex shrink-0 flex-col overflow-hidden bg-[#fbf5e9] p-[48px] text-[#34323a]"
      style={{ width: JOURNAL_REPORT_WIDTH, height: JOURNAL_REPORT_HEIGHT, fontFamily: 'Pretendard, "Noto Sans KR", sans-serif' }}
    >
      <Decorations />
      <span className="pointer-events-none absolute inset-[18px] rounded-[44px] border-[3px] border-[#eadcc7]/80" />
      <ReportHeader viewModel={viewModel} />
      <main className="relative z-10 mt-[18px] grid min-h-0 flex-1 grid-rows-[190px_230px_82px_200px_minmax(0,1fr)] gap-[14px]">
        <div className="grid grid-cols-[0.92fr_1.08fr] gap-[14px]">
          <ReportSection title="오늘의 컨디션" icon={<Sparkles size={25} />} paletteName="coral">
            <Options options={viewModel.conditionOptions} columns={2} compact />
          </ReportSection>
          <ReportSection title="배변 상태" icon={<Heart size={25} />} paletteName="green">
            <div className="grid grid-cols-[0.62fr_0.62fr_1.76fr] gap-[12px]">
              <Binary label="소변" options={viewModel.urinationOptions} />
              <Binary label="대변" options={viewModel.defecationOptions} />
              <div><SmallLabel>대변 상태</SmallLabel><Options options={viewModel.stoolOptions} columns={2} compact /></div>
            </div>
          </ReportSection>
        </div>

        <div className="grid grid-cols-[0.82fr_1.18fr] gap-[14px]">
          <ReportSection title="유치원에서 먹은 것" icon={<Salad size={25} />} paletteName="amber">
            <Options options={viewModel.mealOptions} columns={2} />
          </ReportSection>
          <ReportSection title="오늘의 관계" icon={<CircleUserRound size={25} />} paletteName="lavender">
            <div className="grid grid-cols-2 gap-[14px]">
              <Relationship label="선생님과" options={viewModel.teacherRelationshipOptions} />
              <Relationship label="친구들과" options={viewModel.friendRelationshipOptions} />
            </div>
          </ReportSection>
        </div>

        <section className="relative flex min-w-0 items-center overflow-hidden rounded-[30px_42px_28px_40px] bg-[#dfeef2] px-[30px]" aria-label="오늘의 제일 친한 친구">
          <Star className="absolute left-[15px] top-[11px] text-[#e2b65a]" fill="#f5d88c" size={18} />
          <Heart className="shrink-0 text-[#4f7c90]" fill="#c9e1e9" size={31} />
          <p className="ml-[15px] min-w-0 text-[23px] font-bold text-[#4d626b]">오늘의 제일 친한 친구는</p>
          <strong className={longTextClass(viewModel.bestFriendName ?? "", "ml-[14px] min-w-0 flex-1 break-words border-b-[3px] border-dotted border-[#86aebd] px-[10px] pb-[2px] text-center font-black text-[#315f78]")}>{viewModel.bestFriendName || "\u00a0"}</strong>
          <p className="ml-[10px] text-[23px] font-bold text-[#4d626b]">예요</p>
          <Sparkles className="ml-[13px] shrink-0 text-[#759dad]" size={24} />
        </section>

        <div className="grid grid-cols-2 gap-[14px]">
          <ActivityCard activity={viewModel.manners} icon={<GraduationCap size={25} />} paletteName="coral" />
          <ActivityCard activity={viewModel.physical} icon={<Dumbbell size={25} />} paletteName="green" />
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
    <header className="relative z-10 h-[190px] shrink-0 overflow-hidden rounded-[44px_44px_52px_52px] bg-[#dfeef2] px-[38px] py-[25px]">
      <Flower2 className="absolute left-[24px] top-[18px] text-[#d99384]" size={27} />
      <Star className="absolute right-[40px] top-[23px] text-[#d7a84d]" fill="#f3d485" size={22} />
      <Heart className="absolute right-[78px] top-[51px] rotate-12 text-[#d98c84]" fill="#f3cbc5" size={24} />
      <div className="flex items-center">
        <span className="flex h-[94px] w-[94px] shrink-0 items-center justify-center overflow-hidden rounded-[30px] bg-[#315f78] shadow-[0_9px_22px_rgb(49_95_120_/_0.2)]"><img src={pmLogo} alt="P&M" className="h-[86px] w-[86px] object-contain" /></span>
        <div className="ml-[24px] min-w-0 flex-1">
          <p className="text-[22px] font-black tracking-[0.16em] text-[#315f78]">P&amp;M</p>
          <h1 className="mt-[-2px] text-[52px] font-black tracking-[-0.055em] text-[#243b4b]">오늘의 하루 일지</h1>
        </div>
        <PawPrint className="mr-[12px] mt-[28px] rotate-12 text-[#8db2c0]" size={50} />
      </div>
      <div className="absolute inset-x-[40px] bottom-[20px] flex items-end gap-[20px]">
        <p className={longTextClass(viewModel.dogName, "min-w-0 flex-1 break-words font-black tracking-[-0.04em] text-[#315f78]")}>{viewModel.dogName}</p>
        <span className="mb-[8px] h-0 min-w-[80px] flex-1 border-b-[3px] border-dotted border-[#9dbbc6]" />
        <p className="shrink-0 text-[23px] font-extrabold tabular-nums text-[#627b86]">{viewModel.displayDate}</p>
      </div>
    </header>
  );
}

function ReportSection({ title, icon, paletteName, children, className = "" }: { title: string; icon: ReactNode; paletteName: Palette; children: ReactNode; className?: string }) {
  const colors = palette[paletteName];
  return (
    <section className={`relative overflow-hidden rounded-[36px_28px_38px_30px] px-[22px] py-[16px] ${className}`} style={{ backgroundColor: colors.surface }} aria-label={title}>
      <span className="absolute right-0 top-0 h-[52px] w-[52px] rounded-bl-full bg-white/25" />
      <h2 className="relative mb-[10px] flex items-center gap-[8px] text-[23px] font-black tracking-[-0.025em]" style={{ color: colors.accent }}><span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/55">{icon}</span>{title}</h2>
      {children}
    </section>
  );
}

function Options({ options, columns, compact = false }: { options: JournalPreviewOption[]; columns: 2 | 3 | 4; compact?: boolean }) {
  const columnClass = columns === 4 ? "grid-cols-4" : columns === 3 ? "grid-cols-3" : "grid-cols-2";
  return <div className={`grid gap-[8px] ${columnClass}`}>{options.map((option) => <Option key={option.code} option={option} compact={compact} />)}</div>;
}

function Option({ option, compact = false }: { option: JournalPreviewOption; compact?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center px-[7px] ${compact ? "min-h-[34px] text-[17px]" : "min-h-[43px] text-[19px]"} ${option.selected ? "rounded-[15px_11px_16px_12px] bg-white/70 font-black text-[#315f78] shadow-[0_3px_9px_rgb(70_79_83_/_0.05)]" : "font-semibold text-[#8b8986]"}`} data-selected={option.selected ? "true" : "false"}>
      <span className={`mr-[8px] flex h-[21px] w-[21px] shrink-0 items-center justify-center rounded-[7px] border-[2px] ${option.selected ? "border-[#4f7c90] bg-[#4f7c90] text-white" : "border-[#b9b4aa] bg-transparent text-transparent"}`}><Check size={13} strokeWidth={3.5} /></span>
      <span className="min-w-0 break-keep leading-[1.18]">{option.label}</span>
    </div>
  );
}

function Binary({ label, options }: { label: string; options: JournalPreviewOption[] }) {
  return <div><SmallLabel>{label}</SmallLabel><Options options={options} columns={2} compact /></div>;
}

function SmallLabel({ children }: { children: ReactNode }) {
  return <p className="mb-[5px] text-[16px] font-extrabold text-[#696d68]">{children}</p>;
}

function Relationship({ label, options }: { label: string; options: JournalPreviewOption[] }) {
  return <div className="rounded-[22px] bg-white/25 px-[10px] py-[8px]"><SmallLabel>{label}</SmallLabel><div className="grid gap-[2px]">{options.map((option) => <Option key={option.code} option={option} compact />)}</div></div>;
}

function ActivityCard({ activity, icon, paletteName }: { activity: JournalPreviewActivity; icon: ReactNode; paletteName: Palette }) {
  const activityClass = activity.activityName.length > 50 ? "text-[16px] leading-[1.25]" : activity.activityName.length > 28 ? "text-[19px] leading-[1.25]" : "text-[25px] leading-[1.25]";
  return (
    <ReportSection title={activity.title} icon={icon} paletteName={paletteName}>
      <div className={`flex h-[58px] items-center justify-center overflow-hidden border-b-[3px] border-dotted border-white/80 px-[13px] pb-[6px] text-center font-black text-[#49545a] ${activityClass}`}><span className="max-w-full whitespace-normal break-words">{activity.activityName || "\u00a0"}</span></div>
      <div className="mt-[7px]"><Options options={activity.options} columns={3} compact /></div>
    </ReportSection>
  );
}

function TeacherComment({ comment }: { comment: string }) {
  return (
    <section
      aria-label="선생님의 한마디"
      className="relative min-h-0 overflow-hidden rounded-[42px_34px_46px_32px] bg-[#eee7f5] px-[34px] pb-[26px] pt-[20px]"
      style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 43px, rgb(125 106 156 / 0.08) 44px)" }}
    >
      <Heart className="absolute bottom-[24px] right-[32px] rotate-12 text-[#c998a9]" fill="#ead0d8" size={38} />
      <Sparkles className="absolute right-[74px] top-[22px] text-[#9f8ab8]" size={24} />
      <h2 className="relative mb-[12px] flex items-center gap-[10px] text-[26px] font-black tracking-[-0.025em] text-[#725f91]"><span className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-white/55"><MessageCircleHeart size={28} /></span>선생님의 한마디</h2>
      <span className="absolute left-[30px] top-[65px] text-[54px] font-black leading-none text-[#c8b8d9]/70">“</span>
      <p data-testid="journal-report-comment" data-comment-density={commentDensity(comment)} className={`${commentClass(comment)} relative h-[calc(100%-52px)] whitespace-pre-wrap break-words pl-[28px] pr-[18px] font-semibold text-[#4b4653]`}>{comment}</p>
    </section>
  );
}

function commentDensity(comment: string) {
  if (comment.length <= 180) return "short";
  if (comment.length <= 300) return "medium";
  if (comment.length <= 400) return "long";
  return "very-long";
}

function commentClass(comment: string) {
  const density = commentDensity(comment);
  if (density === "short") return "text-[30px] leading-[1.6]";
  if (density === "medium") return "text-[26px] leading-[1.52]";
  if (density === "long") return "text-[22px] leading-[1.45]";
  return "text-[20px] leading-[1.38]";
}

function longTextClass(value: string, base: string) {
  const size = value.length > 24 ? "text-[20px] leading-[1.2]" : value.length > 14 ? "text-[25px] leading-[1.2]" : "text-[32px] leading-[1.15]";
  return `${base} ${size}`;
}

function Decorations() {
  return <><span className="absolute right-0 top-0 h-[145px] w-[145px] rounded-bl-full bg-[#f3ddcd]" /><span className="absolute bottom-0 left-0 h-[145px] w-[145px] rounded-tr-full bg-[#dfece1]" /><Flower2 className="absolute bottom-[35px] left-[32px] text-[#d89688]" size={42} /><span className="absolute bottom-[42px] right-[44px] h-[18px] w-[18px] rounded-full bg-[#e2d8ed]" /><span className="absolute bottom-[74px] right-[74px] h-[11px] w-[11px] rounded-full bg-[#dce9d9]" /></>;
}
