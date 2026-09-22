import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';

describe('Core operations V2 scope and interaction boundary',()=>{
 for(const [scope,page] of [['calendar','OperationsCalendarFoundation'],['today','OperationsToday'],['ledger','SalesHistoryDB']]){
  it(`${scope} is explicitly opted in without hidden data or hit-test changes`,()=>{
   const source=readFileSync(`src/pages/${page}.tsx`,'utf8');
   expect(source).toContain(`pm-design-v2 pm-${scope}-v2`);
   const css=readFileSync(`src/${scope}-design-v2.css`,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/@media[^{}]*\{/g,'');
   for(const [,selectors,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    for(const selector of selectors.split(/,(?![^()]*\))/))expect(selector.trim()).toMatch(new RegExp(`^\\.pm-design-v1\\.pm-${scope}-v1\\.pm-${scope}-v2`));
    expect(body).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none|(?:^|;)\s*order\s*:|position\s*:\s*fixed/);
   }
  });
 }
 it('keeps mobile financial rows in a single ledger surface',()=>{
  const css=readFileSync('src/ledger-design-v2.css','utf8');
  expect(css).toMatch(/\.ledger-mobile-results>\.ledger-event\{[^}]*border-radius:0;box-shadow:none/);
 });
});
