import { normalizeAuditPresentation } from './auditPresentationTestNormalization';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
const baseline = {"src/App.tsx": "ed566e3edfa3e5c7ebef337fc766d0e1444bec404f4b7907de5737885c61de4a", "src/pages/StaffManagement.tsx": "151b0204749d921933465473130427da5a3ba3adab942ecd72e7b2612bc3e844", "src/pages/SettingsDB.tsx": "dfb3978148f37456ea2d1fd84a889e9c3715e72c3b1fbef8b41898cd96d4bd39", "src/pages/OperationsSettings.tsx": "2ee3a7b5752346085fbada265c0cd252eb402aff35ce6213e6f970c7e031e8e9", "src/pages/SignupPage.tsx": "7901ba0bbc514422080a342258f15dba10f1f15127131c4a25b7dbab1e578527", "src/pages/AccountRecoveryPages.tsx": "ce870aae132d38bbe4c7a34311903ae8c9d13121fd07fa041d9b5b365862f27d"};
describe('Admin Settings Access V2 boundaries',()=>{
 for(const [file,hash] of Object.entries(baseline)) it(file+' preserves every nonvisual byte',()=>{
 const clean=normalizeAuditPresentation(readFileSync(file,'utf8')).replace(/import ["'].*(?:admin|settings|access)-design-v2\.css["'];\n/g,'').replace(/ pm-(?:admin|settings|access)-v2/g,'').replace(' data-unit-name={name}','');
 expect(createHash('sha256').update(clean).digest('hex')).toBe(hash);
 });
 for(const family of ['admin','settings','access']) it(family+' CSS is opt-in only',()=>{
 const css=readFileSync('src/'+family+'-design-v2.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/@media[^{}]*\{/g,'');
 for(const [,selectors] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
 for(const selector of selectors.split(/,(?![^()]*\))/)) expect(selector.trim()).toMatch(/^\.pm-(?:design-v1|access-v1).*\.pm-(?:admin|settings|access)-v2/);
 }
 });
});
