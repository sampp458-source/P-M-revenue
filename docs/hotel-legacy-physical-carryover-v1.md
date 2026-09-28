# Legacy Physical Occupancy Carryover V1 — local candidate

Status: LEGACY_CARRYOVER_PHYSICAL_OCCUPANCY_V1_PRECOMMIT_READY
Base: 717f5fcd579c5077984fa36c548d15b92a5e1ba6
Production has NOT received this candidate. No business mutation, repair, backfill, commit, push or deploy.

## Bounded eligibility and provenance

Cutover is `2026-09-25 00:00:00+09`. A legacy anchor requires an unarchived, actually checked-in, not checked-out stay with actual entry before cutover. Full current-matching entity audit chains establish the stay, canonical capacity and allocation state AT cutover, not merely the present value of their planned dates. The stay was already checked in and unfinished at cutover. The at-cutover canonical allocation has `from <= cutover < until`; end equality is excluded. Later backdated writes or planned-end extensions cannot manufacture eligibility. Single capacity belongs to the stay. Native Shared capacity must link through the at-cutover active canonical member. Quantity is one room.

Production `allocated_until` is NOT NULL. The open-ended case is PostgreSQL infinity, which is tested. NULL is not a valid fixture for the actual table contract; no schema relaxation is proposed.

Four observed old stale stays have allocation ends before cutover and are excluded. They are neither repaired nor revived. Names/dog IDs are never identity or provenance keys.

## Current physical resolution

`hotel_current_physical_rooms_internal()` remains the single source used by the existing immediate allocation guard and the current-date snapshot. Its native V1/Daycare branches remain unchanged; a bounded legacy branch is added.

A Single anchor follows a unique contiguous, nonarchived same-capacity allocation chain up to now. Terminal scheduled expiry alone is NOT release. Gaps, ambiguity or invalid linkage do not cause a last-row guess. A canonical room move resolves its successor, not the original room. Completed checkout/archive excludes the stay. In-place Single-to-Shared conversion follows active canonical membership, active occupancy, allocated group and one DELUXE capacity, including the existing merge shape where capacity.shared_room_group_id is NULL. Secondary archived Single capacity is proof only, never a current second room.

Long Stay `keep_room` retains occupancy. An open `release_room` leave overrides an anchor. Future return capacity alone creates no physical occupancy. A real post-cutover return is an independent canonical admission proof: current active contract, paired leave/return, completed inventory transition, actual return timestamp equal to allocation start, and matching stay/capacity/room references. This preserves Gamja even though Gamja had no occupied cutover anchor; it does not manufacture historical eligibility. Each stay returns once.

## Guard integration and continuity

Existing assign/reassign/move commands, and the RPCs invoked by DnD, write hotel_room_allocations and pass the existing physical guard. Immediate use conflicts with the canonical physical helper and raises 23P01. Future planned allocation remains permitted by the existing interval/capacity contract. No frontend legacy predicate is used for enforcement.

Additional audited path: reversing a completed LEGACY checkout could restore physical occupancy after its old planned end while another guest now occupies the room. The local reproduction confirmed that existing pre-cutover check-in guard conditions did not protect this case. The candidate adds `hotel_legacy_physical_reentry_guard`, a deferred constraint trigger ONLY for pre-cutover checked_out_at non-NULL → NULL updates. At transaction end, after audit and Shared membership restoration, it rechecks the same canonical room against the same existing physical assertion. Valid reversal succeeds; conflicting Single and Shared reversal raises 23P01 and rolls back lifecycle restoration. Existing reversal RPC bodies/payloads are unchanged. Both local reversal bodies match the current Production catalog after replaying the repository's authorization-only patch.

The migration checks 14 exact function/dependency body fingerprints and two enabled existing physical guard trigger bindings. It never disables triggers or broadens RLS. Existing public signatures, owner, ACL, security/search_path metadata are preserved. New helpers are private and revoked from PUBLIC/anon/authenticated/service_role.

Unresolved room safety is not proof that an arbitrary room is occupied. The resolver does not invent a room or block every room globally. Eligible but unresolved current stays receive Attention; such anomalies need operational diagnosis, not automatic repair.

## Frontend and date scope

Current-date snapshot merges canonical physical members even after the planned date has rolled over. It adds optional `currentPhysicalRoom` with date, observedAt, state (occupied/released/unresolved), and resolved allocation. Snapshot canonical stay data takes precedence over raw Shared detail data. React consumes that field; no new cutover eligibility or continuity arithmetic is duplicated in React. Actual completion overrides a stale projected hold; another-date projection fails closed.

