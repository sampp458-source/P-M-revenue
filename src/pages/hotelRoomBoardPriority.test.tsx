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
