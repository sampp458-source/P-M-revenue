import { normalizeVisualSystemD } from './visualSystemDTestNormalization';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
describe('Finance Design V1 contract boundary', () => {
  it('preserves all dashboard calculations, permission paths, queries and drawer handlers', () => {
    let source = normalizeVisualSystemD(readFileSync('src/pages/DashboardDB.tsx', 'utf8'))
      .replace('import "../design-system-v2.css";\n', '')
      .replace('import "../finance-design-v2.css";\n', '')
      .replace(' pm-design-v2 pm-finance-v2', '')
      .replace('import "../finance-design-v1.css";\n', '')
      .replace('pm-finance-v1 pm-dashboard-v1 ', '');
    const filter = source.split('\n').find(line => line.includes('{isAdmin && <DashboardPeriodFilters'))!;
    source = source.replace(filter + '\n', '').replace('    <section className="mb-10"', filter + '\n    <section className="mb-10"');
    const trend = source.split('\n').find(line => line.includes('<DailyRevenueTrend data='))!;
    const recent = source.split('\n').find(line => line.includes('<RecentSales rows='))!;
    source = source.replace(trend + '\n' + recent, recent + '\n' + trend);
    expect(hash(source)).toBe('e8142ba060d092c248291e73a7c02a26b4a960e7e6682d0be654b4c282f8df2f');
  });
  it('preserves report calculations, month semantics, chart data, rankings and refund history', () => {
    let source = normalizeVisualSystemD(readFileSync('src/pages/ReportsDB.tsx', 'utf8'))
      .replace('import "../design-system-v2.css";\n', '')
      .replace('import "../finance-design-v2.css";\n', '')
      .replace(' pm-design-v2 pm-finance-v2', '')
      .replace('import "../finance-design-v1.css";\n', '')
      .replace('return <section className="pm-finance-v1 pm-reports-v1">', 'return <>')
      .replace('  </section>;\n}', '  </>;\n}');
    for (const hook of ['finance-summary', 'finance-divisions', 'finance-methods', 'finance-metric', 'finance-chart', 'finance-list', 'finance-rank-row', 'finance-event-row']) source = source.replaceAll(hook + ' ', '');
    const summary = source.split('\n').find(line => line.includes('<Summary target='))!;
    const events = source.split('\n').find(line => line.includes('<EventList title='))!;
    source = source.replace(summary + '\n', '').replace(events, summary + '\n' + events);
    expect(hash(source)).toBe('69cce2dee45ece874cf155298ede1317c5c8a6d07fec513274ddeba9d15611dc');
  });
  it('keeps styles local to the two finance screens', () => {
    const css = readFileSync('src/finance-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{}]*\{/g, '');
    for (const [, selectors] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(/,(?![^()]*\))/)) expect(selector.trim()).toMatch(/^\.pm-(finance|dashboard|reports)-v1\b/);
    }
    expect(css).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
  });
});
