// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {SalesHeatmapCalendar} from './DashboardRangeSections';
import type {DailyRevenue} from './dashboardMetrics';

afterEach(cleanup);
const row:DailyRevenue={date:'2026-11-07',revenue:2147483647,salesAmount:987654321,count:123456,refund:1234,outstanding:5678,net:2147482413,cancelledCount:0};
const props={month:'2026-11',activeRange:{from:'2026-11-01',to:'2026-11-30'},data:[row],totalData:[row],unitName:'전체 사업부',themeCode:'all' as const,today:'2026-11-21',selectedDate:'2026-11-07',onMonth:vi.fn(),onSelect:vi.fn()};

it('preserves all seven weekdays, exact accessible values and date selection alongside compact mobile amounts',()=>{
 const onSelect=vi.fn();
 const {container}=render(<SalesHeatmapCalendar {...props} onSelect={onSelect}/>);
 expect([...container.querySelector('.dashboard-calendar-surface > .grid')!.children].map(x=>x.textContent)).toEqual(['일','월','화','수','목','금','토']);
 expect(container.querySelectorAll('.dashboard-calendar-day')).toHaveLength(30);
 const day=screen.getByRole('button',{name:/2026-11-07 전체 사업부 실수납 2,147,483,647원 판매금액 987,654,321원 판매 123456건/});
 expect(day.querySelector('.dashboard-calendar-amount .sm\\:hidden')?.textContent).toBe('21.5억');
 expect(day.querySelector('.dashboard-calendar-amount .sm\\:inline')?.textContent).toBe('21.5억원');
 fireEvent.click(day);expect(onSelect).toHaveBeenCalledWith('2026-11-07');
 expect(row.revenue).toBe(2147483647);
});

it('retains previous/next month and today actions',()=>{
 const onMonth=vi.fn();render(<SalesHeatmapCalendar {...props} month="2026-12" onMonth={onMonth}/>);
 fireEvent.click(screen.getByRole('button',{name:'이전 달'}));
 fireEvent.click(screen.getByRole('button',{name:'다음 달'}));
 fireEvent.click(screen.getByRole('button',{name:'오늘'}));
 expect(onMonth.mock.calls).toEqual([['2026-11'],['2027-01'],['2026-11']]);
});

it('retains the filtered exact total and keeps hidden amounts absent from visible cells',()=>{
 const {container,rerender}=render(<SalesHeatmapCalendar {...props} unitName="합성 교육센터" themeCode="training"/>);
 expect(screen.getByRole('button',{name:/2026-11-07 합성 교육센터.*전체 실수납 2,147,483,647원/})).toBeTruthy();
 rerender(<SalesHeatmapCalendar {...props} hideAmounts/>);
 expect(container.querySelectorAll('.dashboard-calendar-amount')).toHaveLength(0);
 expect(screen.getByRole('button',{name:/2026-11-07 거래 상세 열기/})).toBeTruthy();
 expect(screen.queryByText(/금액은 원 단위/)).toBeNull();
});
