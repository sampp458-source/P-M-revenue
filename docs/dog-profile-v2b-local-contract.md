# V2-B concurrency and DB integration review

Status: dog-scoped concurrency correction PASS on isolated graph fixture; complete domain RPC integration BLOCKED. Production execution prohibited. No application/UI change in this review.

## Exact cause and correction

Before: every graph statement took shared advisory `(180001,2)` while removal took the same key exclusively. Even an unrelated dog was rejected with DOG_BUSY. This fixed global key and statement trigger are removed.

After: removal exclusively try-locks `hashtextextended('dog-profile-v2b:' || dog_uuid,0)`; related writes shared try-lock only their resolved dog UUIDs. Dog IDs are distinct and UUID-sorted for each relation/aggregate row. Existing domain command lock acquisition is unchanged. Multi-row commands may acquire their rows in domain order; the new lock acquisitions never wait, so no claim is made that arbitrary existing multi-statement commands have globally sorted locks. Same request UUID remains intentionally serialized regardless of dog, per idempotency contract.

## Lock inventory

| LOCK_SOURCE | LOCK_TYPE / LOCK_KEY | LOCK_ORDER | AFFECTED_DOMAIN | WAIT/NOWAIT | FAILURE_CODE |
|---|---|---|---|---|---|
| remove_dog_profile request | exclusive advisory / hash of dog-removal-request + request UUID | 1, before receipt replay | same request only | WAIT | existing request conflict after replay check |
| removal lifecycle | exclusive advisory / hash of dog-profile-v2b + dog UUID | 2, after replay | target dog only | TRY | DOG_BUSY / 55P03 |
| removal dog row | FOR UPDATE / dogs.id | 3, after advisory | target dog only | NOWAIT | DOG_BUSY / 55P03 |
| preview | ordinary MVCC reads, no explicit advisory/row lock | none | reference graph | no write lock | fail-closed eligibility |
| dogs metadata guard | no explicit lock; ordinary DML row lock plus row relation guard | existing DML -> shared dog advisory -> KEY SHARE | changed dog | new locks TRY/NOWAIT; original DML retains normal semantics | DOG_BUSY / INVALID_PROFILE_STATE |
| sales | shared dog advisory -> KEY SHARE | existing domain locks -> new row guard | old/new dog association | TRY/NOWAIT | DOG_BUSY / INVALID_PROFILE_STATE |
| schedules/daycare | same | existing schedule/state/capacity locks -> guard | linked dog set or explicit payload | TRY/NOWAIT | same |
| hotel / 016 / 016B | same | existing request -> stay/capacity -> room locks -> writes/guard | stay dog through FK parent | TRY/NOWAIT | same |
| family/Shared | same | existing booking/group/member/occupancy locks -> guard | related member UUID set | TRY/NOWAIT | same |
| Long Stay | same | existing contract/stay/capacity/absence locks -> guard | contract dog | TRY/NOWAIT | same |
| journal | same | existing request/entry locks -> guard | entry dog/best friend; day aggregate members when changing day | TRY/NOWAIT | same |
| audit/request/history/receipt graph evidence | same | evidence row guard | structured IDs and known evidence joins | TRY/NOWAIT | DOG_BUSY |
| reversal/reactivation | same | existing domain reversal locks -> guard | affected dogs; active state rechecked | TRY/NOWAIT | same |

Legacy examples remain unchanged: hotel-request and hotel-room namespaces in 016/016B; Shared capacity:all -> capacity:type -> room after existing row locks; Long Stay contract -> stay -> capacity/allocation; journal request -> entry; daycare request/state -> schedule -> capacity/allocation. This is source evidence, not a substitute for end-to-end execution.

The relation resolver follows only graph-table UUID FK parents, with typed UUID equality (PK index usable). It does not scan all dogs to discover JSON identities. JSON extraction walks the payload once. Aggregate reverse edges apply to the affected aggregate/trace, not every parent of a newly inserted child: adding a journal entry does not lock every dog on that journal day. Known non-FK preview edges (entity audits, check-in receipts, shared requests, Long Stay audits, sale history, daycare state) are resolved explicitly. A terminal-to-terminal status change is not treated as reactivation; Finance status/payment follow-up with unchanged dog association remains allowed.

The graph inventory includes dogs, sales, schedules/links, stays/capacity/allocations, family bookings/members/groups, shared occupancy/members, Long Stay contracts/absence/months, journal days/entries/best-friend targets, daycare states, and JSON audit/request/receipt/history tables. Own success receipt is excluded. New direct dog FK invalidates preview; missing inventory row guard invalidates command.

## Actual parallel execution

`supabase/tests/dog_profile_v2b_local_qa.py` creates a disposable Unix-socket-only PostgreSQL cluster. Every concurrency case clones a fresh baseline; the holder and contender use independent processes/connections. Positive outcomes COMMIT in both connections; negative contenders roll back and the winner commits. All clusters stop afterward.

