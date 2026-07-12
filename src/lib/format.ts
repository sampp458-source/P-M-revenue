export const won=(v:number)=>`${Math.round(v).toLocaleString('ko-KR')}원`
export const shortWon=(v:number)=>v>=100000000?`${(v/100000000).toFixed(1)}억원`:v>=10000?`${Math.round(v/10000).toLocaleString()}만원`:won(v)
export const koDate=(v:string)=>new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(`${v}T00:00:00`))
export const monthLabel=(v:string)=>{const [y,m]=v.split('-');return `${y}년 ${Number(m)}월`}
export const currentMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
export const net=(payment:number,refund:number,receivable:number,status?:string)=>status==='취소'?0:payment-refund-receivable

