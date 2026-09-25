import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeVisualSystemD } from './visualSystemDTestNormalization';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const originals = {
  "src/pages/OperationsCalendarFoundation.tsx": "b391a03b617ba2aae3c433a85845c60edc57f723d43f4e45b4a93c839dac6012",
  "src/pages/OperationsToday.tsx": "4c56cf2f63eef562863ff7c83e1bb266ac1c7a9d79a74b0d86336571e1244d6f",
  "src/pages/SalesHistoryDB.tsx": "ffc4bf3a20602efbec00898446741fbffc83aa91a94301baff6940af9d9b0520",
  "src/pages/DogManagement.tsx": "398bb62253da18f37595879e5a936242a5f8fb346b709ed85c9068cd57bb8831",
  "src/pages/DogProfileModal.tsx": "1ff560b08025319690bde1c89ad7614800635c58734fad97e1f6c9ce77231d33",
  "src/pages/ProductManagement.tsx": "59a04ac87b8b42ec8aab2b5dd1a8422a0b770f4ec7bf6be3bdfe666052b5d303",
  "src/pages/Management.tsx": "e6d1d60b131e173ef10006d2cd7ef85beb26ea34eb26d7ecf4ad0df48c14dcdc"
};
describe('D Rollout 2 preservation', () => {
for (const [file, hash] of Object.entries(originals)) it(file + ' preserves behavior byte-for-byte outside visual hooks', () => {
expect(sha(normalizeVisualSystemD(readFileSync(file,'utf8')))).toBe(hash);
});
it('freezes Foundation and Rollout 1 adoption material', () => {
expect(sha(readFileSync('src/visual-system-d.css','utf8'))).toBe('976c988622debfa6303ef967df89f7d29ad09308888416e7d2d29db5864e6455');
expect(sha(readFileSync('src/visual-system-d-adoption.css','utf8'))).toBe('5de1f8db0b5254cb2d71d65256723b0669630c8a7204c3c5e0d3aa628c968cb6');
 });
it('contains only target-scoped paint, never behavioral hiding', () => {
const css=readFileSync('src/visual-system-d-rollout2.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/@(?:layer|media)[^{}]*\{/g,'');
for(const [,selector] of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) expect(selector.trim()).toMatch(/^\.pm-(?:design-d\.pm-d-page\.pm-d-rollout2|d-shell-host:has\(\.pm-(?:design-d|d-rollout2)\) (?:(?:\.pm-d-modal )?\.pm-d-(?:dog-profile|calendar-detail|ledger-detail-summary)|\.pm-d-modal>div:first-child))/);
expect(css).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none/);
});
});
