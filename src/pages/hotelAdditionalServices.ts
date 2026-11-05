import type {HotelQuote} from './hotelRateCalculatorLogic';
export interface RoomServiceInput {roomId:string;early:string|null;late:string|null}
export interface AdditionalServiceInput {rooms:readonly RoomServiceInput[];agility:number;fitness:number}
export interface TimeServiceCharge {roomId:string;roomLabel:string;time:string;amount:number}
export interface AdditionalServiceQuote {early:TimeServiceCharge[];late:TimeServiceCharge[];agility:number;fitness:number;agilityAmount:number;fitnessAmount:number;total:number;final:number|null;additional:number|null;overpaid:number|null}
type Result={ok:true;quote:AdditionalServiceQuote}|{ok:false;error:string};
/** Pure, room-based, once per visit. No dog count or nightly multiplier. */
export function timeServiceFee(kind:'early'|'late',time:string):number|null {
 if(!/^\d{2}:\d{2}$/.test(time))return null;
 const [h,m]=time.split(':').map(Number);if(m>59)return null;
 const minutes=h*60+m;
 if(kind==='early')return minutes>=480&&minutes<=600?Math.ceil((600-minutes)/60)*5000:null;
 return minutes>=1200&&minutes<=1320?Math.ceil((minutes-1200)/60)*5000:null;
}
export function calculateAdditionalServices(lodging:HotelQuote,input:AdditionalServiceInput):Result {
 if(![input.agility,input.fitness].every(n=>Number.isSafeInteger(n)&&n>=0))return {ok:false,error:'프로그램 회수는 0 이상의 정수로 입력해 주세요.'};
 const roomIds=[...new Set(lodging.nights.map(n=>n.roomId))];const seen=new Set<string>();
 const early:TimeServiceCharge[]=[],late:TimeServiceCharge[]=[];
 for(const r of input.rooms){
  if(!roomIds.includes(r.roomId)||seen.has(r.roomId))return {ok:false,error:'추가 서비스 객실 정보가 올바르지 않습니다.'};seen.add(r.roomId);
  const night=lodging.nights.find(n=>n.roomId===r.roomId)!;
  const peers=roomIds.filter(id=>lodging.nights.find(n=>n.roomId===id)!.type===night.type);
  const roomLabel=(night.type==='STANDARD'?'스탠다드':'디럭스')+(peers.length>1?` ${peers.indexOf(r.roomId)+1}번째 객실`:'');
  for(const kind of ['early','late'] as const){const time=r[kind];if(time===null)continue;const amount=timeServiceFee(kind,time);if(amount===null)return {ok:false,error:kind==='early'?'이른 입실은 08:00~10:00 사이의 분 단위 시각을 선택해 주세요.':'늦은 퇴실은 20:00~22:00 사이의 분 단위 시각을 선택해 주세요.'};(kind==='early'?early:late).push({roomId:r.roomId,roomLabel,time,amount});}
 }
 const agilityAmount=input.agility*20000,fitnessAmount=input.fitness*20000;
 const total=[...early,...late].reduce((sum,r)=>sum+r.amount,0)+agilityAmount+fitnessAmount;
 if(!Number.isSafeInteger(total)||!Number.isSafeInteger(lodging.gross+total))return {ok:false,error:'추가 서비스 금액이 계산 가능한 정수 범위를 넘었습니다.'};
 const final=lodging.final===null?null:lodging.final+total;
 return {ok:true,quote:{early,late,agility:input.agility,fitness:input.fitness,agilityAmount,fitnessAmount,total,final,additional:final===null?null:Math.max(0,final-lodging.paidAmount),overpaid:final===null?null:Math.max(0,lodging.paidAmount-final)}};
}
/** Presentation only; all amounts come from the validated service quote. */
export function additionalServiceMessageLines(quote:AdditionalServiceQuote,singleRoom=false):string[]{
 const won=(n:number)=>`${n.toLocaleString('ko-KR')}원`;
 return [
  ...quote.early.filter(r=>r.amount>0).map(r=>`이른 입실${singleRoom?'':` · ${r.roomLabel}`} (${r.time}): ${won(r.amount)}`),
  ...quote.late.filter(r=>r.amount>0).map(r=>`늦은 퇴실${singleRoom?'':` · ${r.roomLabel}`} (${r.time}): ${won(r.amount)}`),
  ...(quote.agility>0?[`어질리티 ${quote.agility}회: ${won(quote.agilityAmount)}`]:[]),
  ...(quote.fitness>0?[`피트니스 ${quote.fitness}회: ${won(quote.fitnessAmount)}`]:[])
 ];
}
