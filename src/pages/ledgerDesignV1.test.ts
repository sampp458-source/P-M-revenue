import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/ledger-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
describe('Ledger visual isolation', () => {
  it('scopes every rule to the Ledger opt-in without hiding information or disabling controls', () => {
    const rules = css.replace(/@media[^{}]*\{/g, '');
    for (const [, selectors, declarations] of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(/,(?![^()]*\))/)) {
        expect(selector.trim()).toMatch(/^\.pm-design-v1\.pm-ledger-v1\b/);
      }
      expect(declarations).not.toMatch(/(?:display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none|animation\s*:)/);
    }
  });
  it('keeps compact rows flat and permits long financial labels and amounts to wrap', () => {
    expect(css).toMatch(/\.ledger-event\s*\{[^}]*box-shadow: none/);
    expect(css).toMatch(/\.ledger-event\s*\{[^}]*border-bottom: 1px solid/);
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toMatch(/text-overflow:\s*ellipsis|linear-gradient|@keyframes/);
  });
});

describe('Ledger mobile density boundary', () => {
  it('limits the final polish to populated rows below the tablet breakpoint', () => {
    const polish = css.slice(css.indexOf('@media (390px <= width < 48rem)'));
    expect(polish).toContain('.ledger-mobile-results > .ledger-event');
    expect(polish).toContain('padding-block: 10px');
    expect(polish).toContain('margin-top: 6px');
    expect(polish).not.toMatch(/font-size|line-height|ledger-empty|ledger-summary|ledger-filters|display|\border\s*:/);
    for (const [, selectors] of polish.replace(/@media[^{}]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(',')) expect(selector).toContain('.ledger-mobile-results > .ledger-event');
    }
  });
});
