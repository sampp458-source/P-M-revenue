// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {RoomBoardMotion,RoomBoardCellFrame} from './HotelRoomBoardPresentation';

type Running = {element:HTMLElement;frames:Keyframe[];progress:number;active:boolean;cancel:ReturnType<typeof vi.fn>;onfinish:(()=>void)|null;oncancel:(()=>void)|null};
const originalAnimate=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'animate');
afterEach(()=>{
 cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
 if(originalAnimate)Object.defineProperty(HTMLElement.prototype,'animate',originalAnimate);else Reflect.deleteProperty(HTMLElement.prototype,'animate');
});
function harness(){
 const running:Running[]=[];
 let reduced=false;
 const media=new Map<string,EventTarget & {matches:boolean;media:string}>();
 vi.stubGlobal('matchMedia',vi.fn((query:string)=>{
  if(!media.has(query))media.set(query,Object.defineProperties(new EventTarget(),{media:{value:query},matches:{get:()=>query.includes('reduce')?reduced:window.innerWidth<=767}}) as EventTarget & {matches:boolean;media:string});
  return media.get(query)!;
 }));
 const offset=(element:HTMLElement)=>running.filter(a=>a.active&&a.element===element).reduce((sum,a)=>{
  const transform=String(a.frames[0].transform??'');
  const xy=/translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(transform);
  const y=/translateY\(([-\d.]+)px\)/.exec(transform);
  return sum+(xy?Number(xy[2]):y?Number(y[1]):0)*(1-a.progress);
 },0);
 const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  let top=Number(this.dataset.y??0)-window.scrollY+offset(this);
  for(let element=this.parentElement;element;element=element.parentElement)top+=offset(element);
  return {top,left:0,width:100,height:100,bottom:top+100,right:100,x:0,y:top,toJSON:()=>({})};
 });
 vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue({length:1} as DOMRectList);
 const animate=vi.fn(function(this:HTMLElement,frames:Keyframe[]){
  const a:Running={element:this,frames,progress:0,active:true,onfinish:null,oncancel:null,cancel:vi.fn(()=>{a.active=false;a.oncancel?.();})};running.push(a);return a;
 });
 Object.defineProperty(HTMLElement.prototype,'animate',{configurable:true,writable:true,value:animate});
 return {running,animate,rect,offset,media,reduce:()=>{reduced=true;media.get('(prefers-reduced-motion: reduce)')!.dispatchEvent(new Event('change'));}};
}
const view=(date:string,y:number,text='occupant',mobile=false)=><RoomBoardMotion date={date}><section data-room-group="DELUXE" data-y={0}>
 {mobile?<div key="mobile"><RoomBoardCellFrame data-testid="hotel-room-board-room-a" data-y={y}><b>A</b><span data-y={y}>{text}</span></RoomBoardCellFrame></div>:<div key="desktop"><RoomBoardCellFrame data-testid="hotel-room-board-room-a" data-y={y}><b>A</b><span data-y={y}>{text}</span></RoomBoardCellFrame></div>}
</section></RoomBoardMotion>;

