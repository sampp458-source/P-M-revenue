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
it('uses neutral section material and shared amber semantics for Single/Shared arrival cards',()=>{
  const css=readFileSync('src/pages/hotel-unassigned-classification.css','utf8');
  const layer=css.split('@layer pm-d-adoption {')[1];
  const outer=layer.split('.hotel-board-arrivals {')[1].split('}')[0];
  expect(outer).toContain('background: #fff !important;');
  expect(outer).toContain('var(--pm-d-border-default, #dce1e6)');
  expect(outer).not.toMatch(/cobalt|#f7faff|#b7c8e4/);
  const cards=layer.split('.hotel-board-arrivals .hotel-room-card-settle[data-room-phase]:not(.opacity-40),')[1].split('}')[0];
  expect(cards).toContain('[data-testid^="hotel-room-board-unassigned-shared-"]');
  expect(cards).toContain('var(--pm-d-semantic-amber-soft, #fff7e8)');
  expect(cards).toContain('var(--pm-d-semantic-amber, #946515)');
  expect(cards).not.toContain('#edf4ff');
});
it('keeps cobalt interaction independent of amber assignment status and Future white',()=>{
  const css=readFileSync('src/pages/hotel-unassigned-classification.css','utf8');
  const active=css.split('.hotel-board-arrivals[data-drop-active="true"] {')[1].split('}')[0];
  expect(active).toContain('outline: 2px solid var(--pm-d-brand-cobalt, #2454bc)');
  const future=css.split('.hotel-board-future,')[1];
  expect(future).toContain('background: #fff !important;');
  expect(future).toContain('box-shadow: none !important;');
  expect(future).not.toContain('amber');
});
