// Existing server calls, payloads and confirmation flows remain frozen during the directory redesign.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
export function expectStaffManagementBoundary() {
 const s = readFileSync('src/pages/StaffManagement.tsx', 'utf8');
 const hash = (v: string) => createHash('sha256').update(v).digest('hex');
 expect(hash(s.slice(s.indexOf('  const load ='), s.indexOf('  return <section')))).toBe('dd243144feb507e24b94efe53117512d6c37d2801541bd6d9c1ee5b3f3dde56f');
 expect(hash(s.slice(s.indexOf('    <ConfirmModal')))).toBe('97a242e2b2896b10f4d2230239385808e167bb69a64f64f675d5df69c6ca41f9');
}
