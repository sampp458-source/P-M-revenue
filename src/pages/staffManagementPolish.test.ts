import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const css = readFileSync(new URL('./staff-management.css', import.meta.url), 'utf8');
it('bounds capability rows and keeps accessible touch targets', () => {
 expect(css).toContain('.staff-cap-section{max-width:640px}');
 expect(css).toContain('max-width:520px;display:grid;grid-template-columns:minmax(0,1fr) 44px');
 expect(css).toMatch(/staff-cap-reload\{[^}]*width:44px;height:44px/);
});
it('keeps desktop selection but removes list-only mobile highlight and narrows desktop filter', () => {
 expect(css).toContain('@media(min-width:640px){.pm-staff-v1 .staff-filter{grid-template-columns:minmax(0,1fr) 200px}}');
 expect(css).toMatch(/@media\(max-width:639px\)\{\s*\.pm-design-d[^}]*:not\(\.staff-detail-open\)[^}]*background:transparent!important;border-color:transparent!important/);
 expect(css).toContain('background:#f5f7fb!important');
});
