import { useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import './staff-management.css';
export interface StaffIdentity { id: string; name: string; summary: string; color?: string }
export function StaffDirectory({ employees, children }: { employees: StaffIdentity[]; children: (id: string) => ReactNode }) {
 const [selected, setSelected] = useState<string>();
 const [mobileOpen, setMobileOpen] = useState(false);
 const pageScroll = useRef(0);
 const heading = useRef<HTMLHeadingElement>(null);
 const list = useRef<HTMLDivElement>(null);
 const current = employees.find(e => e.id === selected) ?? employees[0];
 const close = () => { setMobileOpen(false); requestAnimationFrame(() => { list.current?.querySelector<HTMLButtonElement>('[data-selected="true"]')?.focus({ preventScroll: true }); if (pageScroll.current) window.scrollTo(0, pageScroll.current); }); };
 return <div className={`staff-workspace ${mobileOpen ? 'staff-detail-open' : ''}`} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
 <div className="staff-directory" ref={list} aria-label="직원 목록">{!employees.length && <p className="staff-no-selection">조회된 직원이 없습니다.</p>}{employees.map(e => <button key={e.id} type="button" className="staff-person" data-selected={current?.id === e.id} aria-pressed={current?.id === e.id} onClick={() => { pageScroll.current = window.scrollY; setSelected(e.id); setMobileOpen(true); requestAnimationFrame(() => heading.current?.focus({ preventScroll: true })); }}><span className="staff-initial" aria-hidden="true">{e.name.slice(0, 1)}</span><span className="staff-person-text"><strong>{e.name}</strong><span>{e.summary}</span></span><ChevronRight size={16} aria-hidden="true" /></button>)}</div>
 <div className="staff-detail" aria-label="선택 직원 관리">{current ? <><button type="button" className="staff-back" onClick={close}><ArrowLeft size={18} />직원 목록</button><header className="staff-detail-heading"><span className="staff-eyebrow">직원 상세</span><h2 ref={heading} tabIndex={-1}>{current.name}</h2><p>{current.summary}</p></header>{children(current.id)}</> : <p className="staff-no-selection">목록에서 직원을 선택해 주세요.</p>}</div></div>;
}
