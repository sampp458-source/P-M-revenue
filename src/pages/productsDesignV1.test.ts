import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const source = readFileSync('src/pages/ProductManagement.tsx', 'utf8');
const css = readFileSync('src/products-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
describe('Product visual migration contract boundary', () => {
  it('preserves the approved data loading, filtering, permission and mutation implementation', () => {
    expect(hash(source.slice(source.indexOf('interface CategoryOption'), source.indexOf('  return (\n    <>\n      <div className="pm-design-v1')))).toBe('cf9b4658eb0e7b0c2a3fa0d3d4da237d350516dcce7851ad122f6ce62508cb0b');
  });
  it('leaves all existing product/category forms and confirmations unchanged and outside the visual scope', () => {
    expect(source).toContain('</div>\n      <Modal open={!!editing}');
    expect(hash(source.slice(source.indexOf('      <Modal open={!!editing}')))).toBe('0aa9e2d13975a6bb4b040895174b4763c545b929cc646e4c039c29bd65580b99');
  });
  it('scopes styling to Products and does not hide data or disable interactions', () => {
    for (const [, selectors, declarations] of css.replace(/@media[^{}]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(/,(?![^()]*\))/)) expect(selector.trim()).toMatch(/^\.pm-design-v1\.pm-products-v1\b/);
      expect(declarations).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none|animation\s*:/);
    }
  });
});
