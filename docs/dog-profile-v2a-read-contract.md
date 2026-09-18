# Dog Profile V2-A: read foundation

## Release boundary

Append-only migration `202609170001_dog_historical_identity_preview.sql` adds two public READ RPCs and two private read helpers. It does not add lifecycle columns, change policies/permissions on existing tables, replace any existing function, or implement a removal command. Apply only after separate Production approval. Deploy the migration before the dependent Calendar client. Missing/failed identity reads fail visibly, never fall back to active options and silently discard history.

- `get_historical_dog_identities(p_dog_ids uuid[]) -> jsonb`: distinct ID batch (maximum 5,000); active and inactive. Missing IDs are absent at SQL level; the client rejects an incomplete result rather than hiding references. Empty client batch performs no RPC. Metadata: `recordDogId`, `displayName`, `nameSource=dog_master`, `profileStatus`, `canonicalDogId=null`, `profileReadable`, customer/breed/sex. It is not a new-operation selector.
- `preview_dog_profile_removal(p_dog_id uuid) -> jsonb`: active staff only (`auth.uid`, `is_active_user`). `version=null`, `commandAvailable=false`, `fingerprintUsage=READ_ONLY_NOT_A_WRITE_TOKEN`. No UI deletion flow is changed in V2-A.
- Both public RPCs are STABLE / SECURITY DEFINER with fixed search_path. PUBLIC/anon have no EXECUTE. Private helpers have no authenticated EXECUTE. No service-role assumption.

## Counts, lifecycle and evidence

The nine direct dog FK edges are inventoried from pg_catalog, including archived rows. Unexpected FK inventory/delete action fails closed. `technicalReferenceCount` counts those edges, not capacities, allocations or receipts.

Business units: sale ID; schedule ID (daycare is a separate category rather than duplicated as schedule); stay ID; physical occupancy or pre-occupancy shared group; long-stay contract; journal entry; family booking. Journal primary/best-friend/target references are deduplicated into one entry. A hotel stay with multiple allocations remains one hotel record. Categories are facets, not an additive total of distinct visits: e.g. a family booking can also have a hotel stay. Structured audit/request evidence is not presented as additional customer visits (`userVisibleCount=0`, separate traceCount).

Uncompleted schedules/reservations remain blocking even if dates are in the past. Hotel check-in without checkout, requested/allocated Shared, active member, pending/active Long Stay (including outing), daycare scheduled/checked-in, journal not_started/in_progress, and family pending/current are blockers. Completed/cancelled history is not itself a removal blocker; archived schedule links remain hard-delete references but are not current participation. Outstanding sales warn rather than block removal. Unknown or conflicting states block.

Structured JSON evidence is inspected for explicit dog identity keys, including nested `dog.id`, `dogId`, `dog_id`, dog ID arrays and best-friend identity. Free-text names/memos are not identity matching. Master dog audits are nonblocking. Known operational audit, request, receipt and history tables are inspected, including new tables matching these purposes; a structured identity that cannot be tied back to a retained business record is `UNRESOLVED_STRUCTURED_IDENTITY`, never assumed completed. Historical trace classification does not prove a WRITE is safe: this preview is diagnostic only.

Domain dates are sale_date, schedule starts/ends, stay actual times/capacity intervals, occupancy intervals, contract dates, journal business_date, and linked family service intervals. Audit created_at / updated_at are not usage dates.

## Fingerprint

MD5 of a canonical JSONB object: contract version, entire retained dog row, FK inventory validity, business records sorted by category/key (including linked capacity/allocation/member/schedule/absence snapshots), and structured traces sorted by source/key/body. UTC is fixed for preview serialization. All arrays assembled from tables have explicit order; evaluatedAt is excluded. Metadata changes may conservatively invalidate the fingerprint. It is a deterministic read/debug fingerprint, not a cryptographic authorization token or V2-B concurrency token.

The structured evidence scan can read historical JSON tables. Production latency/EXPLAIN is a future read-only validation gate; isolated fixture timing is not a Production performance claim. No physical index changes are included here.

## Consumer audit

| Consumer | Existing identity source / V2-A action |
| --- | --- |
| Calendar month | `operationsScheduleRepository.fetchOperationSchedulesForRange`: replace active options map with one historical batch of linked dog IDs. Preserve schedule fields, sorting, archived-link filters and room projection. |
| Legacy hotel schedule candidates | Same historical adapter; preserve existing scheduled-status query and matching logic. |
| Operations Today | `get_operation_schedules_for_day` / `operation_schedule_json` already joins dogs by identity without is_active filtering. No change. |
| Sales history | `SalesHistoryDB` uses saved sale.dog_name. Keep snapshot; active options still used only for new choices. |
| Hotel current / Shared / Long Stay / Daycare | Existing domain RPC DTOs join retained dog identity; do not replace their lifecycle data or commands. |
| Hotel historical | Existing historical resolver joins dogs without active filtering. No resolver or projection change. |
| Journal | Roster entry JSON joins dogs by ID without active filtering; historical roster includes inactive entries. Best-friend display uses that roster, not the active registration directory. Active directory remains for new roster registration. No change. A missing roster friend is a separate issue from inactive filtering and is not silently replaced here. |
| Customer profile | Current dog list intentionally active only; timeline uses `customerDogDirectory` which loads all dogs. Keep this distinction. |
| Dog profile | Directory includes inactive identity and existing inactive badge. No change. |
| Global/customer/dog search | Current operational search intentionally active only. No change. |

## Validation and preserved contracts

