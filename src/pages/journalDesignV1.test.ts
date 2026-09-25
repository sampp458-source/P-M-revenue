import { normalizeVisualSystemD } from './visualSystemDTestNormalization';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
describe('Journal V1 presentation boundary', () => {
  it('preserves roster ordering, filters, registration, deletion, navigation and batch export', () => {
    const source = normalizeVisualSystemD(readFileSync('src/pages/JournalHome.tsx', 'utf8'))
      .replace('import "../design-system-v2.css";\n', '')
      .replace('import "../journal-design-v2.css";\n', '')
      .replace(' pm-design-v2 pm-journal-home-v2', '')
      .replace('import "../journal-design-v1.css";\n', '')
      .replace('pm-design-v1 pm-journal-home-v1 ', '')
      .replace('journal-roster-surface ', '')
      .replace('journal-roster-row ', '');
    expect(hash(source)).toBe('4d57573b13cd49141ebf75ec5cc18c9e0abca59308c1207bf51f69a5f26f9e9d');
  });
  it('preserves editor autosave timing, version, payloads, completion and export exactly', () => {
    const source = normalizeVisualSystemD(readFileSync('src/pages/JournalEditor.tsx', 'utf8'))
      .replace('import "../design-system-v2.css";\n', '')
      .replace('import "../journal-design-v2.css";\n', '')
      .replace(' pm-journal-editor-v2', '')
      .replace('import "../journal-design-v1.css";\n', '')
      .replace('pm-journal-editor-v1 ', '')
      .replace('journal-editor-section ', '');
    expect(hash(source)).toBe('fc529c21d3e5f490e53d0b326350bf6002f041e797ddb4abf6d47fe0c1e8c31e');
  });
  it('does not opt the report preview into shared visual primitives', () => {
    const source = normalizeVisualSystemD(readFileSync('src/pages/JournalEditor.tsx', 'utf8'))
      .replace('import "../design-system-v2.css";\n', '')
      .replace('import "../journal-design-v2.css";\n', '')
      .replace(' pm-journal-editor-v2', '');
    expect(source).not.toContain('pm-design-v1');
    const css = readFileSync('src/journal-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selectors, declarations] of css.replace(/@media[^{}]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(/,(?![^()]*\))/)) expect(selector.trim()).toMatch(/^(?:\.pm-design-v1\.pm-journal-home-v1|\.pm-journal-editor-v1)\b/);
      expect(declarations).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none/);
    }
    expect(css).not.toMatch(/journal-report|journal-editor-preview|canvas/);
  });
});
