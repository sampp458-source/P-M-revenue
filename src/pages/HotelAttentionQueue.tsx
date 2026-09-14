import {ArrowUpRight,ClipboardCheck} from 'lucide-react';
export type HotelAttentionItem={id:string;name:string;reason:string;onOpen:()=>void};
export function HotelAttentionQueue({items,disabled=false,showEmpty=false}:{items:HotelAttentionItem[];disabled?:boolean;showEmpty?:boolean}){
 if(!items.length)return showEmpty?<p className="hotel-attention-empty">확인할 미배정·누락 입실 항목이 없습니다.</p>:null;
 return <section className="hotel-attention-queue" aria-label="확인할 호텔 업무"><header><ClipboardCheck size={19} aria-hidden="true"/><h3>확인 필요 <b>{items.length}</b></h3><span>상세에서 확인 후 처리</span></header><div>{items.map(item=><button key={item.id} type="button" disabled={disabled} onClick={item.onOpen}><span><strong>{item.name}</strong><small>{item.reason}</small></span><ArrowUpRight size={18} aria-hidden="true"/></button>)}</div></section>;
}
