import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/hotel-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
describe('Hotel V1 presentation boundary', () => {
  it('keeps the Hotel material scope on the Hotel page only', () => {
    const adopters = readdirSync('src/pages').filter(name => name.endsWith('.tsx') && !name.endsWith('.test.tsx')).filter(name => readFileSync(`src/pages/${name}`, 'utf8').includes('pm-hotel-v1'));
    expect(adopters).toEqual(['HotelOperations.tsx']);
  });
  it('scopes every rule to Hotel and preserves drag/drop and motion properties with scoped responsive layout', () => {
    for (const match of css.replace(/@media[^{}]+\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      expect(match[1].trim()).toMatch(/^\.pm-design-v1\.pm-hotel-v1(?:\s|$)/);
      expect(match[2]).not.toMatch(/(?:^|;)\s*(?:order|position|transform|translate|transition|animation|pointer-events|visibility|opacity)\s*:/);
    }
    expect(css).not.toContain('@keyframes');
    expect(css.match(/@media/g)).toHaveLength(2);
    expect(css).toContain('@media (width < 48rem)');
  });
  it('uses a neutral overview and exposes existing attention actions on mobile', () => {
    expect(css).not.toMatch(/linear-gradient|depth-raised|depth-inset/);
    const mobile = css.slice(css.indexOf('@media'));
    expect(mobile).toMatch(/hotel-attention-queue\s*\{[^}]*display: block/);
    expect(mobile).not.toMatch(/hotel-workspace-panel|data-view/);
  });
  it('keeps mobile room compaction spacing-only and empty desktop slots compact', () => {
    const rules = [...css.replace(/@media[^{}]+\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const mobile = css.slice(css.indexOf('@media (width <'), css.indexOf('@media (width >='));
    expect(mobile).not.toMatch(/font-size|line-height|font-weight/);
    for (const [, selector, declarations] of rules.filter(([, selector, declarations]) => selector.includes('hotel-room-cell[data-room-content="occupied"]') && declarations.includes('100.8px'))) {
      expect(selector).toContain('.pm-hotel-v1');
      expect(declarations.replace(/(?:padding|min-height|column-gap):[^;]+;/g, '').trim()).toBe('');
    }
    expect(css).toContain('min-height: 76px');
    expect(css).not.toContain('background: #fffcf6');
  });
  it('does not replace candidate, hover, recommendation, settling or blocked room feedback', () => {
    const roomRules = [...css.replace(/@media[^{}]+\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].includes('.hotel-room-cell') && !m[1].includes('.hotel-shared-member') && /(?:background|box-shadow|border[^:]*):/.test(m[2]));
    expect(roomRules.length).toBeGreaterThan(3);
    for (const [ , selector] of roomRules) {
      expect(selector).toContain(':not(.border-dashed, .border-2, [class*="ring-"], .hotel-room-drop-settle, .opacity-55)');
    }
  });
});
