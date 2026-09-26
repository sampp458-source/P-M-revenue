import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { scheduleAssigneeLabel, scheduleBusiness, SchedulePeople, ScheduleStatus, SCHEDULE_BUSINESSES, MobileCalendarStatusSummary, MobileCalendarStatusLegend } from './operationSchedulePresentation';
import type { OperationSchedule } from './operationsScheduleRepository';
const fixture = (patch: Partial<OperationSchedule> = {}) => ({ assignees: [], dogs: [], businessUnitCode: null, ...patch } as OperationSchedule);
const files = {
  'OperationsToday.tsx': '3dea50e46f76dd50c2770b48d1a03c5cd30a2ea63491b6340bff81adbd05dda2',
  'OperationsCalendarFoundation.tsx': 'b8c4ced3e6c29fb72c20d70cabd3e070e722b3ed41e25003366b5441b5fa7b4c',
};
describe('Operations schedule presentation contract', () => {
  for (const [file, expected] of Object.entries(files)) it(`${file}: preserves all workflow declarations and page handlers from approved HEAD`, () => {
    const source = readFileSync(`src/pages/${file}`, 'utf8').replace('            <MobileCalendarStatusLegend />\n', '');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    // Explicitly permitted leaf render functions only; full page component (queries, handlers, dialogs) remains hashed.
    const presentation = ['ScheduleRow', 'TodaySummary', 'CalendarCell', 'MonthScheduleCard', 'DayDrawer'];
    const workflow = ast.statements.filter(n => !ts.isImportDeclaration(n) && !(ts.isFunctionDeclaration(n) && presentation.includes(n.name?.text ?? ''))).map(n => n.getText(ast)).join('\n');
    expect(createHash('sha256').update(workflow).digest('hex')).toBe(expected);
  });
  it('reuses Production summary colors, independently of status or assignee', () => {
    expect(Object.values(SCHEDULE_BUSINESSES).map(v => v.color)).toEqual(['#52B8D0', '#4568B2', '#C99845', '#5B7FA3']);
    for (const status of ['scheduled', 'completed', 'cancelled'] as const) expect(scheduleBusiness(fixture({ businessUnitCode: 'hotel', status })).color).toBe('#C99845');
    expect(scheduleBusiness(fixture()).label).toBe('공통');
  });
  it('shows missing, single and multiple actual assignees', () => {
    expect(scheduleAssigneeLabel(fixture())).toBe('담당 미지정');
    expect(scheduleAssigneeLabel(fixture({ assignees: [{ id: 'a', name: '정하성' }] }))).toBe('담당 정하성');
    expect(scheduleAssigneeLabel(fixture({ assignees: [{ id: 'a', name: '정하성' }, { id: 'b', name: '최석현' }] }))).toBe('담당 정하성 외 1명');
  });
  it('keeps related dog names and never invents an unlinked dog placeholder', () => {
    expect(renderToStaticMarkup(<SchedulePeople schedule={fixture()} />)).not.toContain('반려견 미연결');
    const html = renderToStaticMarkup(<SchedulePeople schedule={fixture({ dogs: [{ id: 'a', name: '나무', customerId: null }, { id: 'b', name: '버들', customerId: null }] })} />);
    expect(html).toContain('나무 · 버들');
    expect(html).toContain('담당 미지정');
  });
  it('renders all domain status labels separately from business identity', () => {
    for (const [status, label] of [['scheduled', '예정'], ['completed', '완료'], ['cancelled', '취소']] as const) {
      const html = renderToStaticMarkup(<ScheduleStatus status={status} />);
      expect(html).toContain(`data-status="${status}"`); expect(html).toContain(label);
    }
  });
  it('retains drawer ordering, lifecycle details and original open/close behavior', () => {
    const source = readFileSync('src/pages/OperationsCalendarFoundation.tsx', 'utf8');
    expect(source).toContain('Number(Boolean(a.timeUnspecified)) - Number(Boolean(b.timeUnspecified)) || Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id)');
    expect(source).toContain('onClick={() => onOpen(schedule)}');
    expect(source).toContain('operationScheduleHotelRoomLabel(schedule)');
    expect(source).toContain('if (event.key === "Escape") onClose();');
    expect(source).toContain('w-full max-w-[560px]');
  });
  it('scopes styling to Today/Calendar and isolates business from status paint', () => {
    const css = readFileSync('src/operations-schedule-presentation.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(?:layer|media)[^{]+\{/g, '');
    for (const [, selector] of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) expect(selector.trim()).toMatch(/^\.pm-design-d(?::is\(\.pm-today-v1,\.pm-calendar-v1\)|\.pm-(?:today|calendar)-v1|\.pm-d-page\.pm-calendar-v1)/);
    expect(css).not.toMatch(/visibility:\s*hidden|pointer-events:\s*none/);
    expect(css).toContain('--pm-d-semantic-mint');
  });
  it('summarizes all mobile events by existing status without mutating input', () => {
    const schedules = [...Array.from({ length: 24 }, () => fixture({ status: 'scheduled' })), ...Array.from({ length: 11 }, () => fixture({ status: 'completed' })), fixture({ status: 'cancelled' })];
    const before = JSON.stringify(schedules);
    const output = renderToStaticMarkup(<MobileCalendarStatusSummary schedules={schedules} id="date-summary" />);
    expect(output).toContain('예정 24건, 완료 11건, 취소 1건');
    expect(output.match(/data-status=/g)).toHaveLength(3);
    expect(output).not.toMatch(/>(예|완|취)</);
    expect(JSON.stringify(schedules)).toBe(before);
  });
  it('leaves empty dates empty and explains colors once in a full-label legend', () => {
    expect(renderToStaticMarkup(<MobileCalendarStatusSummary schedules={[]} id="empty" />)).toBe('');
    const output = renderToStaticMarkup(<MobileCalendarStatusLegend />);
    for (const label of ['예정', '완료', '취소']) expect(output).toContain(label);
  });
  it('restricts monthly overview visibility to mobile while keeping desktop cards', () => {
    const css = readFileSync('src/operations-schedule-presentation.css', 'utf8');
    expect(css).toContain(':is(.pm-month-status-summary,.pm-month-status-legend) {display:none!important;}');
    expect(css).toMatch(/@media\(max-width:767px\)\s*\{\s*\.pm-design-d\.pm-calendar-v1 \.pm-calendar-events \{display:none!important;/);
    const source = readFileSync('src/pages/OperationsCalendarFoundation.tsx', 'utf8');
    expect(source).toContain('onClick={onClick}');
    expect(source).toContain('aria-pressed={selected}');
    expect(source).toContain('schedules.slice(0, 2)');
    expect(source).not.toContain('pm-month-mobile-event');
  });

});
