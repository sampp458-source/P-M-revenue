import { normalizeVisualSystemD } from './visualSystemDTestNormalization';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const source = (name: string) => normalizeVisualSystemD(readFileSync(`src/pages/${name}.tsx`, 'utf8'));
const removeScope = (text: string, kind: string, following: string) => text
  .replace('import "../design-system-v2.css";\n', '')
  .replace('import "../sales-form-design-v2.css";\n', '')
  .replace(' pm-design-v2 pm-sales-form-v2', '')
  .replace('import "../sales-form-design-v1.css";\n', '')
  .replace(`      <div className="pm-design-v1 pm-sales-form-v1 pm-sale-${kind}">\n`, '')
  .replace(`      </form>\n      </div>\n${following}`, `      </form>\n${following}`);
describe('Sales form visual-only boundary', () => {
  it('preserves every original new-sale statement, handler, validation, payload and modal', () => {
    const original = removeScope(source('SaleRegistration'), 'new', '\n      {notice')
      .replace('sale-summary h-fit', 'h-fit')
      .replace('sale-mobile-cta fixed', 'fixed')
      .replaceAll('sale-product-options flex', 'flex');
    expect(hash(original)).toBe('fbc60cdfcefee0fec7eb4decb4afe98d8289d532ed1552f241181979b1edfba1');
  });
  it('preserves the separate legacy edit implementation including calculations and quick forms', () => {
    const original = removeScope(source('Sales'), 'edit', '      <QuickCustomer')
      .replace('sale-edit-surface p-5', 'p-5')
      .replace('sale-edit-advanced grid', 'grid');
    expect(hash(original)).toBe('ee22f5276360c5dbaff6642b0f5e0f36b06884a5794e1ce387c4ca29bd7e6668');
  });
  it('scopes all CSS and does not hide financial information or disable interaction', () => {
    const css = readFileSync('src/sales-form-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selectors, declarations] of css.replace(/@media[^{}]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(/,(?![^()]*\))/)) expect(selector.trim()).toMatch(/^(?:\.pm-design-v1\.pm-sales-form-v1\b|html:has\(\.pm-design-v1\.pm-sales-form-v1\.pm-sale-new\)$)/);
      expect(declarations).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none/);
    }
  });
});
