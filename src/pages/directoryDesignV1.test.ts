import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/directory-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
describe('Customer and pet directory presentation boundary', () => {
  it('isolates every rule and preserves information, control access and ordering', () => {
    for (const [, selectors, declarations] of css.replace(/@media[^{}]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(/,(?![^()]*\))/)) expect(selector.trim()).toMatch(/^\.pm-design-v1\.pm-directory-v1\b/);
      if (/display\s*:\s*none/.test(declarations)) expect(selectors).toMatch(/directory-(compact|wide)-actions/);
      expect(declarations).not.toMatch(/visibility\s*:\s*hidden|pointer-events\s*:\s*none|\border\s*:|animation\s*:/);
    }
  });
  it('keeps profile and command modals outside the directory material boundary', () => {
    for (const [file, modal] of [['CustomerManagement.tsx', 'CustomerProfileModal'], ['DogManagement.tsx', 'DogProfileModal']]) {
      const source = readFileSync(`src/pages/${file}`, 'utf8');
      expect(source).toContain(`</div>\n      <${modal}`);
    }
  });
});
