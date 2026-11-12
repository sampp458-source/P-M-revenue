// Test-only: remove only exact reviewed messaging entry additions. All prior workflow hashes remain frozen.
import reviewed from './integrationBoundary.json';
export function normalizeGuardianMessageEntry(source:string):string {for(const line of new Set(reviewed.flatMap(r=>r.additions))){if(source.split(line).length>2)throw Error('DUPLICATE_MESSAGE_ENTRY');source=source.replace(line,'');}return source;}
