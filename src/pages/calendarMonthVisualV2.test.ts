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
    expect(addition).toContain('background:#fffefa!important');
  });
});
