import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/hotel-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
describe('Hotel V1 presentation boundary', () => {
  it('opts in only the Hotel page, not other consumers of shared primitives', () => {
    const adopters = readdirSync('src/pages').filter(name => name.endsWith('.tsx') && !name.endsWith('.test.tsx')).filter(name => readFileSync(`src/pages/${name}`, 'utf8').includes('pm-design-v1'));
    expect(adopters).toEqual(['HotelOperations.tsx']);
  });
  it('scopes every rule to Hotel and leaves layout, drag/drop and motion properties alone', () => {
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      expect(match[1].trim()).toMatch(/^\.pm-design-v1\.pm-hotel-v1(?:\s|$)/);
      expect(match[2]).not.toMatch(/(?:^|;)\s*(?:display|order|position|transform|translate|transition|animation|pointer-events|visibility|grid[^:]*|overflow|opacity)\s*:/);
    }
    expect(css).not.toContain('@keyframes');
    expect(css).not.toContain('@media');
  });
  it('does not replace candidate, hover, recommendation, settling or blocked room feedback', () => {
    const roomRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].includes('.hotel-room-cell') && !m[1].includes('.hotel-shared-member') && /(?:background|box-shadow|border[^:]*):/.test(m[2]));
    expect(roomRules.length).toBeGreaterThan(3);
    for (const [ , selector] of roomRules) {
      expect(selector).toContain(':not(.border-dashed, .border-2, [class*="ring-"], .hotel-room-drop-settle, .opacity-55)');
    }
  });
});
