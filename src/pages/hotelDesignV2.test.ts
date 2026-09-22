import {readFileSync,readdirSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const foundation=readFileSync('src/design-system-v2.css','utf8');
const hotel=readFileSync('src/hotel-design-v2.css','utf8');
describe('Hotel V2 opt-in and interaction boundary',()=>{
 it('opts in only Hotel, leaving other pages on their approved design',()=>{
  const adopters=readdirSync('src/pages').filter(p=>p.endsWith('.tsx')&&!p.endsWith('.test.tsx')).filter(p=>readFileSync(`src/pages/${p}`,'utf8').includes('pm-hotel-v2'));
  expect(adopters).toEqual(['HotelOperations.tsx']);
  expect(foundation).not.toContain(':root {');
  for(const css of [foundation,hotel]){
   const clean=css.replace(/\/\*[\s\S]*?\*\//g,'').replace(/@(?:media|layer)[^{}]+\{/g,'');
   for(const [,selector] of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) expect(selector.trim()).toMatch(/^(\.pm-design|\.bg-app-background:has\(> \.app-sidebar\):has\(\.pm-hotel-v2\))/);
  }
 });
 it('does not override motion transforms, pane visibility or event hit testing',()=>{
  expect(hotel).not.toMatch(/(?:^|[;{])\s*(?:transform|translate|animation|transition|pointer-events|visibility|opacity|order)\s*:/);
  expect(hotel).not.toMatch(/data-view|\[hidden\]/);
  expect(foundation).toContain('prefers-reduced-motion:reduce');
 });
 it('preserves authoritative blocked, dragging, selected and settling room visuals',()=>{
  const clean=hotel.replace(/\/\*[\s\S]*?\*\//g,'').replace(/@(?:media|layer)[^{}]+\{/g,'');
  const rules=[...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,s,d])=>s.includes('.hotel-room-cell')&&!s.includes('.hotel-shared-member')&&!s.includes('.hotel-room-card-settle')&&/(?:background|box-shadow|border):/.test(d));
  expect(rules.length).toBeGreaterThan(0);
  for(const [,s] of rules)expect(s).toContain(':not(.border-dashed,.border-2,[class*="ring-"],.hotel-room-drop-settle,.opacity-55)');
 });
});
