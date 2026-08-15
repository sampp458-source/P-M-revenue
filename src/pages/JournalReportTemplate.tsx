import { Check, CircleUserRound, Dumbbell, GraduationCap, Heart, MessageCircleHeart, Salad, Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import pmLogo from "../assets/pm-logo.png";
import type { JournalPreviewActivity, JournalPreviewOption, JournalPreviewViewModel } from "./journalPreviewViewModel";

export const JOURNAL_REPORT_WIDTH = 1080;
export const JOURNAL_REPORT_HEIGHT = 1440;

type Palette = "coral" | "green" | "amber" | "lavender";
const palette = {
  coral: { surface: "#fff3ef", border: "#f3d8cf", accent: "#c76d5d" },
  green: { surface: "#f1f8f2", border: "#d6e8d7", accent: "#5f8c68" },
  amber: { surface: "#fff8e8", border: "#efdfb9", accent: "#a97935" },
  lavender: { surface: "#f6f3fb", border: "#dfd7ed", accent: "#7d6a9c" },
} as const;

export function JournalReportTemplate({ viewModel }: { viewModel: JournalPreviewViewModel }) {
  return (
    <article
      data-testid="journal-report-template"
      aria-label={`${viewModel.dogName} 하루 일지 결과지`}
      className="relative flex shrink-0 flex-col overflow-hidden bg-[#fbf7ef] p-[56px] text-[#28313b]"
      style={{ width: JOURNAL_REPORT_WIDTH, height: JOURNAL_REPORT_HEIGHT, fontFamily: 'Pretendard, "Noto Sans KR", sans-serif' }}
    >
      <Decorations />
      <ReportHeader viewModel={viewModel} />
      <main className="relative z-10 mt-[22px] grid min-h-0 flex-1 grid-rows-[155px_220px_70px_190px_minmax(0,1fr)] gap-[15px]">
        <div className="grid grid-cols-[0.92fr_1.08fr] gap-[15px]">
          <ReportSection title="오늘의 컨디션" icon={<Sparkles size={25} />} paletteName="coral">
            <Options options={viewModel.conditionOptions} columns={2} compact />
          </ReportSection>
          <ReportSection title="배변 상태" icon={<Heart size={25} />} paletteName="green">
            <div className="grid grid-cols-[0.62fr_0.62fr_1.76fr] gap-[12px]">
              <Binary label="소변" options={viewModel.urinationOptions} />
              <Binary label="대변" options={viewModel.defecationOptions} />
              <div><SmallLabel>대변 상태</SmallLabel><Options options={viewModel.stoolOptions} columns={4} compact /></div>
            </div>
          </ReportSection>
        </div>

        <div className="grid grid-cols-[0.82fr_1.18fr] gap-[15px]">
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

        <section className="flex min-w-0 items-center rounded-[22px] border border-[#d2e2eb] bg-[#eef5f9] px-[24px]" aria-label="오늘의 제일 친한 친구">
          <Heart className="shrink-0 text-[#4c7891]" fill="#dceaf2" size={27} />
          <p className="ml-[14px] min-w-0 text-[22px] font-semibold text-[#52606d]">오늘의 제일 친한 친구는</p>
          <strong className={longTextClass(viewModel.bestFriendName ?? "", "ml-[12px] min-w-0 flex-1 break-words border-b-2 border-[#a9c4d3] px-[10px] pb-[3px] text-center font-extrabold text-[#315f78]")}>{viewModel.bestFriendName || "\u00a0"}</strong>
          <p className="ml-[10px] text-[22px] font-semibold text-[#52606d]">예요</p>
        </section>

        <div className="grid grid-cols-2 gap-[15px]">
          <ActivityCard activity={viewModel.manners} icon={<GraduationCap size={25} />} paletteName="coral" />
          <ActivityCard activity={viewModel.physical} icon={<Dumbbell size={25} />} paletteName="green" />
        </div>

        <ReportSection title="선생님의 한마디" icon={<MessageCircleHeart size={27} />} paletteName="lavender" className="min-h-0">
          <p data-testid="journal-report-comment" data-comment-density={commentDensity(viewModel.teacherComment)} className={`${commentClass(viewModel.teacherComment)} h-full whitespace-pre-wrap break-words font-medium text-[#494452]`}>{viewModel.teacherComment}</p>
        </ReportSection>
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
    <header className="relative z-10 flex h-[130px] shrink-0 items-center rounded-[30px] border border-[#d9e2e8] bg-white/75 px-[32px] shadow-[0_10px_30px_rgb(50_66_76_/_0.06)]">
      <span className="flex h-[84px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[24px] bg-[#315f78]"><img src={pmLogo} alt="P&M" className="h-[76px] w-[76px] object-contain" /></span>
      <div className="ml-[20px] min-w-0 flex-1">
        <p className="text-[17px] font-extrabold tracking-[0.2em] text-[#315f78]">P&amp;M JOURNAL</p>
        <h1 className="mt-[2px] text-[37px] font-black tracking-[-0.04em] text-[#22384a]">오늘의 하루 일지</h1>
      </div>
      <div className="min-w-0 max-w-[430px] text-right">
        <p className={longTextClass(viewModel.dogName, "break-words font-black tracking-[-0.04em] text-[#315f78]")}>{viewModel.dogName}</p>
        <p className="mt-[3px] text-[20px] font-bold tabular-nums text-[#78838d]">{viewModel.displayDate}</p>
      </div>
    </header>
  );
}

function ReportSection({ title, icon, paletteName, children, className = "" }: { title: string; icon: ReactNode; paletteName: Palette; children: ReactNode; className?: string }) {
  const colors = palette[paletteName];
  return (
    <section className={`overflow-hidden rounded-[24px] border px-[20px] py-[16px] ${className}`} style={{ backgroundColor: colors.surface, borderColor: colors.border }} aria-label={title}>
      <h2 className="mb-[11px] flex items-center gap-[8px] text-[21px] font-extrabold tracking-[-0.02em]" style={{ color: colors.accent }}>{icon}{title}</h2>
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
    <div className={`flex min-w-0 items-center rounded-[13px] border px-[10px] ${compact ? "min-h-[38px] text-[16px]" : "min-h-[46px] text-[17px]"} ${option.selected ? "border-[#8eb2c6] bg-white/80 font-extrabold text-[#315f78]" : "border-white/60 bg-white/35 font-semibold text-[#8b9298]"}`} data-selected={option.selected ? "true" : "false"}>
      <span className={`mr-[7px] flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border ${option.selected ? "border-[#4c7891] bg-[#4c7891] text-white" : "border-[#c9cfd3] bg-white/50 text-transparent"}`}><Check size={12} strokeWidth={3.5} /></span>
      <span className="min-w-0 break-keep text-center leading-[1.22]">{option.label}</span>
    </div>
  );
}

function Binary({ label, options }: { label: string; options: JournalPreviewOption[] }) {
  return <div><SmallLabel>{label}</SmallLabel><Options options={options} columns={2} compact /></div>;
}

function SmallLabel({ children }: { children: ReactNode }) {
  return <p className="mb-[7px] text-[15px] font-bold text-[#69746f]">{children}</p>;
}

function Relationship({ label, options }: { label: string; options: JournalPreviewOption[] }) {
  return <div><SmallLabel>{label}</SmallLabel><div className="grid gap-[6px]">{options.map((option) => <Option key={option.code} option={option} compact />)}</div></div>;
}

function ActivityCard({ activity, icon, paletteName }: { activity: JournalPreviewActivity; icon: ReactNode; paletteName: Palette }) {
  const activityClass = activity.activityName.length > 50 ? "text-[15px] leading-[1.28]" : activity.activityName.length > 28 ? "text-[18px] leading-[1.3]" : "text-[23px] leading-[1.3]";
  return (
    <ReportSection title={activity.title} icon={icon} paletteName={paletteName}>
      <div className={`flex h-[62px] items-center justify-center overflow-hidden rounded-[14px] border border-white/70 bg-white/55 px-[13px] text-center font-extrabold text-[#49545a] ${activityClass}`}><span className="max-w-full whitespace-normal break-words">{activity.activityName || "\u00a0"}</span></div>
      <div className="mt-[8px]"><Options options={activity.options} columns={3} compact /></div>
    </ReportSection>
  );
}

function commentDensity(comment: string) {
  if (comment.length <= 100) return "short";
  if (comment.length <= 250) return "medium";
  if (comment.length <= 400) return "long";
  return "very-long";
}

function commentClass(comment: string) {
  const density = commentDensity(comment);
  if (density === "short") return "text-[28px] leading-[1.65]";
  if (density === "medium") return "text-[25px] leading-[1.55]";
  if (density === "long") return "text-[22px] leading-[1.48]";
  return "text-[20px] leading-[1.42]";
}

function longTextClass(value: string, base: string) {
  const size = value.length > 24 ? "text-[20px] leading-[1.2]" : value.length > 14 ? "text-[25px] leading-[1.2]" : "text-[32px] leading-[1.15]";
  return `${base} ${size}`;
}

function Decorations() {
  return <><span className="absolute right-0 top-0 h-[130px] w-[130px] rounded-bl-full bg-[#e9f1f4]" /><span className="absolute bottom-0 left-0 h-[135px] w-[135px] rounded-tr-full bg-[#f6e5dc]" /><span className="absolute bottom-[42px] right-[44px] h-[18px] w-[18px] rounded-full bg-[#e2d8ed]" /><span className="absolute bottom-[74px] right-[74px] h-[11px] w-[11px] rounded-full bg-[#dce9d9]" /></>;
}
