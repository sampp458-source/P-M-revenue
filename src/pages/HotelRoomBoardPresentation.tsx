import {Component, createRef, type HTMLAttributes, type ReactNode} from 'react';
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
  return "border-slate-200/60 bg-slate-50/30";
}

export function RoomBoardCellFrame({mobile=false,className,...props}:HTMLAttributes<HTMLDivElement>&{mobile?:boolean}) {
 return <div {...props} className={cn('hotel-room-cell relative overflow-visible rounded-xl border transition-[transform,box-shadow,border-color,background-color,opacity] duration-200 ease-out motion-reduce:transition-none',mobile?'min-h-[4.5rem] p-2.5':'min-h-[5.5rem] p-1.5',className)}/>;
}
export function RoomBoardDesktopGroup({type,summary,badge,children}:{type:string;summary:ReactNode;badge?:ReactNode;children:ReactNode}) {
 return <section className="hotel-room-group" data-room-group={type} aria-label={`${type} Room Board`}><div className="mb-3 flex items-end justify-between gap-3 border-b border-border pb-2"><div><h3 className="text-base font-extrabold text-text-primary">{type}</h3>{summary!=null?<p className="mt-0.5 text-xs font-semibold text-text-secondary">{summary}</p>:null}</div>{badge}</div><div className={cn('grid gap-3',type==='DELUXE'?'min-w-[720px] grid-cols-6':'min-w-[600px] grid-cols-5')}>{children}</div></section>;
}
export function RoomBoardMobileGroup({type,summary,expanded,onToggle,children}:{type:string;summary:ReactNode;expanded:boolean;onToggle:()=>void;children:ReactNode}) {
 return <section data-room-group={type} aria-label={`${type} 모바일 Room Board`} className="hotel-room-group hotel-room-group-mobile overflow-hidden rounded-2xl border border-border bg-surface"><button type="button" aria-expanded={expanded} onClick={onToggle} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><span><strong className="block text-base text-text-primary">{type}</strong>{summary!=null?<span className="mt-0.5 block text-xs font-semibold text-text-secondary">{summary}</span>:null}</span><ChevronDown className={cn('shrink-0 transition-transform duration-150 motion-reduce:transition-none',expanded&&'rotate-180')} size={20}/></button><div hidden={!expanded} className="border-t border-border px-3 py-3">{children}</div></section>;
}


type BoardPosition = {
  element: HTMLElement;
  rect: DOMRect;
  text: string;
  content?: {element: HTMLElement; rect: DOMRect; opacity: number};
};
type MotionSpace = {viewport: number[]; scroll: {element: Element; x: number; y: number}[]};
type BoardSnapshot = {positions: Map<string, BoardPosition>; space: MotionSpace; epoch: number};

