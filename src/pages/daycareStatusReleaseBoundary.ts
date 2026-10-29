// Test-only exact reviewed delta: keep all unrelated source bytes under old guards.
import {readFileSync} from 'node:fs';
const reviewed=JSON.parse(readFileSync('src/pages/__fixtures__/daycareStatusReleaseBoundary.json','utf8')) as Record<string,Array<{before:string;after:string}>>;
export function restoreReviewedDaycareStatusDelta(file:string,source:string){
 for(const delta of reviewed[file.split('/').at(-1)!]??[])source=source.replace(delta.after,delta.before);
 return source;
}
