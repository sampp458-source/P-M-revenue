import {useId,useRef,useState} from 'react';

export function TaskRecipientPicker({people,selected,onChange,disabled}:{people:{id:string;name:string}[];selected:string[];onChange:(ids:string[])=>void;disabled:boolean}) {
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false);
 const input=useRef<HTMLInputElement>(null),id=useId();
 // Keep search focus until the label/checkbox native click toggles once (including touch compatibility mouse events).
 const results=people.filter(person=>person.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <fieldset className="pt-recipient-picker" disabled={disabled} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}} onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();input.current?.focus();setOpen(false);}}}>
  <legend>담당자</legend>
  <input ref={input} aria-label="이름으로 담당자 검색" placeholder="이름으로 담당자 검색" autoComplete="off" aria-expanded={open} aria-controls={id} value={query} onFocus={()=>setOpen(true)} onClick={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setOpen(true);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();setOpen(true);}}}/>
  {selected.length>0&&<div className="pt-recipient-selected"><span className="pt-secondary">{selected.length}명 선택</span><div className="pt-recipient-chips">{selected.map(personId=><button type="button" key={personId} aria-label={`${people.find(person=>person.id===personId)?.name||'선택한 담당자'} 선택 제거`} onClick={()=>onChange(selected.filter(value=>value!==personId))}>{people.find(person=>person.id===personId)?.name||'선택한 담당자'} <span aria-hidden="true">×</span></button>)}</div></div>}
  {open&&<div id={id} className="pt-recipient-results" role="group" aria-label="담당자 검색 결과">{results.length?results.map(person=><label className="pt-check" key={person.id} onMouseDown={event=>event.preventDefault()}><input type="checkbox" onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();onChange(selected.includes(person.id)?selected.filter(value=>value!==person.id):[...new Set([...selected,person.id])]);}}} checked={selected.includes(person.id)} onChange={event=>onChange(event.target.checked?[...new Set([...selected,person.id])]:selected.filter(value=>value!==person.id))}/><span>{person.name}</span></label>):<p className="pt-secondary">검색 결과가 없습니다.</p>}</div>}
 </fieldset>;
}
