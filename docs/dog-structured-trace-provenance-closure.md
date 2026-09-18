# V2 structured trace provenance closure — 2026-09-18

## Scope and provenance rules

This is an append-only READ classifier correction, before the unshipped V2-B candidate.
No Production migration, business mutation, repair, commit, push, or deploy was performed.
Application source and all 81 committed migration files are unchanged in this task.

Journal audit entity IDs are day/entry IDs; the preview business key is an entry ID.
The day rule requires the exact retained day, its exact target-dog entry, the matching
business date and target membership in the typed roster request. Other roster members
may have subsequently lost their entries: that does not invalidate this target's retained
relation. Missing **target** entries still fail closed. Every request ID must have UUID shape.

Entry audit requires the exact retained entry/day/main-dog relation in every before/after
snapshot. Best-friend scalar and typed target-array identity are independently recognized;
arbitrary nested UUIDs do not establish provenance. Draft/completed lifecycle is evaluated
separately: draft remains blocked even when its audit is resolved. Missing parent,
wrong day/entry/dog, malformed/incomplete snapshots remain unresolved.

Additional independently proven paths:

- Family member audit → exact member → retained family and target dog.
- Physical occupancy member audit → exact member → retained occupancy/stay/family member,
  with consistent dog/stay IDs and both audit snapshots checked.
- Initial-payment edit request → retained sale, matching canonical and result sale IDs.
- Completed atomic reverse/unassign request → exact single stay or shared occupancy,
  matching request target and response identity.
- Sale **creation** snapshot → one exact full-row `updated.previous_data` hop →
  `updated.changed_data` equal to the complete retained sale. This closes one observed
  Production reassignment case. Partial snapshots, an unmatched intermediate state or
  changed retained end state are rejected. No recursive/unbounded history acceptance.

Known entity types are explicit; arbitrary entity types with coincident UUIDs are not accepted.
Private helpers deny direct PUBLIC/anon/authenticated/service_role EXECUTE.
No correction adds locks, table/trigger/policy changes, lifecycle WRITE, or business DML.

## Complete structured-source inventory

The Production catalog was re-read and matches these 11 JSON-bearing sources. The
installed discovery function additionally fails closed on future audit/request/receipt/history
sources; no blanket ignore list was introduced.

| Trace source/type | Entity ID means / business key | Parent-child path and dog location | Normal provenance | Status / risk |
|---|---|---|---|---|
| sale_history | history ID / sale ID | sale_id; previous_data/changed_data root dog_id | exact sale snapshot; direct reassignment or one full-snapshot creation hop | corrected; missing/mismatched evidence stays unknown |
| entity_audit_events: operation_schedule_dogs | link ID / schedule ID | retained link→schedule; root before/after dog_id | approved Schedule helper, exact snapshots/reassignment hop | preserved; 438 observed resolved |
| entity_audit_events: journal_days | day ID / entry ID | day→target entry; request.dogIds/businessDate | exact retained target relation, typed request | corrected; missing target entry unknown |
| entity_audit_events: journal_entries | entry ID / entry ID | retained entry→day; main dog, scalar/array friend | exact immutable parent/main identity; typed friend snapshot | corrected; deleted entry unknown |
| entity_audit_events: family_booking_members | member ID / family ID | member→family; root dog_id | typed module/action, both snapshot identities and parent linkage | corrected |
| entity_audit_events: hotel_physical_occupancy_members | member ID / occupancy ID | member→occupancy/stay/family member→dog | typed module/action, exact immutable IDs in snapshots | corrected |
| entity_audit_events: known parent types | stay/schedule/family/occupancy/contract ID | existing retained business relation; typed root audit | known business-key contract; unknown types fail closed | retained; 5 hotel target relations absent/nonmatching |
| daycare_operation_states | schedule ID / schedule ID | schedule dog link; canonical_payload/request_history | exact retained schedule link | preserved |
| family_bookings | family ID / family ID | retained member→dog; canonical_payload | exact retained family membership | preserved |
| hotel_atomic_reverse_unassign_requests | request ID / target stay or occupancy | request_payload / response_payload | completed, exact kind/target/request/response and retained relation | corrected; one single request observed |
| hotel_physical_occupancy_requests | request ID / occupancy ID | occupancy_id→member→dog; response | exact retained occupancy relation | preserved |
| hotel_planned_checkout_requests | request ID / stay ID | hotel_stay_id→dog; response | exact retained stay | preserved |
| hotel_single_check_in_receipts | request ID / stay ID | hotel_stay_id→dog; normalized_input/response | existing retained stay contract | preserved; no matching Production trace observed |
| hotel_missed_check_in_receipts | request ID / stay ID | hotel_stay_id→dog; normalized_input/response | existing retained stay contract | preserved |
| long_stay_operation_audit_events | audit ID / contract ID | long_stay_contract_id→dog; payload/before/after | exact retained contract | preserved |
| sale_initial_payment_edit_requests | request ID / sale ID | sale_id/canonical_payload.saleId/result.saleId | exact retained sale identity | corrected; no dog-bearing Production trace observed |

The V2-B-only removal receipt is not installed in Production; local command replay and
post-removal preview tests cover it. Replay is checked before current graph/state validation.

## Production READ ONLY sweep

Catalog-confirmed sources: 11. Dogs: 228. Source rows: 7,451.
15 independent READ ONLY transactions, offsets 0–7000, maximum 500 source rows each.
Every batch reported `readOnly=on`, stable population=7451, and mutation=0; each ends ROLLBACK.
Source population is stable across batches, but these are not a single global MVCC snapshot.
The final Sales rule was rechecked on the only affected batch (6500).