it.each([['A','B','C'],['A','B','A'],['A','B','C','D']])('captures the visible interrupted position before cancel: %j',(...dates)=>{
 const h=harness();const {rerender,unmount}=render(view(dates[0],100));
 const node=screen.getByTestId('hotel-room-board-room-a');
 rerender(view(dates[1],200));
 for(let i=2;i<dates.length;i++){
  for(const a of h.running.filter(a=>a.active))a.progress=0.5;
  const before=node.getBoundingClientRect().top;
  const old=h.running.filter(a=>a.active);
  const last=dates[i]==='A'?100:200+i*100;
  rerender(view(dates[i],last));
  expect(node.getBoundingClientRect().top).toBe(before);
  expect(old.every(a=>a.cancel.mock.calls.length===1)).toBe(true);
  expect(h.running.filter(a=>a.active&&a.element===node)).toHaveLength(1);
  expect(screen.getByTestId('hotel-room-board-room-a')).toBe(node);
 }
 unmount();expect(h.running.every(a=>!a.active)).toBe(true);
});
it('subtracts ancestor visual inversion once when a group and room are both moving',()=>{
 const h=harness();const tree=(date:string,g:number,r:number)=><RoomBoardMotion date={date}><section data-room-group="DELUXE" data-y={g}><RoomBoardCellFrame data-testid="hotel-room-board-room-a" data-y={r}/></section></RoomBoardMotion>;
 const {rerender}=render(tree('A',100,150));rerender(tree('B',200,300));
 for(const a of h.running)a.progress=0.5;
 const room=screen.getByTestId('hotel-room-board-room-a');const before=room.getBoundingClientRect().top;
 rerender(tree('C',300,450));expect(room.getBoundingClientRect().top).toBe(before);
});
it('keeps interrupted content translation and opacity instead of restarting the entrance',()=>{
 const h=harness();const computed=window.getComputedStyle.bind(window);
 vi.spyOn(window,'getComputedStyle').mockImplementation(element=>{
  const a=h.running.find(a=>a.active&&a.element===element&&a.frames[0].opacity!==undefined);
  return a?{opacity:String(Number(a.frames[0].opacity)+(1-Number(a.frames[0].opacity))*a.progress)} as CSSStyleDeclaration:computed(element);
 });
 const {rerender}=render(view('A',100,'first'));rerender(view('B',200,'second'));
 for(const a of h.running)a.progress=0.5;
 const content=screen.getByText('second');const before=content.getBoundingClientRect().top;
 rerender(view('C',300,'third'));
 expect(content.getBoundingClientRect().top).toBe(before);
 expect(h.running.find(a=>a.active&&a.element===content)!.frames[0].opacity).toBeCloseTo(0.825);
});
it.each(['resize','scroll'])('cancels active transforms on %s and does not retain effects',event=>{
 const h=harness();const {rerender}=render(view('A',100));rerender(view('B',200,'next'));
 const node=screen.getByTestId('hotel-room-board-room-a');expect(h.running.some(a=>a.active)).toBe(true);
 (event==='scroll'?node:window).dispatchEvent(new Event(event));
 expect(h.running.every(a=>!a.active)).toBe(true);expect(node.getBoundingClientRect().top).toBe(200);expect(node.style.transform).toBe('');
});
it.each([[767,768],[768,767]])('settles breakpoint replacement %s→%s without animating old nodes', (from,to)=>{
 vi.stubGlobal('innerWidth',from);const h=harness();const {rerender}=render(view('A',100,'one',from<=767));rerender(view('B',200,'two',from<=767));
 const count=h.animate.mock.calls.length;
 vi.stubGlobal('innerWidth',to);h.media.get('(max-width: 767px)')!.dispatchEvent(new Event('change'));
 rerender(view('C',300,'three',to<=767));
 expect(h.running.every(a=>!a.active)).toBe(true);expect(h.animate).toHaveBeenCalledTimes(count);
 expect(screen.getByTestId('hotel-room-board-room-a').getBoundingClientRect().top).toBe(300);
});
it('rejects viewport/scroll changes even before the resize/scroll event is delivered',()=>{
 const h=harness();const {rerender}=render(view('A',100));rerender(view('B',200));const count=h.animate.mock.calls.length;
 vi.stubGlobal('scrollY',80);rerender(view('C',300));expect(h.animate).toHaveBeenCalledTimes(count);expect(h.running.every(a=>!a.active)).toBe(true);
});
it('rejects scroll clamping exposed during Last measurement',()=>{
 const h=harness();const {rerender}=render(view('A',100));
 const measure=h.rect.getMockImplementation()!;
 h.rect.mockImplementation(function(this:HTMLElement){if(this.dataset.y==='200')vi.stubGlobal('scrollY',50);return measure.call(this);});
 rerender(view('B',200));expect(h.animate).not.toHaveBeenCalled();
});
it('releases finished effects and cancels motion/listeners on unmount',()=>{
 const add=vi.spyOn(window,'addEventListener'),remove=vi.spyOn(window,'removeEventListener');
 const h=harness();const {rerender,unmount}=render(view('A',100));rerender(view('B',200));
 const animation=h.running[0];animation.onfinish?.();expect(animation.cancel).toHaveBeenCalledOnce();expect(animation.active).toBe(false);
 rerender(view('C',300));unmount();expect(h.running.every(a=>!a.active)).toBe(true);
 for(const call of add.mock.calls.filter(call=>call[0]==='resize'||call[0]==='scroll'))expect(remove.mock.calls).toContainEqual(call);
});
it('does not measure room rects for same-date renders or reduced motion, and cancels on preference change',()=>{
 const h=harness();const {rerender}=render(view('A',100));rerender(view('A',100,'new text'));expect(h.rect).not.toHaveBeenCalled();
 rerender(view('B',200));h.reduce();expect(h.running.every(a=>!a.active)).toBe(true);
 h.rect.mockClear();rerender(view('C',300));expect(h.rect).not.toHaveBeenCalled();
});