Past/future snapshot payloads are unchanged, and their board allocation lookup remains historical/planned. Native V1 fallback exists for older payloads; this is a DB-first candidate, not an app-first fix.

Checked-in, unfinished, current-room-unresolved stays do not enter ordinary unassigned bookings. They use existing Attention architecture with `객실 점유 확인 필요 · 입실 완료 기록 확인`. Explicit released Long Stay does not produce false attention. Resolved Benger uses the normal room-card checkout path, so it no longer appears in the legacy checkout-review strip. No CSS or Visual System D changes.

## Production-equivalent blast radius

Fresh read-only capture: 2026-09-28 14:56–14:57 KST; final dependency check 15:01 KST. A new native stay since the earlier audit makes the current set 9, not 8. Raw technical rows/audit history were copied into an isolated socket-only local fixture, never written back. No customer contacts or payment details are in this report.

| Stay (short ID) | Old physical helper | Cutover anchor | Candidate room | Result |
|---|---|---|---|---|
| 벵거 efb321d7 | Excluded | Yes | DELUXE 4 | RECOVERED after planned 12:40 end |
| 감자 1225a1d3 | Excluded; interval board had room | No, away at cutover | DELUXE 5 | Actual 9/25 return, exactly one room |
| 먼지 old 80a39513 | Excluded | No | None | Stale end 8/16, NOT RECOVERED |
| 단추 612d58e4 | Excluded | No | None | Stale end 8/18, NOT RECOVERED |
| 라라 8da96be1 | Excluded | No | None | Stale end 9/23, NOT RECOVERED |
| 호두 cc0533c5 | Excluded | No | None | Stale end 9/23, NOT RECOVERED |
| 꼬들이 ef3c357e | STANDARD 3 | Not needed | STANDARD 3 | Native V1 unchanged |
| 덕춘 45a86458 | STANDARD 4 | Not needed | STANDARD 4 | Native V1 unchanged |
| New native c3343d3b | DELUXE 2 | Not needed | DELUXE 2 | Native V1 unchanged |

Old helper: 3 rooms. Candidate: 5 rooms, no same-room duplicate. Four stale records stay excluded. Actual checked-in unfinished Shared members in the read-only Production sample: 0. Shared acceptance therefore uses local fixtures, not a fabricated Production case.

## Validation and limits

- Targeted frontend: 6 files / 140 tests PASS.
- Full frontend regression: 195 files / 1,589 tests PASS.
- Lint, typecheck, build, tracked/untracked whitespace audit PASS. Existing >500 kB bundle warning remains.
- Local SQL candidate apply, predecessor guards, existing metadata preservation and private-helper ACL PASS.
- Benger hold, stale 4, half-open boundary, backdated proof rejection, infinity, native V1, actual normal checkout PASS.
- Actual assign/reassign/move RPC conflict 23P01; failed reassign rollback; future assignment accepted PASS. DnD uses these same RPCs; no Production drag or command was executed.
- Contiguous room move releases old room and protects new room; broken continuity does not guess PASS.
- Long Stay keep/release/future-return/actual-return fixtures PASS.
- Native and legacy Shared first/last checkout, one capacity per room and STANDARD rejection PASS.
- Canonical Single→Shared conversion fixture PASS; this fixture models command output, not a live merge RPC acceptance.
- Single/Shared reversal real RPC bodies (Production hash matched) and deferred collision rollback PASS.
- Current snapshot day-rollover merge, past/future projection preservation PASS.
- Actual React fixture 1440/390: Benger DELUXE 4 / 퇴실 지연, absent from ordinary unassigned queue. Separate unresolved fallback screenshots. Browser-simulated mobile, not real-device QA.
- Final local exact-row replay: current v2 12.106 ms; resolver 5 rows / 3.259 ms. These are not Production full-snapshot latency or load/concurrency benchmarks.
- Existing historical 89 migrations are byte-identical. No historical-room-resolution, Selected-Date Capacity, capacity arithmetic, permission or lifecycle status implementation is replaced.

The SQL harness is a bounded 016 synthetic schema with verbatim repository functions and actual-row replay. It is NOT a clean full migration-history replay or an exact Production catalog/RLS/trigger parity claim. The previously identified foundation replay gap is not repaired here. Current Production predecessor/guard definitions were read-only verified; full release readiness remains a separate preflight. Public RPCs/normal business commands were not invoked against Production.

