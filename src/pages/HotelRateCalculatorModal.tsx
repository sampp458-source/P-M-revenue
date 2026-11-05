import {useRef,useState} from 'react';
import {Button,Field,Input,Modal,Select} from '../components/ui';
import {calculateHotelQuote,formatHotelQuote,HOTEL_NIGHTLY_RATES,MAX_QUOTE_ROOMS,quoteWon,type RoomKind,type QuoteRoom} from './hotelRateCalculatorLogic';
import './hotel-rate-calculator.css';
type DraftRoom={id:string;order:number;type:RoomKind;nights:string;rate:string;startDay:string;extra:string};
const numeric=(s:string)=>s.trim()&&/^\d+$/.test(s)?Number(s):NaN;
const draftRoom=(order:number,type:RoomKind,nights='3'):DraftRoom=>({id:`quote-room-${order}`,order,type,nights,rate:String(HOTEL_NIGHTLY_RATES[type]),startDay:'1',extra:'0'});
/** Mounted only while open; closing destroys all quote state. Never calls a repository. */
export function HotelRateCalculatorModal({onClose}:{onClose:()=>void}) {
 const [rooms,setRooms]=useState<DraftRoom[]>([draftRoom(1,'STANDARD')]);const nextOrder=useRef(2);
 const [stamps,setStamps]=useState('0');const [completed,setCompleted]=useState('0');const [extension,setExtension]=useState(false);const [paid,setPaid]=useState('0');
 const [freeSelections,setFreeSelections]=useState<Record<string,string>>({});const [copyMessage,setCopyMessage]=useState('');const [copying,setCopying]=useState(false);const [fallback,setFallback]=useState('');
 const [detailLimit,setDetailLimit]=useState(50);const [couponPage,setCouponPage]=useState(0);
 const currentTypes=new Set(rooms.map(r=>r.type));const mode=currentTypes.size===2?'BOTH':rooms[0].type;
 const clearFeedback=()=>{setCopyMessage('');setFallback('');};
 const changeRoom=(id:string,key:keyof Pick<DraftRoom,'nights'|'rate'|'startDay'|'extra'>,value:string)=>{clearFeedback();setRooms(rs=>rs.map(r=>r.id===id?{...r,[key]:value}:r));};
 const changeMode=(value:string)=>{clearFeedback();const types:RoomKind[]=value==='BOTH'?['STANDARD','DELUXE']:[value as RoomKind];setRooms(rs=>types.flatMap(type=>{const existing=rs.filter(r=>r.type===type);return existing.length?existing:[draftRoom(nextOrder.current++,type,rs[0].nights)];}));};
 const roomInputs:QuoteRoom[]=rooms.map(r=>({id:r.id,order:r.order,type:r.type,nights:numeric(r.nights)+(extension?numeric(r.extra):0),rate:numeric(r.rate),startDay:numeric(r.startDay)}));
 // Validate the two extension inputs independently; a negative base must never be hidden by an extension.
 const extensionInvalid=extension&&rooms.some(r=>!Number.isSafeInteger(numeric(r.nights))||numeric(r.nights)<1||!Number.isSafeInteger(numeric(r.extra))||numeric(r.extra)<0);
 const result=extensionInvalid?{ok:false as const,error:'기존 숙박은 1박 이상, 추가 연장은 0박 이상의 정수로 입력해 주세요.'}:calculateHotelQuote({stamps:numeric(stamps),completedCoupons:numeric(completed),rooms:roomInputs,paidAmount:extension?numeric(paid):0,freeSelections});
 const quote=result.ok?result.quote:null;
 const visibleCouponPage=quote?Math.min(couponPage,Math.max(0,Math.ceil(quote.coupons.length/5)-1)):0;
 const copy=async()=>{if(!quote||quote.final===null||copying)return;const text=formatHotelQuote(quote);setCopying(true);setCopyMessage('');try{await navigator.clipboard.writeText(text);setCopyMessage('계산 결과를 복사했습니다.');setFallback('');}catch{setCopyMessage('복사하지 못했습니다. 아래 문구를 선택해 직접 복사해 주세요.');setFallback(text);}finally{setCopying(false);}};
 return <Modal open title="호텔 요금 계산기" description="한 가정 기준 · 닫으면 초기화됩니다." size="large" onClose={onClose}>
  <div className="hotel-rate-calculator">
   <div className="hrc-layout">
    <div className="hrc-inputs">
     <div className="hrc-basic-grid">
      <Field label={extension?'연속 이용 시작 직전 도장 수':'현재 쿠폰 도장 수'}><Select aria-label="현재 쿠폰 도장 수" value={stamps} onChange={e=>{clearFeedback();setStamps(e.target.value);}}>{Array.from({length:10},(_,i)=><option key={i} value={i}>{i}개</option>)}</Select></Field>
      <Field label="객실 유형"><Select aria-label="객실 유형" value={mode} onChange={e=>changeMode(e.target.value)}><option value="STANDARD">STANDARD</option><option value="DELUXE">DELUXE</option><option value="BOTH">둘 다</option></Select></Field>
     </div>
     <div className="hrc-nights" aria-label="이용 박 수">
      <span className="hrc-input-label">{extension?'기존 연속 숙박 박 수':'이용 박 수'}</span>
      {rooms.map(r=><div key={r.id} className="hrc-night-row">{rooms.length>1&&<span>{r.type}{rooms.filter(x=>x.type===r.type).length>1?` · 객실 ${r.order}`:''}</span>}
       <div className="hrc-stepper"><Button variant="secondary" aria-label={`${r.type} 객실 ${r.order} 박 수 감소`} disabled={numeric(r.nights)<=1||!Number.isFinite(numeric(r.nights))} onClick={()=>changeRoom(r.id,'nights',String(numeric(r.nights)-1))}>−</Button><div className="hrc-night-value"><Input aria-label={`${r.type} 객실 ${r.order} 숙박 박 수`} inputMode="numeric" type="number" min="1" step="1" value={r.nights} onChange={e=>changeRoom(r.id,'nights',e.target.value)}/><span aria-hidden="true">박</span></div><Button variant="secondary" aria-label={`${r.type} 객실 ${r.order} 박 수 증가`} onClick={()=>changeRoom(r.id,'nights',String((Number.isFinite(numeric(r.nights))?numeric(r.nights):0)+1))}>+</Button></div>
      </div>)}
     </div>

    </div>
    <div className="hrc-result" aria-label="요금 계산 결과">
     {!result.ok?<div role="alert" className="hrc-error">{result.error}<p>입력값을 수정하면 즉시 다시 계산합니다.</p></div>:quote&&<>
      <div className="hrc-total"><span>예상 최종 결제금액</span><strong aria-label="최종 예상 결제금액">{quote.final===null?'무료 객실 선택 필요':quoteWon(quote.final)}</strong><small>실제 결제 확정 금액이 아닌 예상 요금입니다.</small></div>
      <p className="hrc-hint">{rooms.filter(r=>r.type==='STANDARD').length>0?`STANDARD ${rooms.filter(r=>r.type==='STANDARD').length}실 `:''}{rooms.filter(r=>r.type==='DELUXE').length>0?`DELUXE ${rooms.filter(r=>r.type==='DELUXE').length}실`:''} · 총 {quote.totalRoomNights.toLocaleString()} 룸나이트</p>
      <dl className="hrc-breakdown"><div><dt>정상가</dt><dd>{quoteWon(quote.gross)}</dd></div><div><dt>쿠폰 할인</dt><dd>−{quoteWon(quote.tenPercentDiscount)}</dd></div><div><dt>무료 숙박</dt><dd>−{quoteWon(quote.freeDiscount)}</dd></div><div><dt>총 할인금액</dt><dd>−{quoteWon(quote.totalDiscount)}</dd></div></dl>
      {quote.benefits.length>0&&<div className="hrc-free"><h3>무료 숙박 선택</h3>{quote.benefits.map(b=><fieldset key={b.id}><legend>{b.day}일차 · 쿠폰 {b.coupon} 무료 1박{b.candidates.length===1?' · 자동 적용':''}</legend><div className="hrc-free-choices">{b.candidates.map(id=>{const n=quote.nights.find(n=>n.id===id)!;const taken=quote.benefits.some(other=>other.id!==b.id&&other.selected===id);const preview=calculateHotelQuote({stamps:numeric(stamps),completedCoupons:numeric(completed),rooms:roomInputs,paidAmount:extension?numeric(paid):0,freeSelections:{...freeSelections,[b.id]:id}});return <Button key={id} variant={b.selected===id?'primary':'secondary'} aria-pressed={b.selected===id} disabled={taken||b.candidates.length===1} onClick={()=>{clearFeedback();setFreeSelections(v=>({...v,[b.id]:id}));}}><span>{n.roomLabel} 무료</span><small>{taken?'다른 무료 혜택 적용':preview.ok&&preview.quote.final!==null?`예상 결제 ${quoteWon(preview.quote.final)}`:'다른 무료 혜택도 선택해 주세요'}</small></Button>;})}</div></fieldset>)}</div>}

      {extension&&<div className="hrc-extension-total"><p>이미 결제한 금액 {quoteWon(quote.paidAmount)}</p><strong>추가 청구 예상 {quote.additional===null?'선택 필요':quoteWon(quote.additional)}</strong>{!!quote.overpaid&&<p>초과 결제 정산 참고 {quoteWon(quote.overpaid)} · 자동 환불하지 않습니다.</p>}</div>}
      <div className="hrc-stamp-summary"><strong>이번 적립 {quote.totalRoomNights}개 · 계산 후 누적 {quote.stampsAfter}개</strong>{(quote.couponsCompleted>0||quote.totalCompletedCoupons>0)&&<p>이번 완료 {quote.couponsCompleted}장 · 누적 완료 {quote.totalCompletedCoupons}장</p>}</div>

     </>}
     <div className="hrc-copy"><Button type="button" disabled={!quote||quote.final===null||copying} onClick={()=>void copy()}>계산 결과 복사</Button><p role="status">{copyMessage||'고객에게 자동 발송하지 않습니다.'}</p></div>
     {fallback&&<Field label="직접 복사할 상담 문구"><textarea className="hrc-fallback" readOnly value={fallback} onFocus={e=>e.currentTarget.select()}/></Field>}
    </div>
   </div>
   {quote&&<details className="hrc-options"><summary>상세 내역 보기</summary>      <div className="hrc-coupons">{quote.coupons.slice(visibleCouponPage*5,visibleCouponPage*5+5).map(c=><div key={c.number}><p>쿠폰 {c.number} · {c.completed?'완료':`${c.after}/10개`}</p><div className="hrc-stamps" role="img" aria-label={`쿠폰 ${c.number} ${c.after}개 도장`}>{Array.from({length:10},(_,i)=><span key={i} className={i<c.before?'hrc-old':i<c.after?'hrc-new':''}>{i+1}</span>)}</div></div>)}{quote.coupons.length>5&&<div className="hrc-actions"><Button variant="secondary" disabled={visibleCouponPage===0} onClick={()=>setCouponPage(visibleCouponPage-1)}>이전 쿠폰</Button><Button variant="secondary" disabled={(visibleCouponPage+1)*5>=quote.coupons.length} onClick={()=>setCouponPage(visibleCouponPage+1)}>다음 쿠폰</Button></div>}</div><div className="hrc-night-list">{quote.nights.slice(0,detailLimit).map(n=><div key={n.id}><strong>{n.day}일차 · {n.roomLabel}</strong><span>쿠폰 {n.coupon} · {n.stamp}번째 도장 · 기본 {quoteWon(n.rate)}</span><span>{n.free?'무료':n.discount?'10% 할인':'정상가'} · {quoteWon(n.final)}</span></div>)}</div>{quote.totalRoomNights>detailLimit&&<Button variant="secondary" onClick={()=>setDetailLimit(v=>v+50)}>상세 50박 더 보기</Button>}</details>}
        <details className="hrc-options hrc-advanced"><summary>추가 설정</summary><div className="hrc-advanced-content"><h3>객실 추가</h3><p className="hrc-hint">동일 유형도 여러 실 계산할 수 있습니다. 모두 같은 날 시작합니다.</p><div className="hrc-actions">{(['STANDARD','DELUXE'] as const).map(type=><Button key={type} variant="secondary" disabled={rooms.length>=MAX_QUOTE_ROOMS} onClick={()=>{clearFeedback();setRooms(rs=>[...rs,draftRoom(nextOrder.current++,type,rs[0].nights)]);}}>{type} 객실 추가</Button>)}</div>
      <div className="hrc-remove-rooms">{rooms.length>1&&rooms.map(r=><Button key={r.id} variant="ghost" aria-label={`${r.type} 객실 ${r.order} 삭제`} onClick={()=>{clearFeedback();setRooms(rs=>rs.filter(x=>x.id!==r.id));}}>{r.type} 객실 {r.order} 삭제</Button>)}</div>
      <Field label="기존 완료 쿠폰 장수"><Input aria-label="기존 완료 쿠폰 장수" type="number" inputMode="numeric" min="0" step="1" value={completed} onChange={e=>{clearFeedback();setCompleted(e.target.value);}}/></Field>
      <p className="hrc-hint">완료 장수는 쿠폰 번호·누적 표시용이며 할인액을 바꾸지 않습니다.</p>
      {rooms.map(r=><div key={r.id} className="hrc-price-row"><Field label={`${r.type} 객실 ${r.order} 1박 요금`}><Input aria-label={`${r.type} 객실 ${r.order} 1박 요금`} type="number" inputMode="numeric" min="1" step="1" value={r.rate} onChange={e=>changeRoom(r.id,'rate',e.target.value)}/></Field><Button variant="secondary" onClick={()=>changeRoom(r.id,'rate',String(HOTEL_NIGHTLY_RATES[r.type]))}>기본 요금 복원 · 객실 {r.order}</Button></div>)}
      <label className="hrc-check"><input type="checkbox" checked={extension} onChange={e=>{clearFeedback();setExtension(e.target.checked);}}/> 퇴실 없이 연속 숙박 연장</label>
      {extension&&<div className="hrc-extension"><p className="hrc-hint">시작 직전 도장과 전체 연속 숙박을 기준으로 재계산합니다. 이미 이용한 도장을 다시 더하지 마세요.</p>{rooms.map(r=><Field key={r.id} label={`${r.type} 객실 ${r.order} 추가 연장 박 수`}><Input aria-label={`${r.type} 객실 ${r.order} 추가 연장 박 수`} type="number" inputMode="numeric" min="0" step="1" value={r.extra} onChange={e=>changeRoom(r.id,'extra',e.target.value)}/></Field>)}<Field label="이번 연속 이용 기결제액"><Input aria-label="이미 결제한 금액" type="number" inputMode="numeric" min="0" step="1" value={paid} onChange={e=>{clearFeedback();setPaid(e.target.value);}}/></Field></div>}
      <details className="hrc-options"><summary>상세 숙박 구간</summary><p className="hrc-hint">기본은 모두 1일차 시작입니다. 유형 변경은 앞 객실의 기간을 끝내고 다음 객실의 시작 일차를 지정하세요. 실제 예약 날짜는 바꾸지 않습니다.</p>{rooms.map(r=><Field key={r.id} label={`${r.type} 객실 ${r.order} 시작 일차`}><Input aria-label={`${r.type} 객실 ${r.order} 시작 일차`} type="number" inputMode="numeric" min="1" max="10000" step="1" value={r.startDay} onChange={e=>changeRoom(r.id,'startDay',e.target.value)}/></Field>)}</details>
     </div></details>
  </div>
 </Modal>;
}
