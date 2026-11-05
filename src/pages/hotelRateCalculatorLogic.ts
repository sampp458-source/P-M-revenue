/** Quote-only rules. No clock, storage, repository or network dependencies. */
export type RoomKind = 'STANDARD' | 'DELUXE';
export const HOTEL_NIGHTLY_RATES: Record<RoomKind, number> = {STANDARD: 60_000, DELUXE: 100_000};
export const MAX_QUOTE_ROOMS = 20;
export const MAX_ROOM_NIGHTS = 5_000;
export interface QuoteRoom { id: string; order: number; type: RoomKind; nights: number; rate: number; startDay: number }
export interface QuoteInput { stamps: number; rooms: readonly QuoteRoom[]; paidAmount: number; freeSelections?: Readonly<Record<string,string>> }
export interface RoomNight { id: string; roomId: string; roomLabel: string; day: number; type: RoomKind; rate: number; coupon: number; stamp: number; discountEligible: boolean; free: boolean; discount: number; final: number }
export interface FreeBenefit { id: string; coupon: number; day: number; sourceNightId: string; candidates: string[]; selected: string | null }
export interface CouponProgress { number: number; before: number; after: number; completed: boolean; reachesFive: boolean }
export interface HotelQuote { nights: RoomNight[]; benefits: FreeBenefit[]; coupons: CouponProgress[]; unresolved: number; totalRoomNights: number; gross: number; tenPercentNights: number; tenPercentDiscount: number; freeNights: number; freeDiscount: number; totalDiscount: number; final: number | null; additional: number | null; overpaid: number | null; stampsAfter: number; couponsCompleted: number; paidAmount: number; startStamps: number }
export type QuoteResult = {ok:true;quote:HotelQuote}|{ok:false;error:string};
const integer=(n:number,min=0)=>Number.isSafeInteger(n)&&n>=min;
export const quoteWon=(n:number)=>`${n.toLocaleString('ko-KR')}원`;
export function calculateHotelQuote(input: QuoteInput): QuoteResult {
 const {rooms,stamps,paidAmount}=input;
 if(!integer(stamps)||stamps>9)return {ok:false,error:'현재 도장은 0~9 사이의 정수로 입력해 주세요.'};
 if(!integer(paidAmount))return {ok:false,error:'기결제액은 0 이상의 정수로 입력해 주세요.'};
 if(!rooms.length||rooms.length>MAX_QUOTE_ROOMS)return {ok:false,error:`객실은 1~${MAX_QUOTE_ROOMS}실까지 계산할 수 있습니다.`};
 const ids=new Set<string>(),orders=new Set<number>();let count=0,gross=0;
 for(const r of rooms){
  if(!r.id||ids.has(r.id)||!integer(r.order,1)||orders.has(r.order))return {ok:false,error:'객실 식별 정보가 올바르지 않습니다.'};
  ids.add(r.id);orders.add(r.order);
  if(!Object.hasOwn(HOTEL_NIGHTLY_RATES,r.type)||!integer(r.nights,1)||!integer(r.startDay,1)||r.startDay>10_000||!integer(r.rate,1))return {ok:false,error:'박 수·시작일은 양의 정수, 요금은 1원 이상의 정수로 입력해 주세요.'};
  count+=r.nights;gross+=r.nights*r.rate;
  if(count>MAX_ROOM_NIGHTS||!Number.isSafeInteger(gross))return {ok:false,error:`한 견적은 ${MAX_ROOM_NIGHTS.toLocaleString()} 룸나이트와 안전한 정수 금액 범위까지 계산합니다.`};
 }
 const expanded=rooms.flatMap(r=>Array.from({length:r.nights},(_,i)=>({room:r,day:r.startDay+i})))
  .sort((a,b)=>a.day-b.day||(a.room.type==='STANDARD'?0:1)-(b.room.type==='STANDARD'?0:1)||a.room.order-b.room.order);
 const nights:RoomNight[]=expanded.map(({room:r,day},i)=>({id:`${r.id}@${day}`,roomId:r.id,roomLabel:`${r.type} 객실 ${r.order}`,day,type:r.type,rate:r.rate,coupon:Math.floor((stamps+i)/10)+1,stamp:(stamps+i)%10+1,discountEligible:false,free:false,discount:0,final:r.rate}));
 const five=new Set(nights.filter(n=>n.stamp===5).map(n=>n.coupon));
 const byDay=new Map<number,string[]>();for(const n of nights)byDay.set(n.day,[...(byDay.get(n.day)||[]),n.id]);
 const benefits:FreeBenefit[]=nights.filter(n=>n.stamp===10).map(n=>{const candidates=byDay.get(n.day)!;return {id:`coupon-${n.coupon}-day-${n.day}`,coupon:n.coupon,day:n.day,sourceNightId:n.id,candidates,selected:candidates.length===1?candidates[0]:null};});
 const used=new Set<string>();
 for(const b of benefits){const selected=b.selected??input.freeSelections?.[b.id];if(selected&&b.candidates.includes(selected)&&!used.has(selected)){b.selected=selected;used.add(selected);}else b.selected=null;}
 let tenPercentNights=0,tenPercentDiscount=0,freeDiscount=0;
 for(const n of nights){n.discountEligible=n.stamp<=5&&five.has(n.coupon);n.free=used.has(n.id);n.discount=n.free?n.rate:n.discountEligible?Math.floor(n.rate/10):0;n.final=n.rate-n.discount;if(n.free)freeDiscount+=n.rate;else if(n.discountEligible){tenPercentNights++;tenPercentDiscount+=n.discount;}}
 const unresolved=benefits.filter(b=>!b.selected).length;const totalDiscount=tenPercentDiscount+freeDiscount;const final=unresolved?null:gross-totalDiscount;
 const coupons=Array.from(new Set(nights.map(n=>n.coupon))).map(number=>{const entries=nights.filter(n=>n.coupon===number);const after=entries.at(-1)!.stamp;return {number,before:number===1?stamps:0,after,completed:after===10,reachesFive:five.has(number)};});
 const couponsCompleted=Math.floor((stamps+count)/10);
 return {ok:true,quote:{nights,benefits,coupons,unresolved,totalRoomNights:count,gross,tenPercentNights,tenPercentDiscount,freeNights:used.size,freeDiscount,totalDiscount,final,additional:final===null?null:Math.max(0,final-paidAmount),overpaid:final===null?null:Math.max(0,paidAmount-final),stampsAfter:(stamps+count)%10,couponsCompleted,paidAmount,startStamps:stamps}};
}
export function formatHotelQuote(quote:HotelQuote):string {
 if(quote.final===null||quote.unresolved)throw new Error('무료 객실을 모두 선택해 주세요.');
 const rooms=Array.from(new Set(quote.nights.map(n=>n.roomId))).map(id=>{const ns=quote.nights.filter(n=>n.roomId===id);return `${ns[0].roomLabel}: ${ns.length}박 · ${ns[0].day}~${ns.at(-1)!.day}일차 · 1박 ${quoteWon(ns[0].rate)}`;});
 const roomSummary=(['STANDARD','DELUXE'] as const).map(type=>{const count=new Set(quote.nights.filter(n=>n.type===type).map(n=>n.roomId)).size;return count?`${type} ${count}실`:'';}).filter(Boolean).join(' + ');
 return ['[P&M 호텔 예상 요금]','',`객실: ${roomSummary}`,`숙박: ${rooms.length===1?`${quote.totalRoomNights}박`:'객실별 아래 내역 참고'}`,...rooms,`총 객실 숙박: ${quote.totalRoomNights} 룸나이트`,'',`정상가: ${quoteWon(quote.gross)}`,`쿠폰 할인: -${quoteWon(quote.tenPercentDiscount)}`,`무료 숙박: -${quoteWon(quote.freeDiscount)} (${quote.freeNights}박)`,...quote.benefits.map(b=>{const n=quote.nights.find(n=>n.id===b.selected)!;return `무료 선택: ${b.day}일차 ${n.roomLabel}`;}),'',`예상 결제금액: ${quoteWon(quote.final)}`,...(quote.paidAmount?[`기결제: ${quoteWon(quote.paidAmount)}`,`추가 결제 예상: ${quoteWon(quote.additional!)}`,...(quote.overpaid?[`초과 결제 정산 참고: ${quoteWon(quote.overpaid)}`]:[])]:[]),`도장: 시작 ${quote.startStamps}개 + 이번 ${quote.totalRoomNights}개 → ${quote.couponsCompleted?'새 쿠폰 도장':'현재 도장'} ${quote.stampsAfter}개`, `이번 이용 중 쿠폰 ${quote.couponsCompleted}장 완료`,'','※ 실제 결제 확정 금액이 아닌 예상 요금입니다.'].join('\n');
}
