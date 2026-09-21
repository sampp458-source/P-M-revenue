import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/calendar-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const source = readFileSync('src/pages/OperationsCalendarFoundation.tsx', 'utf8');
describe('Calendar V1 visual boundary', () => {
  it('keeps material adoption isolated to Calendar, Hotel, Today and Ledger pages', () => {
    const pages = readdirSync('src/pages').filter(name => name.endsWith('.tsx') && !name.endsWith('.test.tsx'));
    expect(pages.filter(name => readFileSync(`src/pages/${name}`, 'utf8').includes('pm-calendar-v1'))).toEqual(['OperationsCalendarFoundation.tsx']);
    expect(pages.filter(name => readFileSync(`src/pages/${name}`, 'utf8').includes('pm-design-v1'))).toEqual(['HotelOperations.tsx', 'OperationsCalendarFoundation.tsx', 'OperationsToday.tsx', 'SalesHistoryDB.tsx']);
  });
  it('scopes all rules and leaves responsive visibility, placement and motion intact', () => {
    for (const [, selector, declarations] of css.replace(/@media \(width < 40rem\) \{/, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const part of selector.split(',')) expect(part.trim()).toMatch(/^\.pm-design-v1\.pm-calendar-v1\b/);
      expect(declarations).not.toMatch(/(?:^|;)\s*(?:display|position|order|transform|translate|transition|animation|pointer-events|visibility|overflow|opacity|grid[^:]*)\s*:/);
    }
    expect(css).not.toContain('@keyframes');
    expect(css.match(/@media/g)).toHaveLength(1);
    expect(css).toContain('@media (width < 40rem)');
    expect(source).toContain('mt-2 flex flex-wrap gap-1 sm:hidden');
    expect(source).toContain('mt-1.5 hidden space-y-1 sm:block');
    expect(source).toContain('w-full max-w-[560px]');
  });
  it('fits mobile counts through spacing and wrapping, not hidden content', () => {
    const mobile = css.slice(css.indexOf('@media'));
    expect(mobile).toContain('.pm-calendar-cell-heading');
    expect(mobile).toContain('gap: 0;');
    expect(mobile).toContain('flex-wrap: wrap;');
    expect(mobile).toContain('padding-inline: 1px;');
    expect(mobile).not.toMatch(/overflow|display|visibility|font-size/);
  });
  it('keeps date and event surfaces flat with a distinct selected boundary', () => {
    expect(css).toMatch(/\.pm-calendar-cell\s*\{[^}]*box-shadow: none;/);
    expect(css).toMatch(/\.pm-calendar-event\s*\{[^}]*box-shadow: none;/);
    expect(css).toMatch(/\.pm-calendar-cell\[aria-pressed="true"\]\s*\{[^}]*inset 0 0 0 2px var\(--pm-v1-navy\)/);
    expect(css).not.toContain('linear-gradient');
  });
});