| Matrix | Actual result |
|---|---|
| A/C/E/G: same dog, schedule/hotel/sales/journal | DOG_BUSY; winning removal commits |
| reverse schedule/hotel/sales/journal ordering | DOG_BUSY; winning relation commits |
| B/D/F/H: different dogs | BOTH_COMMITTED |
| I: same dog, different removal requests | DOG_BUSY; one removal commits |
| I: same request | waits for first COMMIT, then replays one success receipt after dog is gone |
| J: different dog removals | BOTH_COMMITTED |
| K: A/B payload vs A removal | safe rejection |
| L: B/C payload vs A removal | BOTH_COMMITTED |

No deadlock observed in this matrix. This is a graph/trigger test, not the execution of the complete Hotel/Shared/Long Stay command suite.

## Synthetic integration, permissions, rollback

New guard integration test covers active relation writes; inactive/removed new schedule, hotel, sales, journal, family, Long Stay and Shared references; terminal record upkeep; completed -> active reactivation rejection; ordinary active-staff dog create/edit; all lifecycle fields denied to direct mutation. Removed financial refund/outstanding follow-up remains allowed. A simulated multi-statement command's first insert rolls back when its later relation guard fails. Receipt-trigger failure rolls back hard deletion and profile removal, including metadata. Historical identity remains readable.

## Full migration-chain blocker — not waived

The current repository alone lacks historical `202608020001_hotel_operations_foundation.sql`. A prior local checkout provides that file and the 020003/020004 dependencies. The strict replay probe records each supplemental file SHA and applies original bytes. It then stops BEFORE V2-B at current repository `202608040003_hotel_update_lock_order_repair.sql`:

- `STOP_UPDATE_HOTEL_RESERVATION_UNEXPECTED_VERSION`
- expected body MD5: `11bfba2f2cf38dc814908bff25e38f8f`
- actual reconstructed predecessor MD5: `f67ecacd1af8a3c62081726011c2e73f`

The flexible migration explicitly requires the repair first, despite their filename order. Neither assertion, old function, nor old migration was edited. This local chain gap is not evidence of Production drift. Full Hotel flexible/unknown type/actual check-in/016B/reversal, Shared DELUXE/member lifecycle, and Long Stay outing/return integration remain NOT_EXECUTED on an authoritative complete schema. Synthetic guard tests and application regressions cannot close this gap.

Reproduction: `python3 supabase/tests/dog_profile_v2b_full_chain_probe.py PG_BIN LEGACY_MIGRATIONS_DIR`. Exit 2 is intentional on baseline mismatch. The minimum next evidence is an independently verified complete local schema/dependency baseline that passes those original prerequisites; do not patch hashes just to make replay pass.

## Performance and regression

Local 100 resolver calls: 27.00ms before and 26.80ms after adding 1,000 unrelated dogs, including psql startup. Dog status lookup EXPLAIN ANALYZE used PK Index Scan. This bounded synthetic probe is not Production latency certification; work still scales with the related aggregate/payload size.

Targeted 5 files / 28 tests; full 159 files / 1,343 tests; lint/typecheck/build PASS. Build has the existing large-chunk advisory. Existing 81 migrations remain byte-identical; only the unapplied V2-B migration is revised. No source/UI changes beyond this concurrency/test/doc scope in this review. Original ordinary metadata initialization still maps inactive to inactive; updated_at can advance for those initialization rows through the existing trigger.

Final release review: NO until full domain DB integration closes. Production execution: NO. Production mutation/commit/push/deploy: 0 / NO / NO / NO.

## Accumulated V2-B manifest

- `docs/dog-profile-v2b-local-contract.md`
- `src/lib/dogMasterEditingMigration.test.ts`
- `src/pages/DogDeleteModal.test.tsx`
- `src/pages/DogDeleteModal.tsx`
- `src/pages/DogManagement.tsx`
- `src/pages/DogManagementDeletion.test.tsx`
- `src/pages/DogProfileModal.tsx`
- `src/pages/DogRemovedProfile.test.tsx`
- `src/pages/OperationsCalendarFoundation.tsx`
- `src/pages/OperationsToday.tsx`
- `src/pages/dogDeletionRepository.ts`
- `src/pages/dogHistoricalIdentityRepository.test.ts`
- `src/pages/dogHistoricalIdentityRepository.ts`
- `src/pages/operationsScheduleRepository.ts`
- `supabase/migrations/202609180001_dog_profile_removal.sql`
- `supabase/tests/dog_profile_v2b_fixture_extensions.sql`
- `supabase/tests/dog_profile_v2b_full_chain_probe.py`
- `supabase/tests/dog_profile_v2b_guard_integration.sql`
- `supabase/tests/dog_profile_v2b_local_qa.py`
- `supabase/tests/dog_profile_v2b_rollback.sql`
- `supabase/tests/dog_profile_v2b_write.sql`

Migration SHA256: `387b666f4d853fc3ea99962be56fe595ea444bdd0cab09ea26d9a447411cefe0`.
