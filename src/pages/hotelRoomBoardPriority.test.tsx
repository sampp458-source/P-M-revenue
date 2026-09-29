// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { HotelSelectedDateSummary } from './HotelSelectedDateSummary';
import type { HotelOperationsSnapshot } from './hotelOperationsRepository';

afterEach(cleanup);
it('orders summary DELUXE before STANDARD without changing server counts or source ordering', () => {
  const snapshot = {date:'2026-09-29', roomTypes:[
    {id:'s',code:'STANDARD',conservativeRemaining:3},
    {id:'d',code:'DELUXE',conservativeRemaining:4},
  ]} as HotelOperationsSnapshot;
  const {container}=render(<HotelSelectedDateSummary snapshot={snapshot} selectedDate={snapshot.date} assigned={3} checkIn={1} checkOut={1}/>);
  expect([...container.querySelectorAll('.hotel-selected-date-capacity > div')].map(e=>e.textContent)).toEqual(['DELUXE4실','STANDARD3실']);
  expect(snapshot.roomTypes.map(t=>t.code)).toEqual(['STANDARD','DELUXE']);
});
it('scopes work priority material to arrival/future sections, without changing lifecycle or room-type surfaces', () => {
  const css=readFileSync('src/pages/hotel-unassigned-classification.css','utf8');
  expect(css).toContain('.hotel-board-arrivals[data-drop-active="true"]');
  expect(css).toContain('.hotel-arrival-unassign-action:focus-visible');
  expect(css).toContain('.hotel-board-future .hotel-room-card-settle[data-room-phase]');
  expect(css).not.toMatch(/data-room-type|data-room-phase=["']?(?:in_house|check_out)/);
});
it('gives Single and Shared ARRIVAL cards the same restrained action material without changing future cards',()=>{
  const css=readFileSync('src/pages/hotel-unassigned-classification.css','utf8');
  expect(css).toMatch(/\.hotel-board-arrivals \.hotel-room-card-settle\[data-room-phase\]:not\(\.opacity-40\),\s*\.pm-design-d\.pm-d-page\.pm-hotel-v2 \.hotel-board-arrivals \[data-testid\^="hotel-room-board-unassigned-shared-"\] \{\s*background: #edf4ff !important;\s*border-color: #7799cf !important;/);
  expect(css).toContain('box-shadow: 0 2px 4px rgb(36 84 188 / 9%) !important;');
});