// First is the currently painted position, including any interrupted WAAPI effect.
// Last is measured after cancellation and React's DOM mutation, before paint.
export class RoomBoardMotion extends Component<{date:string;children:ReactNode}> {
  private root=createRef<HTMLDivElement>();
  private animations=new Map<Animation, HTMLElement>();
  private epoch=0;
  private committedSpace: MotionSpace | undefined;
  private media: MediaQueryList | undefined;
  private breakpoint: MediaQueryList | undefined;
  private selector='[data-room-group], [data-testid^="hotel-room-board-room-"]';
  private identity=(element:HTMLElement)=>element.dataset.roomGroup?`group:${element.dataset.roomGroup}`:element.dataset.testid!;
  private cancel=()=>{
    const running=[...this.animations.keys()];
    this.animations.clear();
    for(const animation of running){animation.onfinish=null;animation.oncancel=null;animation.cancel();}
  };
  private invalidate=()=>{this.epoch++;this.cancel();};
  private reduced=()=>typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private space=():MotionSpace=>{
    const viewport=window.visualViewport;
    const elements=new Set<Element>();
    for(let element:Element|null=this.root.current;element;element=element.parentElement)elements.add(element);
    this.root.current?.querySelectorAll('[data-testid$="-projection"]').forEach(element=>elements.add(element));
    return {
      viewport:[window.innerWidth,window.innerHeight,window.scrollX,window.scrollY,viewport?.width??0,viewport?.height??0,viewport?.offsetLeft??0,viewport?.offsetTop??0,viewport?.scale??1],
      scroll:[...elements].map(element=>({element,x:element.scrollLeft,y:element.scrollTop})),
    };
  };
  private sameSpace=(a:MotionSpace,b:MotionSpace)=>
    a.viewport.every((value,index)=>value===b.viewport[index])&&
    a.scroll.length===b.scroll.length&&a.scroll.every((value,index)=>{
      const other=b.scroll[index];return value.element===other.element&&value.x===other.x&&value.y===other.y;
    });
  private animate=(element:HTMLElement,frames:Keyframe[],duration:number)=>{
    if(typeof element.animate!=='function')return;
    const animation=element.animate(frames,{duration,easing:'cubic-bezier(.2,.8,.2,1)',fill:'none'});
    this.animations.set(animation,element);
    const release=()=>{this.animations.delete(animation);animation.onfinish=null;animation.oncancel=null;};
    animation.oncancel=release;
    animation.onfinish=()=>{release();animation.cancel();};
  };
  getSnapshotBeforeUpdate(previous:Readonly<{date:string;children:ReactNode}>):BoardSnapshot|null {
    const space=this.space();
    if(this.reduced()||(this.committedSpace&&!this.sameSpace(this.committedSpace,space))){this.invalidate();return null;}
    if(previous.date===this.props.date)return null;
    const positions=new Map<string,BoardPosition>();
    const animatedElements=new Set(this.animations.values());
    this.root.current?.querySelectorAll<HTMLElement>(this.selector).forEach(element=>{
      if(!element.getClientRects().length)return;
      const content=element.dataset.roomGroup?undefined:element.children[1];
      positions.set(this.identity(element),{
        element,rect:element.getBoundingClientRect(),text:element.textContent??'',
        content:content instanceof HTMLElement&&animatedElements.has(content)
          ? {element:content,rect:content.getBoundingClientRect(),opacity:Number(getComputedStyle(content).opacity)} : undefined,
      });
    });
    // Do not cancel before First: that would discard the visible in-flight offset.
    this.cancel();
    return {positions,space,epoch:this.epoch};
  }
  componentDidUpdate(_previous:Readonly<{date:string;children:ReactNode}>,_state:unknown,snapshot:BoardSnapshot|null) {
    const space=this.space();
    this.committedSpace=space;
    if(!snapshot)return;
    if(this.reduced()||snapshot.epoch!==this.epoch||!this.sameSpace(snapshot.space,space)){this.invalidate();return;}
    const moves:{element:HTMLElement;previous:BoardPosition;rect:DOMRect;contentRect?:DOMRect}[]=[];
    // Complete layout reads before starting any animation writes.
    this.root.current?.querySelectorAll<HTMLElement>(this.selector).forEach(element=>{
      const previous=snapshot.positions.get(this.identity(element));
      if(!previous||previous.element!==element||!element.getClientRects().length)return;
      const content=element.children[1];
      moves.push({element,previous,rect:element.getBoundingClientRect(),contentRect:previous.content&&previous.content.element===content?content.getBoundingClientRect():undefined});
    });
    // A layout read can expose scroll clamping/anchoring; never mix coordinate spaces.
    if(!this.sameSpace(space,this.space())){this.invalidate();return;}
    for(const {element,previous,rect,contentRect} of moves){
      const group=element.parentElement?.closest<HTMLElement>('[data-room-group]');
      const parentMove=group?moves.find(move=>move.element===group):undefined;
      const absoluteX=previous.rect.left-rect.left,absoluteY=previous.rect.top-rect.top;
      const x=absoluteX-(parentMove?parentMove.previous.rect.left-parentMove.rect.left:0);
      const y=absoluteY-(parentMove?parentMove.previous.rect.top-parentMove.rect.top:0);
      if(Math.abs(x)>0.5||Math.abs(y)>0.5)this.animate(element,[{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}],220);
      if(element.dataset.roomGroup)continue;
      const content=element.children[1];
      if(!(content instanceof HTMLElement))continue;
      if(previous.content&&contentRect){
        const cx=previous.content.rect.left-contentRect.left-absoluteX;
        const cy=previous.content.rect.top-contentRect.top-absoluteY;
        this.animate(content,[{opacity:previous.content.opacity,transform:`translate(${cx}px,${cy}px)`},{opacity:1,transform:'translate(0,0)'}],180);
      }else if(previous.text!==(element.textContent??'')){
        this.animate(content,[{opacity:0.65,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],180);
      }
    }
  }
  componentDidMount(){
    this.committedSpace=this.space();
    window.addEventListener('resize',this.invalidate);
    window.addEventListener('scroll',this.invalidate,true);
    window.visualViewport?.addEventListener('resize',this.invalidate);
    window.visualViewport?.addEventListener('scroll',this.invalidate);
    if(typeof window.matchMedia==='function'){
      this.media=window.matchMedia('(prefers-reduced-motion: reduce)');
      this.breakpoint=window.matchMedia('(max-width: 767px)');
      this.media.addEventListener?.('change',this.invalidate);
      this.breakpoint.addEventListener?.('change',this.invalidate);
    }
  }
  componentWillUnmount(){
    this.invalidate();
    window.removeEventListener('resize',this.invalidate);
    window.removeEventListener('scroll',this.invalidate,true);
    window.visualViewport?.removeEventListener('resize',this.invalidate);
    window.visualViewport?.removeEventListener('scroll',this.invalidate);
    this.media?.removeEventListener?.('change',this.invalidate);
    this.breakpoint?.removeEventListener?.('change',this.invalidate);
  }
  render(){return <div ref={this.root} className="hotel-board-motion min-w-0">{this.props.children}</div>;}
}
