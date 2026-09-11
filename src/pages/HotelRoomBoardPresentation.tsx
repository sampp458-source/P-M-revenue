import type {HTMLAttributes, ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
import {cn} from '../components/ui';
type RoomBoardStage = 'in_house' | 'check_in' | 'check_out';
export function roomStageClass(stage: RoomBoardStage | null) {
  if (stage === "in_house") {
    return "border-emerald-300 bg-emerald-50/65 shadow-[inset_0_3px_0_0_rgb(16_185_129_/_0.75)]";
  }
  if (stage === "check_out") {
    return "border-orange-300 bg-orange-50/65 shadow-[inset_0_3px_0_0_rgb(249_115_22_/_0.75)]";
  }
  if (stage === "check_in") {
    return "border-blue-300 bg-blue-50/65 shadow-[inset_0_3px_0_0_rgb(37_99_235_/_0.75)]";
  }
  return "border-slate-200/60 bg-transparent";
}

export function RoomBoardCellFrame({mobile=false,className,...props}:HTMLAttributes<HTMLDivElement>&{mobile?:boolean}) {
 return <div {...props} className={cn('relative overflow-visible rounded-xl border transition-[transform,box-shadow,border-color,background-color,opacity] duration-200 ease-out will-change-transform',mobile?'min-h-[4.5rem] p-2.5':'min-h-[5.5rem] p-1.5',className)}/>;
}
export function RoomBoardDesktopGroup({type,summary,badge,children}:{type:string;summary:ReactNode;badge?:ReactNode;children:ReactNode}) {
 return <section aria-label={`${type} Room Board`}><div className="mb-3 flex items-end justify-between gap-3 border-b border-border pb-2"><div><h3 className="text-base font-extrabold text-text-primary">{type}</h3>{summary!=null?<p className="mt-0.5 text-xs font-semibold text-text-secondary">{summary}</p>:null}</div>{badge}</div><div className={cn('grid gap-3',type==='DELUXE'?'min-w-[720px] grid-cols-6':'min-w-[600px] grid-cols-5')}>{children}</div></section>;
}
export function RoomBoardMobileGroup({type,summary,expanded,onToggle,children}:{type:string;summary:ReactNode;expanded:boolean;onToggle:()=>void;children:ReactNode}) {
 return <section aria-label={`${type} 모바일 Room Board`} className="overflow-hidden rounded-2xl border border-border bg-surface"><button type="button" aria-expanded={expanded} onClick={onToggle} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><span><strong className="block text-base text-text-primary">{type}</strong>{summary!=null?<span className="mt-0.5 block text-xs font-semibold text-text-secondary">{summary}</span>:null}</span><ChevronDown className={cn('shrink-0 transition-transform',expanded&&'rotate-180')} size={20}/></button>{expanded?<div className="border-t border-border px-3 py-3">{children}</div>:null}</section>;
}
