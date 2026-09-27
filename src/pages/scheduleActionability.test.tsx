import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SchedulePeople } from './operationSchedulePresentation';
import type { OperationSchedule } from './operationsScheduleRepository';
const css = readFileSync('src/operations-schedule-presentation.css', 'utf8');
const actionability = css.slice(css.indexOf('/* Actionability applies'), css.indexOf('/* Monthly desktop only:'));
const fixture = (patch: Partial<OperationSchedule>) => ({ dogs: [], assignees: [{ id: 'staff', name: '담당자' }], ...patch } as OperationSchedule);
describe('schedule actionability presentation boundary', () => {
  it('keeps every approved monthly and temporal rule byte-identical', () => {
    expect(createHash('sha256').update(css.slice(css.indexOf('/* Monthly desktop only:'))).digest('hex')).toBe('cceeadcce6f7e545abbd16882098afae3439b120e441d86de1c87a13a63829ff');
    expect(actionability).not.toMatch(/pm-month|pm-calendar-day|data-temporal/);
  });
  it('attenuates content without dimming whole interactive buttons or status badges', () => {
    expect(actionability).toContain('[data-status=completed] {--pm-schedule-strength:.74;}');
    expect(actionability).toContain('[data-status=cancelled] {--pm-schedule-strength:.68;}');
    expect(actionability).toContain('>.pm-schedule-day-top>.pm-schedule-time');
    expect(actionability).not.toContain('.pm-schedule-status');
    expect(actionability).not.toMatch(/pointer-events|cursor:not-allowed|display:none/);
    expect(actionability).toContain('text-decoration:none!important');
  });
  it('keeps default rows flat across every status and reserves surface for hover', () => {
    expect(actionability).toContain(':is(.pm-today-event,.pm-schedule-day-row) {background:transparent!important;box-shadow:none!important;}');
    expect(actionability).toContain(':is(.pm-today-event,.pm-schedule-day-row):hover {background:var(--pm-d-surface-muted)!important;}');
    expect(actionability).not.toMatch(/\[data-status=scheduled\].*background|box-shadow:0/);
  });
  it('retains focus and restores content strength on interaction or existing attention', () => {
    expect(actionability).toContain(':is(:hover,:focus-visible) {--pm-schedule-strength:1;}');
    expect(actionability).toContain(':has([data-room-attention=true],[data-unassigned=true])');
    expect(actionability).toContain('outline:2px solid var(--pm-d-brand-cobalt)');
  });
  for (const state of ['unknown', 'unavailable'] as const) it(`preserves existing Hotel ${state} information even on completed rows`, () => {
    const html = renderToStaticMarkup(<SchedulePeople schedule={fixture({ status: 'completed', hotelEventKind: 'check_out', hotelRoomResolutionStatus: state })} />);
    expect(html).toContain('data-room-attention="true"');
    expect(html).toContain('담당 담당자');
  });
  it('does not invent Hotel attention for ordinary schedules or resolved historical records', () => {
    for (const patch of [{ hotelRoomResolutionStatus: 'unavailable' as const }, { hotelEventKind: 'check_out' as const, hotelRoomResolutionStatus: 'resolved' as const }]) {
      expect(renderToStaticMarkup(<SchedulePeople schedule={fixture(patch)} />)).toContain('data-room-attention="false"');
    }
  });
});
