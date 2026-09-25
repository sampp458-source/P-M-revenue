import { normalizeVisualSystemD } from './visualSystemDTestNormalization';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const hashes = {"DashboardDB": "62f484d6c2870f05c2e3cc4ed632c209f88fa8befd5a35be31b0f81a67757072", "ReportsDB": "00e461d3345ebeca4bf42ac3e5e4d94082c5b1299b8885a55e71a97018c5a2c6", "SaleRegistration": "4f9235054d3b10f8b82330bf8f4b1e61f0f217753af5852294ae8edfed844b03", "Sales": "35bccb737c0c700c37987e6c954b5959eacfcaf586e5fcd616bc4bfe31e77e79", "JournalHome": "7a666fda96e61aab624d7cac2c7b1b268c011b61dfb3a6bc9a1489e640178d48", "JournalEditor": "5df0d6c77b5250f82c7ae3a7ba1fedaedfeeab75a40e734bd33217d70acb5d04"};
describe('Finance Sales Journal V2 boundaries', () => {
 for (const [name, hash] of Object.entries(hashes)) it(`${name}: original behavior is byte-preserved`, () => {
  const source = normalizeVisualSystemD(readFileSync(`src/pages/${name}.tsx`, 'utf8')).replace(/import "\.\.\/(?:design-system|finance-design|sales-form-design|journal-design)-v2\.css";\n/g, '').replace(/ pm-design-v2 pm-(?:finance|sales-form|journal-home)-v2| pm-journal-editor-v2/g, '');
  expect(createHash('sha256').update(source).digest('hex')).toBe(hash);
 });
 for (const kind of ['finance','sales-form','journal']) it(`${kind}: opt-in CSS only`, () => {
  const css = readFileSync(`src/${kind}-design-v2.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/@media[^{}]*\{/g,'');
  for(const [,selectors, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
   for(const selector of selectors.split(/,(?![^()]*\))/)) expect(selector.trim()).toMatch(/^\.pm-(?:finance-v1\.pm-finance-v2|design-v1\.pm-(?:sales-form|journal-home)-v1\.pm-(?:sales-form|journal-home)-v2|journal-editor-v1\.pm-journal-editor-v2)/);
   expect(declarations).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none/);
  }
 });
 it('editor does not opt report descendants into Foundation',()=>{
  const source=normalizeVisualSystemD(readFileSync('src/pages/JournalEditor.tsx','utf8'));
  expect(source).not.toContain('pm-design-v2');
  const css=readFileSync('src/journal-design-v2.css','utf8');
  expect(css).not.toMatch(/journal-report|journal-editor-preview|canvas/);
 });
});
