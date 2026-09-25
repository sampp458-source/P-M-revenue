import { normalizeVisualSystemD } from './visualSystemDTestNormalization';
import { normalizeAuditPresentation } from './auditPresentationTestNormalization';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
describe('Access screen presentation boundary', () => {
  it('preserves the full App.tsx contract after removing presentation hooks', () => {
    const source = normalizeAuditPresentation(normalizeVisualSystemD(readFileSync('src/App.tsx', 'utf8'))).replace(/import ["'].*(?:admin|settings|access)-design-v2\.css["'];\n/g, '').replace(/ pm-(?:admin|settings|access)-v2/g, '')
      .replace(/import ["']\.\.?\/access-design-v1\.css["'];\n/, '')
      .replace('pm-access-v1 pm-module-gate ', '')
      .replace('pm-access-v1 pm-not-found ', '')
      .replace('pm-access-v1 pm-signup ', '')
      .replace('pm-access-v1 pm-account-recovery ', '');
    expect(hash(source)).toBe('d32f80ee83115378bef98f30022121804942062194d48ae608c26b07e9dbc008');
  });
  it('preserves the full pages/SignupPage.tsx contract after removing presentation hooks', () => {
    const source = normalizeAuditPresentation(normalizeVisualSystemD(readFileSync('src/pages/SignupPage.tsx', 'utf8'))).replace(/import ["'].*(?:admin|settings|access)-design-v2\.css["'];\n/g, '').replace(/ pm-(?:admin|settings|access)-v2/g, '')
      .replace(/import ["']\.\.?\/access-design-v1\.css["'];\n/, '')
      .replace('pm-access-v1 pm-module-gate ', '')
      .replace('pm-access-v1 pm-not-found ', '')
      .replace('pm-access-v1 pm-signup ', '')
      .replace('pm-access-v1 pm-account-recovery ', '');
    expect(hash(source)).toBe('f33191ed4b06b00e5bcbf6f943ea53b58929915a3f9f550e0c6e43d747a28de2');
  });
  it('preserves the full pages/AccountRecoveryPages.tsx contract after removing presentation hooks', () => {
    const source = normalizeAuditPresentation(normalizeVisualSystemD(readFileSync('src/pages/AccountRecoveryPages.tsx', 'utf8'))).replace(/import ["'].*(?:admin|settings|access)-design-v2\.css["'];\n/g, '').replace(/ pm-(?:admin|settings|access)-v2/g, '')
      .replace(/import ["']\.\.?\/access-design-v1\.css["'];\n/, '')
      .replace('pm-access-v1 pm-module-gate ', '')
      .replace('pm-access-v1 pm-not-found ', '')
      .replace('pm-access-v1 pm-signup ', '')
      .replace('pm-access-v1 pm-account-recovery ', '');
    expect(hash(source)).toBe('7221d129fc583e305cd571601ae9d230d794b22cddbd69bfb359baaa55109d1a');
  });
  it('isolates styles from Login and other application screens', () => {
    const css = readFileSync('src/access-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{}]*\{/g, '');
    for (const [, selectors] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      let depth = 0;
      let start = 0;
      for (let i = 0; i <= selectors.length; i++) {
        if (selectors[i] === '(') depth++;
        if (selectors[i] === ')') depth--;
        if (i === selectors.length || (selectors[i] === ',' && depth === 0)) {
          expect(selectors.slice(start, i).trim()).toMatch(/^\.pm-access-v1\b/);
          start = i + 1;
        }
      }
    }
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain(':focus-visible');
  });
});
