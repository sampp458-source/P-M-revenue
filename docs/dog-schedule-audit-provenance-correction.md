# Schedule-dog audit provenance correction — local release review

Date: 2026-09-18. Production DDL/DML: zero. Commit/push/deploy: none.

## Contract and scope

`record_operation_schedule_audit_event()` originates in
`202607290001_operations_schedule_foundation.sql`. The current captured Production
body MD5 is `a5deae851384be64c4a6df9a193269a5`, owner postgres, SECURITY DEFINER,
search_path public, pg_temp. The INSERT/UPDATE trigger writes module operations,
entity_type operation_schedule_dogs, entity_id NEW.id, full before_data (UPDATE)
and after_data (INSERT/UPDATE). Actions are created, updated, archived, restored;
archive/null transitions determine the last two. Physical DELETE remains blocked.
The audit entity identifies a link; the preview business record identifies its
parent schedule. Direct UUID comparison was therefore incorrect.

The correction uses a private common helper for all schedule-dog consumers,
including general schedules, Daycare and hotel-generated schedules. Resolution
requires retained link and schedule, canonical UUIDs, exact link/schedule IDs in
every snapshot, known root dog identities, correct action/null transitions and
the queried dog's root identity. Current after-dog identity is accepted. One
historical reassignment hop is accepted only when a retained `updated` audit has
before_data exactly equal to the earlier after snapshot and after_data exactly
equal to the entire current link. No recursive ancestry inference is attempted.
Names, nested unrelated dog UUIDs and partial reassignment evidence are not proof.
Missing link, even with complete snapshots, stays fail-closed: normal physical
link deletion is prohibited and no exception is introduced here.

The old generic entity-ID fallback explicitly excludes schedule-dog audits.
The private helper has no PUBLIC/anon/authenticated/service_role EXECUTE. Existing
public RPC signature/security/ACL and business record counts are unchanged.
Only technical trace resolution is added; no audit or business row is rewritten.

## Migration order and identity

1. Existing applied V2-A `202609170001_dog_historical_identity_preview.sql`: unchanged.
2. NEW `202609170002_dog_schedule_audit_trace_resolution.sql`: READ helper + preview replacement only.
   SHA256 `2f974a2edfc8175143d2282727d1d9b5b8a2c15ba062e18059dc51b619f70554`.
3. UNDEPLOYED V2-B `202609180001_dog_profile_removal.sql`: dependency assertion and
   identical schedule-dog resolution call added. All other candidate bytes can be
   recovered unchanged by reversing only those two edits (old SHA 387b666f...).
   New SHA256 `a032ef99b40fea9b80ceee85eb41b59f33a5acb64b8187da438819254d4ead63`.

All 81 committed migrations remain byte-identical. The old V2-B approval hash must
not be used for a future deployment. Neither new migration was applied to Production.

## Production read-only check

`production_schedule_audit_recheck.sql` executes SELECT/CTE in READ ONLY and ends
ROLLBACK, with a 500 identity-evaluation limit and 15-second timeout. It returns
aggregate counts only; no names/customer data or business fixture is copied.

| Domain | Evaluations | Resolved | Unresolved | Completed resolved | Archived resolved |
|---|---:|---:|---:|---:|---:|
| General/hotel schedule | 433 | 433 | 0 | 241 | 18 |
| Daycare | 5 | 5 | 0 | 3 | 0 |

Production transaction_read_only=on. These are audit/dog evaluations, not unique
business-record counts. This proves normal observed shapes resolve, not that every
dog has no other blocker. Malformed/unknown shapes were tested synthetically; no
Production corrupt fixture was created. Local CTE/helper parity also passes.

## Isolated execution

The fresh current-catalog baseline matched 47 tables, 230 functions, 110 triggers,
464 constraints, 166 indexes and 65 policies before candidate application. Existing
real RPC domain scenarios passed both before and after correction + V2-B.
PG17.6 Production versus PG18.6 local, synthetic auth.users, and unused extensions
remain explicit environment boundaries; this is not Production latency validation.

Provenance cases PASS before and after V2-B: normal completed schedule, completed
Daycare, archive/restore, A-to-B full reassignment, multiple dog links, wrong dog,
wrong schedule, conflicting snapshots, missing/malformed entity ID, incomplete
snapshot, missing retained link and nested unrelated UUID. Business count remains
one for the completed schedule while its technical traces are retained.

