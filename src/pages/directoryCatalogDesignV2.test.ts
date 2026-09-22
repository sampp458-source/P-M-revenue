import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
describe('Directory and catalog V2 presentation boundary',()=>{
 it('CustomerManagement.tsx preserves all existing content and behavior',()=>{
 const s=readFileSync('src/pages/CustomerManagement.tsx','utf8').replace(/import "\.\.\/(?:design-system-v2|directory-design-v2|catalog-design-v2)\.css";\n/g,'').replace(/ pm-design-v2 pm-(?:directory|catalog)-v2/g,'');
 expect(createHash('sha256').update(s).digest('hex')).toBe('e507e79f63556d0b4b20b9d3019491a7f2485f4bde92793c6cae15c0bf36dde7');
 });
 it('DogManagement.tsx preserves all existing content and behavior',()=>{
 const s=readFileSync('src/pages/DogManagement.tsx','utf8').replace(/import "\.\.\/(?:design-system-v2|directory-design-v2|catalog-design-v2)\.css";\n/g,'').replace(/ pm-design-v2 pm-(?:directory|catalog)-v2/g,'');
 expect(createHash('sha256').update(s).digest('hex')).toBe('388369d453bb5f8597e20424744f3497b63ae83087937d51324213b610e0c595');
 });
 it('ProductManagement.tsx preserves all existing content and behavior',()=>{
 const s=readFileSync('src/pages/ProductManagement.tsx','utf8').replace(/import "\.\.\/(?:design-system-v2|directory-design-v2|catalog-design-v2)\.css";\n/g,'').replace(/ pm-design-v2 pm-(?:directory|catalog)-v2/g,'');
 expect(createHash('sha256').update(s).digest('hex')).toBe('f98467e75bd18bf8547642bf305911df22cbf62894885e2d06a623d98d9a2f39');
 });
 it('Management.tsx preserves all existing content and behavior',()=>{
 const s=readFileSync('src/pages/Management.tsx','utf8').replace(/import "\.\.\/(?:design-system-v2|directory-design-v2|catalog-design-v2)\.css";\n/g,'').replace(/ pm-design-v2 pm-(?:directory|catalog)-v2/g,'');
 expect(createHash('sha256').update(s).digest('hex')).toBe('5e8a2ef0b95cd6befa9d64ee43e9372892f5a91b5c277a50433b7799dc26d240');
 });
 for(const scope of ['directory','catalog'])it(`${scope} CSS cannot leak or hide content`,()=>{
 const css=readFileSync(`src/${scope}-design-v2.css`,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/@media[^{}]*\{/g,'');
 for(const [,selector,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
 for(const part of selector.split(/,(?![^()]*\))/))expect(part.trim()).toMatch(new RegExp(`^\\.pm-design-v1\\.pm-${scope}-v2`));
 expect(body).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none|(?:^|;)\s*order\s*:/);
 }
 });
});
