import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/today-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const source = readFileSync('src/pages/OperationsToday.tsx', 'utf8');
describe('Today V1 visual boundary', () => {
  it('isolates Today material to the Today page', () => {
    const adopters = readdirSync('src/pages').filter(name => name.endsWith('.tsx') && !name.endsWith('.test.tsx')).filter(name => readFileSync(`src/pages/${name}`, 'utf8').includes('pm-today-v1'));
    expect(adopters).toEqual(['OperationsToday.tsx']);
    for (const [, selector] of css.replace(/@media \(width < 48rem\) \{/, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const part of selector.split(',')) expect(part.trim()).toMatch(/^\.pm-design-v1\.pm-today-v1\b/);
    }
  });
  it('limits final mobile polish to schedule rows below the tablet boundary', () => {
    expect(css.match(/@media/g)).toHaveLength(1);
    const mobile = css.slice(css.indexOf('@media'));
    expect(mobile).toContain('@media (width < 48rem)');
    expect(mobile).toContain('.pm-today-list .pm-today-event');
    expect(mobile).toContain('translate: none;');
    expect(mobile).not.toMatch(/padding|margin|font-|opacity|grid-|display|pm-today-summary|pm-today-alerts/);
  });
  it('keeps existing responsive columns and permits long titles to wrap', () => {
    expect(source).toContain('md:grid-cols-[minmax(0,1.65fr)_minmax(17rem,0.85fr)]');
    expect(css).toMatch(/\.pm-today-event-title > span:first-child\s*\{[^}]*overflow-wrap: anywhere/);
    expect(css).not.toMatch(/@keyframes|pointer-events|visibility:\s*hidden|display:\s*none/);
  });
  it('keeps event rows and summary distribution flat without hiding empty-state actions', () => {
    expect(css).toMatch(/\.pm-today-event\s*\{[^}]*box-shadow: none/);
    expect(css).toMatch(/\.pm-today-summary dl\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(source).toContain('새 일정 등록');
    expect(source).toContain('확인이 필요한 일정이 없습니다.');
  });
});