const composed=(date:string,count:number,aux:string|null,occupant='same dog')=><RoomBoardMotion date={date}>
 <dl><div><dt>투숙</dt><dd data-board-content="summary:투숙" data-board-phase="summary">{count}</dd></div></dl>
 <section data-room-group="DELUXE"><RoomBoardCellFrame data-testid="hotel-room-board-room-a"><b>A</b><span>{occupant}</span></RoomBoardCellFrame></section>
 {aux!==null?<section data-board-content="completed" data-board-phase="auxiliary">{aux}</section>:null}
</RoomBoardMotion>;
it('updates exact metrics immediately, staggers only changed content, and keeps unchanged occupants still',()=>{
 const h=harness();const {rerender}=render(composed('A',1,'one'));
 expect(h.animate).not.toHaveBeenCalled();
 const shell=screen.getByTestId('hotel-room-board-room-a');
 rerender(composed('B',2,'two'));
 expect(screen.getByText('2')).toBeVisible();expect(screen.getByTestId('hotel-room-board-room-a')).toBe(shell);
 expect(h.running.map(a=>a.element.textContent)).toEqual(['2','two']);
 const options=h.animate.mock.calls.map(call=>(call as unknown[])[1] as KeyframeAnimationOptions);
 expect(options.map(o=>[o.duration,o.delay,o.fill])).toEqual([[140,20,'backwards'],[140,80,'backwards']]);
 expect(options.every(o=>Number(o.duration)+Number(o.delay)<=220)).toBe(true);
 for(const a of h.running)a.onfinish?.();h.animate.mockClear();h.rect.mockClear();
 rerender(composed('B',3,'new same-date content'));
 expect(h.animate).not.toHaveBeenCalled();expect(h.rect).not.toHaveBeenCalled();
});
it('fades newly inserted mode content without reserving an empty slot or replaying identical room content',()=>{
 const h=harness();const {rerender}=render(composed('A',1,null));
 rerender(composed('B',1,'completed'));
 expect(h.running.map(a=>a.element.textContent)).toEqual(['completed']);
 rerender(composed('C',1,null));expect(screen.queryByText('completed')).not.toBeInTheDocument();
 expect(h.running.every(a=>!a.active)).toBe(true);
});
it('resumes interrupted summary/auxiliary opacity without replay delay or a growing queue',()=>{
 const h=harness();const computed=window.getComputedStyle.bind(window);
 vi.spyOn(window,'getComputedStyle').mockImplementation(element=>{
  const a=h.running.find(a=>a.active&&a.element===element&&a.frames[0].opacity!==undefined);
  return a?{opacity:String(Number(a.frames[0].opacity)+(1-Number(a.frames[0].opacity))*a.progress)} as CSSStyleDeclaration:computed(element);
 });
 const {rerender,unmount}=render(composed('A',1,'A'));
 for(const [date,count] of [['B',2],['A',1],['C',3],['D',4]] as const){
  for(const a of h.running.filter(a=>a.active))a.progress=0.5;
  const previous=h.running.filter(a=>a.active);h.animate.mockClear();
  rerender(composed(date,count,date));
  expect(previous.every(a=>!a.active)).toBe(true);
  expect(h.running.filter(a=>a.active)).toHaveLength(2);
  if(previous.length){
   expect(h.running.filter(a=>a.active).every(a=>Number(a.frames[0].opacity)>0.8)).toBe(true);
   expect(h.animate.mock.calls.every(call=>((call as unknown[])[1] as KeyframeAnimationOptions).delay===0)).toBe(true);
  }
 }
 unmount();expect(h.running.every(a=>!a.active)).toBe(true);
});
it.each(['resize','scroll','reduced'])('invalidates all choreography together on %s',event=>{
 const h=harness();const {rerender}=render(composed('A',1,'A'));
 rerender(composed('B',2,'B','changed dog'));
 expect(h.running.filter(a=>a.active)).toHaveLength(3);
 if(event==='reduced')h.reduce();else window.dispatchEvent(new Event(event));
 expect(h.running.every(a=>!a.active)).toBe(true);
 expect(document.querySelectorAll('[style*="transform"],[style*="opacity"]')).toHaveLength(0);
 if(event==='reduced'){h.animate.mockClear();rerender(composed('C',3,'C'));expect(h.animate).not.toHaveBeenCalled();}
});