## Candidate footprint

New migration: `202609280002_hotel_legacy_physical_carryover_v1.sql`.
Two existing functions replaced; five private functions added; one narrow deferred reentry trigger added. No tables, columns, indexes, RLS policies or stored business states added. No DML/backfill/repair or allocation extension. Production schema/data unchanged.

SOURCE_CHANGE: candidate implementation/tests/docs only
DB_SCHEMA_CHANGE: function/trigger migration candidate only; Production 0
PRODUCTION_READ_ONLY: YES
PRODUCTION_MUTATION: 0
COMMIT: NO
PUSH: NO
DEPLOY: NO
MIGRATION_APPLY: NO (Production; local fixture only)

## Current Production v2 integration precommit audit

Production `get_hotel_operations_snapshot_v2(p_local_date date)` is jsonb / plpgsql / STABLE / SECURITY DEFINER, search_path public, pg_temp, owner postgres. Execute ACL is postgres, authenticated, service_role. Body MD5 `56b2afa3112502405d1fc7cdb4ccddfe` exactly matches the final repository 202609280001 definition. The selected-date helper MD5 is `4726fbb8e6f41bffd5c5c9182a2774aa` and has postgres-only execute. Shared-unassigned helper MD5 is `760e1d7cca31bfa3f9803c15c210ea4c`.

The prior harness loaded the 202608040002 v2, which did not prove the current selectedDateUnassigned integration. The harness now extracts the exact current v2, selected-date helper and current Shared-unassigned function from repository migrations. All three prosrc hashes match Production. It does not apply the entire 202609280001 migration: its predecessor foundation is not reproduced by the bounded fixture. This is explicitly a current read-path replay, not a repaired historical migration replay.

Both synthetic scenarios and a fresh technical-row replay invoke the actual `get_hotel_operations_snapshot_v2('2026-09-28')`. Benger has occupied currentPhysicalRoom for DELUXE 4; Gamja has DELUXE 5 once. selectedDateUnassigned, confirmedRemainingByType, overallSafeRemaining, individualTypeAvailabilityWarning, roomTypeUnspecified, totalCapacity, unassignedRoomTypeCount and room-type planning fields (including conservativeRemaining) equal the same current v2 with the predecessor base. rooms/settings equal their predecessor result. Physical room counters are intentionally updated. Selected-date unassigned count is 0; Benger is absent from it. Future 9/29 planning fields also match. This fixture uses a simplified hotel_stay_json formatter and local auth stub; it does not claim full Production UI DTO, auth or catalog parity. Frontend tests and the unchanged approved React captures cover presentation.

### Predecessor guard rationale

The current v2 must delegate to the base and preserve its merged stays, so v2 drift must fail closed. The selected-date and Shared-unassigned dependencies are also pinned because they are part of the current public read path.

The deferred reentry trigger evaluates final canonical state, but the tested reversal safety depends on normal RPCs atomically restoring completion, audit and (for Shared) membership/lifecycle. The exact two reversal bodies are therefore pinned. No reversal RPC is replaced. The generic final-state trigger is not justification for ignoring arbitrary future command semantics. All five newly pinned function drift probes reject with STOP_LEGACY_CARRYOVER_PREDECESSOR_MISMATCH and rollback locally.

Final guarded functions and exact Production-matching body hashes:

| Signature | MD5 |
|---|---|
| `public.hotel_current_physical_rooms_internal()` | `084c0ad98b3eb88bb43a00f53eb0b30e` |
| `public.assert_hotel_physical_room_available_internal(uuid,uuid)` | `253c293f3783e827a7bd90bae21d472a` |
| `public.guard_hotel_physical_allocation_internal()` | `167e91d443dc2304efe683d3a7289015` |
| `public.guard_hotel_physical_check_in_internal()` | `97b527fa8f52b36d3f2fd5d54a57d3e3` |
| `public.get_hotel_operations_snapshot(date)` | `6c5f11faa36e099aa4ad14274be19839` |
| `public.get_hotel_operations_snapshot_v2(date)` | `56b2afa3112502405d1fc7cdb4ccddfe` |
| `public.hotel_selected_date_unassigned_internal(date)` | `4726fbb8e6f41bffd5c5c9182a2774aa` |
| `public.get_unassigned_shared_hotel_room_groups(date)` | `760e1d7cca31bfa3f9803c15c210ea4c` |
| `public.reverse_hotel_completion(uuid,integer,text,text,uuid)` | `98ad764ce3b12bc5f87ba1dfba8169b2` |
| `public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)` | `e2517aeecb9bd485dbeaed34049ecd99` |
| `public.hotel_history_semantic_010(text,jsonb)` | `918972afa05c7cf40223c79ecf0f26dc` |
| `public.hotel_history_chain_010(text,jsonb,jsonb)` | `850f95d9131a5cf22f33df0a5aa2bdc1` |
| `public.hotel_shared_semantic_internal(text,jsonb)` | `d07e04b00d05e4e72173fc62667553e0` |
| `public.hotel_shared_chain_internal(text,jsonb,jsonb)` | `2f2bbaf15d0d9bbc409b5d931c8783a3` |