Initial monolithic diagnostics hit the SQL Editor upstream timeout; they are not PASS evidence.
The bounded version uses a UUID textual prefilter followed by the **installed exact structured
identity predicate**, not textual UUID occurrence as proof. It also includes retained-parent
trace edges. It evaluates inline SELECT equivalents without installing correction functions.
No raw business rows, names, phone numbers, or notes were exported.

| Source / entity type | Dog-traces | Resolved | Expected unresolved | Suspicious remaining |
|---|---:|---:|---:|---:|
| daycare_operation_states | 5 | 5 | 0 | 0 |
| audit / daycare_operation_states | 16 | 16 | 0 | 0 |
| audit / family_booking_members | 23 | 23 | 0 | 0 |
| audit / hotel_physical_occupancy_members | 8 | 8 | 0 | 0 |
| audit / hotel_stays | 358 | 353 | 5 | 0 |
| audit / journal_days | 396 | 300 | 96 | 0 |
| audit / journal_entries | 6,135 | 4,997 | 1,138 | 0 |
| audit / operation_schedule_dogs | 438 | 438 | 0 | 0 |
| audit / operation_schedules | 1,140 | 1,140 | 0 | 0 |
| audit / hotel_physical_occupancies | 4 | 4 | 0 | 0 |
| audit / family_bookings | 6 | 6 | 0 | 0 |
| family_bookings | 6 | 6 | 0 | 0 |
| hotel_atomic_reverse_unassign_requests | 1 | 1 | 0 | 0 |
| hotel_missed_check_in_receipts | 1 | 1 | 0 | 0 |
| hotel_physical_occupancy_requests | 20 | 20 | 0 | 0 |
| hotel_planned_checkout_requests | 33 | 33 | 0 | 0 |
| long_stay_operation_audit_events | 7 | 7 | 0 | 0 |
| sale_history | 263 | 263 | 0 | 0 |
| hotel_single_check_in_receipts | 0 | 0 | 0 | not observed |
| sale_initial_payment_edit_requests | 0 | 0 | 0 | not observed |
| **Total** | **8,860** | **7,621** | **1,239** | **0 observed** |

Expected unresolved means evidence cannot prove the exact retained target relationship;
it does **not** mean the historical row is corrupt or should be repaired. Journal entry
parents are missing (including normal legacy physical-delete audits); Journal day target
entries are missing; hotel target stay relationships are missing/nonmatching. These remain
removal blockers. No deleted-parent history was broadly exempted.

## Apply order and integrity

1. Captured current Production catalog (read only), SHA256:
   `3b43373b06e7e636a7fb48e839a2fcea189973d5e1d92a9eb1494484f835400b`.
2. `202609170002_dog_schedule_audit_trace_resolution.sql`:
   `2f974a2edfc8175143d2282727d1d9b5b8a2c15ba062e18059dc51b619f70554` (unchanged).
3. `202609170003_dog_structured_trace_provenance_closure.sql`:
   `82b59056773d9d0209f76ff112365e9cdfdb880d693d4bc95afde278628777f2`.
4. `202609180001_dog_profile_removal.sql`:
   `1a7f59a449ed4cd12e57bc3c1ee57a637c1b5df408afffe23014956fe8b3451b`.

The final correction precedes V2-B deliberately. The candidate now requires both new helpers.
Only its READ classifier/dependency blocks changed in this task; its write/lock/receipt/
version/permission logic is unchanged. All 81 committed migrations remain byte-identical.

## Local validation and explicit fixture boundaries

Current-baseline reconstruction compares all captured catalog categories before candidate
application. Production PostgreSQL 17.6 vs local 18.6, synthetic auth.users boundary, and
excluded non-domain vault/stat extensions remain documented limitations.

- Real Journal roster/draft/complete RPCs plus adversarial values cover all 10 requested
  cases; also missing-other-roster-member vs missing-target distinction and helper ACL.
- Shared children reach terminal states through real RPCs. The family parent is explicitly
  made terminal **only in a local synthetic fixture**, after asserting all children terminal.
  A still-current family remains blocked. Shared historical result and original audits/FKs
  survive removal. No claim that member checkout itself closes the family parent.
- Sales initial-payment edit and atomic reverse/unassign use real RPCs and actual receipts.
  Full-row reassignment fixture uses real sales audit triggers; UTC fixture matches the
  exact snapshot representation used by the preview. Other timestamp representations are
  not normalized or broadly accepted. Broken hop/end snapshot remains fail closed.
- Final removal matrix: unused→hard delete; completed sales, outstanding sales (warning),
  completed schedule/daycare/journal, historical hotel, terminal Shared, completed Long Stay,
  archived link→profile remove. Active hotel, future schedule, active Shared/Long Stay,
  Journal draft, current family→block. Unknown trace→fail-closed block.
- Original identity rows, FKs, amounts/times/status, historical names and prior audit contents
  are retained in successful profile removal scenarios.
- Real RPC concurrency: 13 cases; same-dog safe conflict, different-dog independence,
  multi-dog scope. No observed deadlock; static write/lock paths unchanged.
- Receipt-failure rollback, replay/idempotency and permission negatives are included.
- App targeted: 9 files / 81 tests. Full app regression: 159 files / 1,343 tests.
  Lint/typecheck/build PASS; build retains the existing large-chunk warning.

Production apply is still NO: these candidate hashes require the final release review and
fresh Production preflight. No automatic Production execution is authorized by local PASS.
