import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const original = (file: string) => readFileSync(file, 'utf8').replace('import "../settings-design-v1.css";\n', '');
describe('Settings V1 presentation boundary', () => {
  it('preserves all target values, total calculations, permissions, per-row save payloads and focus restoration', () => {
    let source = original('src/pages/SettingsDB.tsx')
      .replace('<section className="pm-design-v1 pm-settings-v1 pm-target-settings-v1">', '<>')
      .replace('  </section>;', '  </>;');
    for (const hook of ['target-period', 'target-form', 'target-units', 'target-summary', 'target-overall', 'target-unit-row']) source = source.replaceAll(hook + ' ', '');
    expect(hash(source)).toBe('c4fd22b7eb3f00d310539dec6b78e8bc1c596bf44ee80c040b773e4cb691367b');
  });
  it('preserves read-only operations queries, loading/error/reload and all menu/list content', () => {
    let source = original('src/pages/OperationsSettings.tsx').replace('pm-design-v1 pm-settings-v1 pm-operation-settings-v1 ', '');
    for (const hook of ['settings-layout', 'settings-menu', 'settings-readonly', 'settings-lists', 'settings-list']) source = source.replaceAll(hook + ' ', '');
    expect(hash(source)).toBe('911b1130519f98d3db53a61a50e848a4b5405e1473c4aaace0b0ede81abf5c2b');
  });
  it('scopes every rule to settings and exposes mobile descriptions without truncation', () => {
    const css = readFileSync('src/settings-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{}]*\{/g, '');
    for (const [, selectors] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(/,(?![^()]*\))/)) expect(selector.trim()).toMatch(/^\.pm-design-v1\.pm-(settings|target-settings|operation-settings)-v1\b/);
    }
    expect(css).toContain('white-space: normal; overflow: visible; text-overflow: clip;');
    expect(css).toContain('visibility: visible; opacity: 1;');
  });
});
