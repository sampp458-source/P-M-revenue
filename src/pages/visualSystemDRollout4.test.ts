import { normalizeStaffDirectoryPresentation } from "./visualSystemDTestNormalization";
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const originals={"src/App.tsx": "f6637257e25d30cf6c688d9a655256ca9dfe0e43d6cf51cbea37ecdbd56d9218", "src/pages/StaffManagement.tsx": "cd32483bc0fcc316e7bb7547845bd477897b63cf204d920fa6e7dffc7ad6b7fa", "src/pages/SettingsDB.tsx": "7a33f93ee47b82295e35c75e6cefc272072b1bcd96a702f3a14ee2b784db2b38", "src/pages/OperationsSettings.tsx": "32ec887fa872f5a428dbadb5b44849811337c8027dda4a21eb7b376c1bea5240", "src/pages/SignupPage.tsx": "138ae7800c936fab66b741b8e67a659b34dd55fe40fe8cefaf6b81c29dccb7fe", "src/pages/AccountRecoveryPages.tsx": "aaefc6d84f3ad0eebb912676218a0c0ca0b8a5273954df3412d692204dff02a8"};
const frozen={"src/visual-system-d.css": "976c988622debfa6303ef967df89f7d29ad09308888416e7d2d29db5864e6455", "src/styles.css": "1e3bad387b032c06c70113fc36cd393417bba0116b1dd1772f006c4702cd6fd1", "src/visual-system-d-adoption.css": "9ab9e93b3a09e153476d96b23a63e73a5e90d492cb49844d4ae76de5ae0d7e51", "src/visual-system-d-rollout2.css": "1863d03c9d3f1fc931b88e2d699bebd22d68d4a16309c5d584b77885bd0a46cd", "src/visual-system-d-rollout3.css": "ee1876548cf378d7056ba46e62c11a49745035756a9bf1a32302da334c04da39", "src/pages/JournalReportTemplate.tsx": "e2114a8f27bb509cfcd04d35b6337bcca2c059edd32da12876040f69297de925"};
describe('Visual System D Rollout 4 scope and auth preservation',()=>{
for(const [file,sha] of Object.entries(originals))it(file+' preserves every handler, permission, route and auth statement',()=>{
const s=normalizeStaffDirectoryPresentation(readFileSync(file,'utf8')).replace(/import "\.\.?\/visual-system-d-rollout4\.css";\n/g,'').replaceAll(' pm-design-d pm-d-page pm-d-rollout4','');
expect(hash(s)).toBe(sha);
});
it('freezes Foundation, global styles, prior mappings and Journal template',()=>{for(const [file,sha]of Object.entries(frozen))expect(hash(readFileSync(file,'utf8')),file).toBe(sha)});
it('limits all selectors to target opt-in and never hides controls',()=>{
const css=readFileSync('src/visual-system-d-rollout4.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/@layer[^{}]*\{/g,'');
for(const [,selector] of css.matchAll(/([^{}]+)\{[^{}]*\}/g))expect(selector.trim()).toMatch(/^\.pm-design-d\.(?:pm-d-page\.)?pm-d-rollout4/);
const controlsCss=css.replace(/\.pm-design-d\.pm-d-rollout4\.pm-staff-v1 \.data-table colgroup\s*\{display:none!important;\}/g,'');
expect(controlsCss).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none/);
});
it('keeps four grouped headers and the six direct action identities',()=>{
const source=readFileSync('src/pages/StaffManagement.tsx','utf8');
expect(source).toContain('<th colSpan={3} scope="colgroup">직원</th>');
expect(source).toContain('<th colSpan={2} scope="colgroup">접근 권한</th>');
expect(source).toContain('<th colSpan={4} scope="colgroup">상태 · 이력</th>');
for(const [action,label] of Object.entries({role:'운영 권한',color:'캘린더 색상',approve:'승인',reject:'거절',deactivate:'퇴사 처리',restore:'계정 복구'})) {
const line=source.split('\n').find(line=>line.includes(`data-staff-action="${action}"`));
expect(line).toContain(`>${label}</Button>`);
expect(line).toContain('onClick=');
}
});

});
