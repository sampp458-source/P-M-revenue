// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { HotelSelectedDateSummary } from './HotelSelectedDateSummary';
import type { HotelOperationsSnapshot } from './hotelOperationsRepository';
afterEach(cleanup);
const snapshot = (): HotelOperationsSnapshot => ({
  date: '2026-09-29', rooms: [], settings: null, stays: [], unassignedFuture: [],
  roomTypes: ['DELUXE', 'STANDARD'].map((code, i) => ({id: code, code, name: code, activeRooms: 6-i, reservedPeak: 2, reservedNow: 3, checkedInNow: 3, allocatedNow: 3, unassignedNow: 0, physicallyEmpty: 8, confirmedRemaining: 4-i, conservativeRemaining: 4-i})),
  overallSafeRemaining: 8,
  selectedDateUnassigned: {date: '2026-09-29', count: 1, singleStayIds: ['mary'], sharedGroupIds: [], items: []},
});
const props = () => ({snapshot: snapshot(), selectedDate: '2026-09-29', assigned: 3, checkIn: 1, checkOut: 1});
const metric = (label: string) => within(screen.getByText(label, {selector: 'dt'}).parentElement!).getByRole('definition');
describe('selected-date server-projected Header', () => {
  it('shows canonical September fixture 4/3, assigned 3, unassigned 1, arrivals/departures 1', () => {
    render(<HotelSelectedDateSummary {...props()} />);
    for (const [label, value] of [['DELUXE','4실'],['STANDARD','3실'],['배정','3실'],['미배정','1건'],['입실','1'],['퇴실','1']]) expect(metric(label)).toHaveTextContent(value);
    expect(metric('DELUXE').parentElement).toHaveAttribute('data-room-type', 'DELUXE');
    expect(metric('STANDARD').parentElement).toHaveAttribute('data-room-type', 'STANDARD');
    expect(screen.queryByText('빈방')).not.toBeInTheDocument();
    expect(screen.queryByText('8실')).not.toBeInTheDocument();
  });
  it('never uses noon unassignedNow or broad queue counts', () => {
    const p=props(); p.snapshot.unassignedFuture=Array(4).fill({id: 'future'});
    render(<HotelSelectedDateSummary {...p} />); expect(metric('미배정')).toHaveTextContent('1건');
  });
  it('prints final Single + Shared booking-unit count, never member/segment arithmetic', () => {
    const p=props();p.snapshot.selectedDateUnassigned={date:p.selectedDate,count:2,singleStayIds:['stay'],sharedGroupIds:['group'],items:[]};
    render(<HotelSelectedDateSummary {...p} />);expect(metric('미배정')).toHaveTextContent('2건');
  });
  it('retains conservative unknown-type values and explanation', () => {
    const p=props();p.snapshot.individualTypeAvailabilityWarning=true;p.snapshot.roomTypes[0].conservativeRemaining=2;
    render(<HotelSelectedDateSummary {...p} />);expect(metric('DELUXE')).toHaveTextContent('2실');expect(screen.getByRole('status')).toHaveTextContent('보수적');
  });
  it('missing conservative evidence never falls back to optimistic confirmed count', () => {
    const p=props();p.snapshot.individualTypeAvailabilityWarning=true;delete p.snapshot.roomTypes[0].conservativeRemaining;
    render(<HotelSelectedDateSummary {...p} />);expect(metric('DELUXE')).toHaveTextContent('확인 필요');
  });
  it('old DB missing additive projection is unavailable, never zero or locally inferred', () => {
    const p=props();delete p.snapshot.selectedDateUnassigned;
    render(<HotelSelectedDateSummary {...p} />);expect(metric('미배정')).toHaveTextContent('확인 필요');
  });
  it('date switch suppresses stale values, then displays the matching server snapshot', () => {
    const p=props();const v=render(<HotelSelectedDateSummary {...p} />);
    v.rerender(<HotelSelectedDateSummary {...p} selectedDate="2026-10-09" />);expect(metric('배정')).toHaveTextContent('확인 중');expect(metric('미배정')).toHaveTextContent('확인 필요');
    p.snapshot.date='2026-10-09';p.snapshot.selectedDateUnassigned!.date='2026-10-09';p.snapshot.selectedDateUnassigned!.count=3;p.snapshot.roomTypes[0].conservativeRemaining=1;
    v.rerender(<HotelSelectedDateSummary {...p} selectedDate="2026-10-09" assigned={5} />);
    expect(metric('DELUXE')).toHaveTextContent('1실');expect(metric('배정')).toHaveTextContent('5실');expect(metric('미배정')).toHaveTextContent('3건');
  });
});
