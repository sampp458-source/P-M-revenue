import { CalendarDays, NotebookPen, WalletCards } from "lucide-react";
import type { AppModule } from "./moduleState";

export const workspaceOptions = [
  {
    id: "operations" as const,
    title: "스케줄 관리",
    description: "수업과 회사 일정을 관리합니다",
    switcherDescription: "수업과 회사 일정",
    icon: CalendarDays,
    accent: "from-[#e9f5fb] to-[#f7fbfd]",
    iconStyle: "bg-[#d9eef8] text-[#276d91]",
  },
  {
    id: "finance" as const,
    title: "매출 관리",
    description: "매출·수납·미수·환불을 관리합니다",
    switcherDescription: "매출·수납·미수·환불",
    icon: WalletCards,
    accent: "from-[#edf3f8] to-[#fafcfd]",
    iconStyle: "bg-[#dfeaf3] text-primary",
  },
  {
    id: "journal" as const,
    title: "일지 관리",
    description: "유치원 하루 일지를 작성하고 관리합니다",
    switcherDescription: "유치원 하루 일지",
    icon: NotebookPen,
    accent: "from-[#eef7f3] to-[#fbfdfc]",
    iconStyle: "bg-[#dff1e9] text-[#28745b]",
  },
] satisfies ReadonlyArray<{
  id: AppModule;
  title: string;
  description: string;
  switcherDescription: string;
  icon: typeof CalendarDays;
  accent: string;
  iconStyle: string;
}>;

export const journalMenus = [
  {
    to: "/journal/today",
    label: "오늘의 일지",
    icon: NotebookPen,
  },
] as const;
