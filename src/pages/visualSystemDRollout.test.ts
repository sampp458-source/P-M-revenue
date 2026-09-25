import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeVisualSystemD } from './visualSystemDTestNormalization';
// HotelRoomBoard baseline includes the cutover physical-occupancy and legacy checkout-access changes;
// behavioral invariants live in hotelPhysicalOccupancy.test.ts. Other screens remain frozen.
const originalHashes = {
  "src/pages/CustomerProfileModal.tsx": "7ee747aa1e001e6d19d2a881a440ff4e36ee0347230b37a8a4b4dfbaafeeb37c",
  "src/App.tsx": "0119b2f35e63de3199ea2edc4abf8fa689025c9b82bfeb2554680d2060e08923",
  "src/components/ui.tsx": "277832d0aa1f5a515863c50fcc9faeed9ad03c454a35631ad3c257abcbbec686",
  "src/pages/CustomerManagement.tsx": "e9e00cac2485547c556329504c0de5a4ad3b4146f16cdae36aa0038adf7f896a",
  "src/pages/DashboardDB.tsx": "ceb8be51c2d57c8dabe9a6d0ea46f2a176b23219126dcb24055bd67647f392c2",
  "src/pages/HotelHistoricalRoomGrid.tsx": "1319e5ba934d2e36a8116517505c53ca0df5606ab994dff4758e5d6fb59c5a96",
  "src/pages/HotelOperations.tsx": "c1f791b1eee781bfe78ae87f9e7e3ec0f64479f4cbe011dfe6bffaa7fa9a0fc4",
  "src/pages/HotelOperationsWorkspace.tsx": "62876b46fc4021a1d3c34a6fece777ee42a9469e0b75af979b56a37426ee1cbd",
  "src/pages/HotelRoomBoard.tsx": "0de6d8370e36c3f4339a5b10e57607693188f17f8b71e8940548227bc280ddb2",
  "src/pages/HotelRoomBoardPresentation.tsx": "e63f5c43f536a98cb730b389d8809d99cf3db4b2ae3d8d7195b2ae27c85a34e1",
  "src/pages/SaleRegistration.tsx": "353491d3f22b8c021fe6369f7e245faa619edf11074b7efa102331234e38b3a4",
  "src/pages/dashboard/DashboardAccountingDrawer.tsx": "4e2c767834f022780034a421688b70825a8650b1a5f24c49ed0bc5250edd4924",
  "src/pages/dashboard/DashboardDateDrawer.tsx": "9928bcb4a192b9dae0e59aaaaa426165979cefc9d2ec8130f0b7330cf0c633f3",
  "src/pages/dashboard/DashboardRangeSections.tsx": "800b8c0d9903497d4c2a3939a7f5ed7a0acbde7bb3401ef41663fde118f03c4f",
  "src/pages/dashboard/DashboardSections.tsx": "aa5427375d51a0327be248f12fdc6d25459e848f1b9a89cf8ca85f496f1e0cfb",
  "src/pages/dashboard/OutstandingPaymentsDrawer.tsx": "f81a176ad6508dca91e7cdf9b40b2c2f6fd470495afca8c3179ce09b5970cc52"
};
describe('Visual System D Rollout 1 boundary', () => {
for (const [file, hash] of Object.entries(originalHashes)) it(file + ' preserves every byte apart from explicit visual classes', () => {
expect(createHash('sha256').update(normalizeVisualSystemD(readFileSync(file, 'utf8'))).digest('hex')).toBe(hash);
});
it('retains the four Rollout 1 target roots', () => {
for (const file of ['HotelOperations','DashboardDB','CustomerManagement','SaleRegistration']) expect(readFileSync('src/pages/'+file+'.tsx','utf8')).toContain('pm-design-d pm-d-page');
expect(readFileSync('src/App.tsx','utf8').split('function LoginPage()')[1].split('function ModuleGatePage()')[0]).not.toContain('pm-design-d');
});
it('limits every adoption rule to an opted-in page or its shell', () => {
const css = readFileSync('src/visual-system-d-adoption.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/@(?:layer|media)[^{}]*\{/g,'');
for (const [, selector] of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) expect(selector.trim()).toMatch(/^\.pm-(?:design-d\.pm-d-page|d-shell-host)/);
expect(css).not.toMatch(/display\s*:\s*none|pointer-events\s*:\s*none|visibility\s*:\s*hidden/);
});
});
