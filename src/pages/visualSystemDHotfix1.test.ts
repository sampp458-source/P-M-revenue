import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { normalizePersistentDShell } from './visualSystemDTestNormalization';
const read = (path: string) => readFileSync(path, 'utf8');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
describe('D hotfix 1 presentation contract', () => {
  it('keeps shell opt-in present while Outlet is loading without opting the report subtree in', () => {
    const source = read('src/App.tsx');
    expect(source.match(/app-sidebar pm-d-sidebar pm-design-d fixed/g)).toHaveLength(3);
    expect(source).not.toContain('pm-d-shell-host pm-design-d');
    expect(hash(normalizePersistentDShell(source))).toBe('75afd14df270e464e159e2254e274048ad9f0715e84fce9cf22ab73fe5249729');
  });
  it('freezes Foundation and Journal export source', () => {
    expect(hash(read('src/visual-system-d.css'))).toBe('976c988622debfa6303ef967df89f7d29ad09308888416e7d2d29db5864e6455');
    expect(hash(read('src/pages/JournalReportTemplate.tsx'))).toBe('e2114a8f27bb509cfcd04d35b6337bcca2c059edd32da12876040f69297de925');
    expect(read('src/visual-system-d-rollout3.css')).not.toMatch(/journal-report|journal-editor-preview|\[data-journal/);
  });
  it('keeps spatial room order and adaptive widths only at the safe desktop breakpoint', () => {
    const css=read('src/visual-system-d-adoption.css');
    expect(css).toContain('@media(min-width:1280px)');
    expect(css).toContain('[data-room-group=DELUXE]>.hotel-room-plate-layout {grid-template-columns:repeat(6,minmax(0,1fr))');
    expect(css).toContain('[data-room-group=STANDARD]>.hotel-room-plate-layout {grid-template-columns:repeat(5,minmax(0,1fr))');
    expect(css).toContain('grid-column:auto!important;order:0!important;');
    expect(css).toContain('.hotel-room-plate-layout::after {content:none!important;}');
  });
  it('does not disable animation or change drag/drop feedback globally', () => {
    const css=read('src/visual-system-d-adoption.css');
    expect(css).not.toMatch(/transition\s*:\s*none|animation\s*:\s*none/);
    for(const phase of ['check_in','check_out','in_house']) {
      expect(css).toContain(`.hotel-room-cell[data-room-phase=${phase}]`);
    }
    expect(css).toContain('background:var(--pm-d-brand-cobalt-soft)!important;border-color:var(--pm-d-border-selected)!important');
    expect(css).toContain('background:var(--pm-d-semantic-mint-soft)!important');
    expect(css).toContain('background:var(--pm-d-semantic-coral-soft)!important');
  });
});
