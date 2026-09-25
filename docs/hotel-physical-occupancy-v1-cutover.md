# Hotel Physical Occupancy V1 — 2026-09-25 cutover candidate

Status: implementation / local validation only. Not applied to Production. No checkout, repair, backfill, commit, push or deployment in this task.

## Contract

Cutover is **2026-09-25 00:00:00 Asia/Seoul**, inclusive (`2026-09-24T15:00:00Z`). A non-archived Hotel stay whose actual check-in is at/after cutover and not in the future, with no actual checkout, retains the latest started allocation of its active capacity segment. Planned checkout/allocation expiry does not release it. Actual checkout releases it. Completed and archived records never regain a hold. The preceding room segment is not revived after a move. Released Long Stay capacity remains released. Existing Daycare actual-entry protection is retained.

Pre-cutover Hotel entries do **not** inherit a new physical hold. Planned reservation intervals and their overlap/capacity restrictions still exist; this is not permission to ignore overlapping planned reservations. No old checkout timestamps, allocations, shared memberships or collision records are repaired.

Post-cutover occupied room cards remain green, show an explicit overdue label only when a real checkout time is known, and keep existing detail / checkout access. Unknown-time date placeholders never generate hourly overdue. Future reservation planning and historical selected-date projections retain their existing contracts.

## Legacy departures from cutover onward

The three operator-reported cases were all checked in before cutover. Therefore they cannot be silently opted into the new hold. Current-day reads separately retain unfinished legacy stays with checkout schedules dated at/after cutover and before the selected day end. A compact **퇴실 처리 확인** list exposes existing Single or Shared detail handlers when their departure is due. This list is not counted as a physical room hold. Very old schedules before cutover do not enter this list. No extra command, permission path or named-stay exception is introduced.

Shared cards use a current planned interval or a post-cutover member hold. Legacy expired shared records remain accessible in the review list without being promoted to permanent room occupancy. Each review entry uses the same shared-group detail action; the existing member checkout controls and confirmations are preserved. Successful refreshed checkout removes that member from the pending list.

## Today-case read-only evidence

Observation: 2026-09-25 21:15 KST. Names, owner information, notes, payments and Production IDs are not copied into test fixtures.

| Synthetic case | Shape | Actual entry KST | Planned checkout KST | Current checkout | Room |
|---|---|---|---|---|---|
| Shared A | active member, shared occupancy active | 09/21 15:44 | 09/25 20:00 | NULL | DELUXE 6 |
| Shared B | same occupancy / capacity as A | 09/21 15:44 | 09/25 20:00 | NULL | DELUXE 6 |
| Single C | single capacity / allocation | 09/23 07:50 | 09/25 20:00 | NULL | DELUXE 5 |

Shared planned allocation starts 09/21 13:00; the Single starts 09/23 07:50. All end 09/25 20:00. Captured extension overlap counts were zero. At 21:23 KST read-only recomputation of each proposed extension through observation time found type peak 6 / active rooms 6 and total peak 10 / active rooms 11. These are observed conditions, not a guarantee about later concurrent business activity or authorization/version checks.

**Shared root cause:** existing last-member late checkout calls `assert_hotel_room_allocation_available` before extending its capacity upper bound. The validator rejects the new allocation endpoint outside the old capacity bound (22023). First-member checkout is a separate step and does not hit this last-member extension branch. This failure was reproduced with the verbatim Production predecessor in isolated PostgreSQL, then the candidate was tested against the same anonymous shape. Candidate extends capacity before allocation validation; all existing overlap/capacity checks and atomic rollback remain. First checkout leaves group active; last releases it. DELUXE-only shared policy is unchanged.

**Single root cause:** planned interval expiry removes the stay from the current room-card projection. The existing `complete_hotel_check_out` already supports a late completion when version, role, capacity and collision checks pass. No confirmed Single RPC failure is claimed: no Production command was invoked and no original runtime error trace was supplied. Its current shape succeeds through the unchanged captured Production checkout RPC in local QA. The new review path restores access without rewriting that RPC or forcing occupancy.

## Production predecessor rebase

The snapshot is based on the captured installed function, not on repository replay's earlier snapshot. `rooms` and `settings` expressions are preserved verbatim; planned capacity arithmetic is unchanged. Only current physical metrics and unfinished/post-cutover departure read inclusion are added.

| Guarded predecessor | Production body MD5 |
|---|---|
| get_hotel_operations_snapshot(date) | 655417d618ef44206fe8274e026b7ae9 |
| get_hotel_operations_snapshot_v2(date) | 7dac53943e2f74f207de1cd36d5023fb |
| get_hotel_shared_room_occupancies(date) | 7a52aee4d105736f18a48176df0a701b |
| complete_hotel_check_out(uuid,integer,timestamptz,uuid) | 7744baa7276dcb70676ec593e8ddc0e6 |
| complete_shared_hotel_member_check_out(uuid,uuid,integer,integer,timestamptz,uuid) | c4da96cc8def147edd5a52a8844b9508 |
| hotel_single_room_eligibility_internal(uuid,text,timestamptz) | 8e1ec0b36c21013a40cd60b58d61569b |

All six were re-read from Production during this task. Unexpected bodies still stop migration. Existing RPC signatures, return types, SECURITY DEFINER/search_path, owners and ACL are preserved; the local harness compares metadata before/after. New internal helper execution is revoked from public application roles.

Only the unapplied `202609250001` candidate is revised. Existing 85 migrations stay byte-identical. The repository Hotel foundation replay gap remains separate technical debt and is excluded from this release blocker by operator decision. No historical foundation migration was reconstructed or added.

## Focused validation

A: Pre-cutover unfinished Single/Shared creates no new physical hold; stale data remains unchanged; new entry can use a non-overlapping planned room.
B/C: Post-cutover actual stay holds before and after planned end; only latest room remains held.
D: Real existing Single checkout completes late and releases the hold.
E: Real Shared member checkout retains group/remaining hold; last checkout releases group; STANDARD shared rejected.
F: Immediate new entry/allocation is server-rejected while a post-cutover occupant remains. Two real check-in calls raced: one succeeds, one rejects.
G: Future finite planning and capacity intervals remain accepted.
H: Unknown-time retains physical allocation; no fake midnight overdue (frontend test).
I: Date rollover persists current room/detail access (deterministic frontend clock); current SQL read inclusions do not depend on a planned upper bound for post-cutover stays.

Actual React DOM test opens the existing Single/Shared detail callbacks from the legacy review list, proves no command is called by opening, and removes the entries after completed state refresh. The SQL harness uses a bounded synthetic schema and verbatim captured predecessors; it is not a full Production schema/RLS replay. The captured predecessor SQL is a **local test fixture**, not a foundation migration. Synthetic writes use a Unix-socket-only isolated database and are rolled back/cluster stopped.

Production checkout is a separate, later user-approved operation after candidate review/release. No real checkout time is invented by this implementation.