- Calendar client tests cover inactive names with no active options, batch deduplication, preserved schedule identity/date/status, read failure, no per-row request, and unchanged active selector filtering.
- SQL fixture covers A–L plus Shared, Long Stay absence, daycare, journal multi-edge deduplication, master-audit exemption, structured receipt blocking, private/anon/inactive/pending authorization, deterministic hash, UTC independence and unexpected FK failure.
- `supabase/tests/dog_profile_v2a_fixture.sql` is a reduced synthetic catalog, not a Production clone. It checks a dedicated database name and local Unix socket before setup. Never run it in Production. Create an isolated empty PostgreSQL cluster/database named `dog_v2a_fixture`, apply fixture then the new migration, then `dog_profile_v2a_read.sql` and `dog_profile_v2a_graph_changes.sql` with ON_ERROR_STOP. The read suite uses BEGIN READ ONLY / ROLLBACK. Graph-change tests mutate only synthetic setup and roll back.
- No existing migration, dog hard-delete repository/modal, dog UPDATE/DELETE policy, Hotel resolver, Finance calculation, Capacity, Shared/Long Stay command, or 016/016B implementation is edited.

V2-B implementation must establish locking/revalidation and new relation guards independently. V2-A eligibility is never accepted as write authorization.

## Production preflight correction (2026-09-17)

The retained Production `sale_history` contract is UUID PK, non-null UUID `sale_id` referencing sales (existing ON DELETE CASCADE), action, nullable previous_data/changed_data JSONB, changed_by profile FK and created_at. This migration does not modify that FK or execute any delete. `record_sale_history` records complete OLD/NEW sale rows after INSERT/UPDATE; dog/customer can change through existing sale editing. Root snapshot `id` and `dog_id` are identity evidence; free text and nested unrelated dog identities are not. There is no archive column. Cancellation/refund/reopen are history actions, not missing-parent exceptions.

Only `sale_history` gains resolution in this correction:
- Existing sale with the same dog: a previous/changed root snapshot must contain that exact sale ID and dog ID, with a recognized history action.
- Different current dog: an `updated` event must have exact previous sale/dog IDs and its **entire changed_data must equal the retained sale row**. This bounded direct transition proves the old identity without treating it as a current FK.
- Missing/null/malformed parent, unsupported action, partial/mismatched changed snapshot, nested unrelated identity, or longer unproven reassignment chain remains unresolved. No timestamp proximity or name matching. A valid longer historical chain is not newly supported by this minimal fix.
- Traces remain separate from business/FK counts and prevent hard deletion even when resolved. Outstanding sales still warn. No additional visits are fabricated for historical reassignment.

Production inventory and provenance review (all unproved cases remain fail closed; no new resolution beyond sale_history):

| Trace source | Canonical parent / parent field | Identity location | Existing resolution / orphan behavior |
| --- | --- | --- | --- |
| entity_audit_events | retained business record / entity_id | before_data, after_data | entity ID must match a classified record; master dog audits exempt; otherwise unresolved |
| family_bookings | own family booking / id | canonical_payload | retained dog membership in booking; otherwise unresolved |
| daycare_operation_states | schedule / operation_schedule_id | canonical_payload, request_history | retained dog schedule link; otherwise unresolved |
| hotel_physical_occupancy_requests | occupancy / occupancy_id | response | retained dog occupancy member; otherwise unresolved |
| long_stay_operation_audit_events | contract / long_stay_contract_id | canonical_payload, before_state, after_state | retained dog contract; otherwise unresolved |
| hotel_single_check_in_receipts | stay / hotel_stay_id | normalized_input, response | retained dog stay; otherwise unresolved |
| hotel_missed_check_in_receipts | stay / hotel_stay_id | normalized_input, response | retained dog stay; otherwise unresolved |
| hotel_planned_checkout_requests | stay / hotel_stay_id | response | retained dog stay; otherwise unresolved |
| hotel_atomic_reverse_unassign_requests | polymorphic single/shared / target_id + operation_kind | request_payload, response_payload | no new target_id resolution; unresolved unless existing explicit top-level relationship predicate proves it |
| sale_history | sale / sale_id | previous_data, changed_data | exact root snapshot rules above; otherwise unresolved |
| sale_initial_payment_edit_requests | sale / sale_id | canonical_payload, result | no newly proven payload rule; unresolved |

Private helper service_role EXECUTE is NOT_NEEDED. It came from Production default function ACL, not an explicit V2-A grant. Explicit revocation now includes service_role on all four new functions; only authenticated receives the two public RPC grants. Owner-internal SECURITY DEFINER calls still work. Existing ACLs/default privileges are not altered.

Performance scope: one materialized resolved-sales relation joins already collected traces to retained sales; there is no added sale_history scan or recursive JSON walk. A sales lookup/join is additional correctness cost. Existing full JSON discovery/repeated known-source scans remain optimization recommendations; no index redesign or Production latency claim.

Validation adds `dog_profile_v2a_sales.sql` (isolated transaction with ROLLBACK) for normal/two-sale counts, orphan/malformed/null parent, direct proven and unproven dog reassignment, unrelated nested identity, cancelled/refunded statuses, outstanding warning, fingerprint and private service_role denial. Fixture sale_id is intentionally text without FK to model malformed/orphan negative cases that valid Production catalog prevents. Production SELECT-only recheck: sales-only 2 sales / 2 matched traces / 2 resolved / 0 unresolved; multidomain 1 / 1 / 1 / 0. Other three representative shapes had zero sales traces. These are scoped classifier checks, not installed full-RPC execution.