Removal PASS: unused hard delete; completed sales; outstanding warning + removal;
completed schedule/Daycare; historical hotel; archived schedule link; completed
Long Stay. Successful removal checks audit bytes, technical FK counts and returned
removed identity. Hotel historical JSON and Long Stay returned dog name are retained.

Negative PASS: active hotel, future schedule, active Shared/family, current Long
Stay, journal draft, unknown structured trace. Real schedule/hotel/Shared/Long Stay
RPCs reject inactive and removed dogs (8 cases). Local lightweight V2-A sale-history,
V2-B permission and guard regressions also pass.

Real-RPC concurrency: 13 PASS, including both ordering directions, Shared second
member, and independent dog. Independent completions occur while the holder is
still inside its transaction. No observed deadlock. Removal takes request advisory,
dog exclusive try-lock, then dog row NOWAIT. Domain relation guards use sorted dog
IDs with shared try-lock + row KEY SHARE NOWAIT; they reject rather than introduce
blocking reverse edges. This is bounded scenario evidence, not a universal proof
for all existing domain lock graphs.

Receipt failure injection rolls back both removal modes completely. Same-request
replay returns the same response; changed input rejects. Private receipt and anon
ACL checks pass. Failed scenario transactions leave zero schedules/receipts/removed
dogs in the seeded baseline. Dog PK lookup with 1,001 extra synthetic dogs uses
an Index Scan (one row); local execution observed 0.006ms. Do not interpret this as
end-to-end or Production latency assurance.

## Remaining blocker and coverage limitation

**Journal:** actual register-roster/draft/complete RPCs produce a normal
`entity_audit_events` row whose entity_type is `journal_days`. Its entity_id is a
day ID; the preview record key is a journal entry ID. For the completed target dog,
the business entry is ALLOW but this audit remains UNKNOWN, so removal is blocked.
Both `domain_removal.sql` and the independent Journal path fail this assertion.
No Journal resolver, audit or business data was altered to conceal it.

**Shared:** member checkouts in the exercised RPC path retain a current family
booking. `family_booking_ACTIVE_OPERATION` is therefore an expected blocker.
Family-member/occupancy-member audit traces also remain unresolved; those need
separate provenance review. The test now explicitly checks the current-family
blocker rather than falsely assuming checkout closed the whole booking. Post-removal
Shared/Journal preservation cannot be claimed. No terminal parent state was forged.

The schedule-dog correction is validated, but full V2-B release is NOT PASS.
Final release review and Production execution remain blocked pending scoped review
of the remaining Journal/Shared provenance and terminal-family coverage.

App regression: 159 files / 1,343 tests PASS. Targeted: 4 files / 24 tests PASS.
Lint/typecheck/build PASS (existing bundle-size warning). Existing migrations preserved;
no application source changes in this correction. See current-baseline README for
reproduction. Runner returns a failing exit code while independent suites retain
individual results; failures are never converted to expected PASS.

## Files changed in this correction

- `docs/dog-schedule-audit-provenance-correction.md`
- `supabase/migrations/202609170002_dog_schedule_audit_trace_resolution.sql`
- `supabase/migrations/202609180001_dog_profile_removal.sql`
- `supabase/tests/current_production_baseline/README.md`
- `supabase/tests/current_production_baseline/domain_removal.sql`
- `supabase/tests/current_production_baseline/domain_removal_independent.sql`
- `supabase/tests/current_production_baseline/lifecycle_negative.sql`
- `supabase/tests/current_production_baseline/performance.sql`
- `supabase/tests/current_production_baseline/production_schedule_audit_recheck.sql`
- `supabase/tests/current_production_baseline/real_rpc_concurrency.py`
- `supabase/tests/current_production_baseline/removal_matrix.sql`
- `supabase/tests/current_production_baseline/rollback_permission.sql`
- `supabase/tests/current_production_baseline/run_integration.py`
- `supabase/tests/current_production_baseline/sales_completed_removal.sql`
- `supabase/tests/current_production_baseline/schedule_audit_provenance.sql`
- `supabase/tests/current_production_baseline/seed.sql`
- `supabase/tests/dog_profile_v2b_local_qa.py`