The existing allocation/check-in guard triggers are both enabled O and bound to their expected functions. Final live match: 14/14 functions, 2/2 trigger bindings. Existing public metadata is preserved; new helper execute grants stay private.

### Provenance retention and performance

PERFORMANCE_SAFE for the observed bounded precommit workload; not a Production latency SLA.

Production row counts: stays 94, capacity reservations 98, allocations 136, audit events 8,475, physical occupancies 5, members 10, Long Stay events 6. There are 6 unfinished pre-cutover stays and 2 active room types.

The existing `entity_audit_events_entity_created_idx(module_code,entity_type,entity_id,created_at DESC)` supports each proof chain lookup. Active capacity/allocation overlap and stay/member indexes also exist. A read-only EXPLAIN ANALYZE of the equivalent Single-anchor provenance SELECT completed in 43.515 ms (planning 4.835 ms), with 630 buffer hits, no disk read/write or temp blocks. Its proof path used the audit index for 27 entity lookups; the canonical former-capacity lookup used the same index over 287 Hotel capacity audit rows. This deliberately covers the expensive provenance path for current Single legacy candidates, not the complete uninstalled candidate, Shared branch or HTTP latency.

At two room types, the current base has up to two physical-helper calls for counters plus one physical_rows materialization; each includes legacy resolution. The anchor-only merge adds another proof path. PostgreSQL can reuse/hoist uncorrelated stable scans, so source call sites are not an exact execution count. Even conservatively considering repeated work, the observed tiny candidate set, indexed proofs and 12.106 ms local full-v2 replay show no present bottleneck requiring new index/state or resolver redesign. This conclusion must be revisited if audit chains/current legacy workload grow materially. No new index was applied or proposed as required.

No audit history or an incomplete chain fails closed: local deletion/gap tests do not infer an anchor from current dates. Audit retention is therefore a functional dependency. Pruning the required chains while a legacy stay is unfinished can remove its provable carryover; fail-closed is not evidence the room is actually empty. Keep the required stay/capacity/allocation/member history through actual checkout and any supported reversal period. A chain lost after planned-day rollover may also prevent current snapshot merge, so Attention is not a substitute for preserving proof. This audit did not establish an external retention guarantee. The finite pre-cutover set is bounded and cannot grow through ordinary new check-in; approved reversal can reopen one. The current proofs are complete. No persistent state, backfill or Production repair is needed on present evidence.

Current replay: 9 unfinished stays = 1 cutover anchor + 1 canonical actual return + 3 native + 4 intentionally excluded stale. Five physical rooms, duplicate capacity-per-room 0, unresolved active rows in current snapshot 0. The four excluded stale records must not be mislabeled as four unresolved eligible occupancies.

### Final validation refresh

Current-v2 integration SQL, missing/incomplete provenance negatives, 5 dependency-drift negatives, legacy immediate command guards, normal checkout, Single/Shared reversal rollback, native Physical Occupancy V1, native/legacy Shared, Long Stay and future planning all rerun PASS. Frontend targeted 6 files / 140 tests, full 195 files / 1,589 tests, lint/typecheck/build PASS. Only the existing bundle-size warning remains. Frontend bytes match the approved candidate, so its 1440/390 React screenshots are reused without claiming new Production visual acceptance. This turn changes only candidate migration guards, SQL harness/assertions and this document.

Production actions were BEGIN READ ONLY / SELECT / EXPLAIN SELECT / ROLLBACK only. No Production RPC command, DDL, data repair, function installation, checkout or allocation was executed. Commit/push/deploy/Production migration apply remain forbidden and not performed.
