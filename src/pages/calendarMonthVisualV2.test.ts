import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (file: string) => readFileSync(`src/${file}`, 'utf8');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
describe('Calendar monthly V2 presentation boundary', () => {
  it('freezes Today source byte for byte', () => {
    expect(sha(read('pages/OperationsToday.tsx'))).toBe('29e0ddcba500c5ed8b33ca95fb114bcac4781b33604c07becd8be6925d953076');
  });
  it('keeps monthly status readable without repeating detail badges', () => {
    const source = read('pages/OperationsCalendarFoundation.tsx');
    const month = source.slice(source.indexOf('function MonthScheduleCard('), source.indexOf('function DayDrawer('));
    expect(month).toContain('pm-month-business-rail');
    expect(month).toContain('scheduleBusiness(schedule).color');
    expect(month).toContain('operationScheduleTimeLabel(schedule)');
    expect(month).toContain('"✓"');
    expect(month).toContain('"×"');
    expect(month).not.toContain('<ScheduleStatus');
    expect(month).not.toContain('<SchedulePeople');
    expect(month).not.toContain('<ScheduleBusinessMarker');
  });
  it('limits new material rules to desktop Calendar', () => {
    const css = read('operations-schedule-presentation.css');
    const addition = css.slice(css.indexOf('/* Monthly desktop only:'));
    expect(addition).toContain('@media(min-width:768px)');
    expect(addition).not.toContain('.pm-today');
    expect(addition).not.toContain('.pm-schedule-day');
    expect(addition).not.toContain('.pm-month-status-summary');
    expect(addition).toContain('.pm-design-d.pm-d-page.pm-calendar-v1.pm-calendar-v2.pm-d-rollout2');
    expect(addition).toContain('background:#fff!important');
  });
  it('keeps desktop base surfaces white without decorative date washes', () => {
    const css = read('operations-schedule-presentation.css');
    const desktop = css.slice(css.indexOf('/* Monthly desktop only:'));
    expect(desktop).toContain('.pm-calendar-surface {background:#fff!important;}');
    expect(desktop).toContain('.pm-calendar-grid {background:#fff!important;');
    expect(desktop).toContain(':hover:not([aria-pressed=true]) {background:#fff!important;}');
    expect(desktop).toContain('border-right:1px solid rgb(0 0 0 / 6%)!important');
    expect(desktop).not.toMatch(/#fffefa|#faf9f5|#eeede9|#efeee9/);
  });
  it('preserves a selected outline when the date is also today', () => {
    const css = read('operations-schedule-presentation.css');
    const selector = '.pm-design-d.pm-d-page.pm-calendar-v1.pm-calendar-v2.pm-d-rollout2 .pm-d-calendar-day[aria-pressed=true]:has(.pm-calendar-day-number.bg-primary)';
    const rule = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
    expect(css.indexOf(selector)).toBeGreaterThan(css.indexOf('@media(min-width:768px)'));
    expect(rule).toContain('box-shadow:inset 0 0 0 1px var(--pm-d-brand-cobalt)!important');
    expect(rule).toContain('background:#fff!important');
  });

});
