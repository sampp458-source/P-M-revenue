# Selected-Date Unassigned Classification V1 — candidate

Status: candidate only. No Production apply, commit, push, or deployment.

## Preserved membership

`hotel_selected_date_unassigned_internal(date)` retains the original Single demand CTE and Shared read contract. Selected KST day / capacity overlap / absence of an allocation in the selected demand slice are unchanged. The same canonical stay/group IDs, capacity segments and broad count are returned. `get_hotel_operations_snapshot_v2(date)` is not replaced; it receives additive item fields through its existing internal-helper call.

Header `미배정 N건` remains the broad booking-unit count. It is not the number of initial arrivals. One Shared group remains one unit; dog names never identify or merge bookings.

## Evidence and priority

First reject incomplete/contradictory member lifecycle evidence to OTHER. Otherwise:

1. CHECKED_IN_UNRESOLVED: actual check-in exists, checkout absent, and current physical identity cannot resolve uniquely with an allocation. Uses `hotel_current_physical_rooms_internal()` and the Legacy snapshot's open `release_room` exception. The physical source is read once per helper call, not once per item. This is current physical evidence even when a different planning date is selected.
2. LONG_STAY_RETURN: active canonical Long Stay contract / same runtime stay / release-room leave / linked return capacity. Planned return must be on the selected KST date with the exact guarantee boundary and consistent archived released-capacity/allocation history. Actual return uses its paired canonical return event. A completed return with no physical room is safety-first (CHECKED_IN_UNRESOLVED); normal completed returns already have allocations and are absent from the broad set. Keep-room and an unrelated capacity start are never sufficient.
3. ARRIVAL: each relevant member has exactly one nonarchived canonical initial check-in event joined to a scheduled, nonarchived, finite schedule. No actual member check-in/checkout; every canonical arrival date is the selected KST date. Shared also retains validated requested group/member/booking cardinality from the existing Shared reader.
4. LATE_ARRIVAL: same valid pending initial-arrival evidence; all arrival KST dates precede the selected date AND every relevant member is actually overdue at `statement_timestamp()`. Known time: timestamp strictly before statement time. Unknown time: arrival KST date strictly before current KST date, never fake-midnight lateness.
5. PLANNED_STAY_UNASSIGNED: same pending prior-selected-date canonical plan, but the group is not yet proven actually overdue. Existing selected-day capacity/assignment membership remains unchanged. Label: `숙박 예정 · 객실 배정 필요`, separate from true late `입실 확인 필요`.
6. OTHER: ambiguous/missing/cancelled/mixed-date or otherwise unexplained evidence. Never inferred from capacity start alone.

Shared partially checked-in members cannot become ARRIVAL. Contradictory completed member state in a requested group is OTHER. Diagnostic reason codes do not appear in primary UI.

## Additive response

Each existing item gains `classification`, `classificationReasonCode`, `canonicalArrivalAt`, `canonicalArrivalUntil`, `arrivalTimeUnspecified`, `actualCheckInState`. The containing projection gains `classificationSummary` with all six counts. The sum always equals the unchanged broad `count`.

The frontend only groups these classifications. Missing/unknown classification is OTHER. Missing or stale projection never becomes ARRIVAL; existing eligible records remain accessible under a classification-unconfirmed fallback. Header fail-closed behavior is unchanged.

## Presentation

- Initial ARRIVAL only is above DELUXE/STANDARD, with `오늘 입실 · 객실 배정 필요` or `선택일 입실 · 객실 배정 필요`. Zero hides the section. Neutral white cards keep existing drag/tap assignment and detail access; no warning badge is added.
- Safety, return, late, planned and OTHER use compact separate meanings below the room boards. The parent Attention queue suppresses canonical IDs already routed by this projection, including Shared member stay IDs.
- The existing unassign drop target remains available as a compact neutral instruction. Removing it would remove an existing command entry point.
- Future remains the exact existing canonical dataset, dedup and order below the boards. Label: `향후 입실 · 객실 미배정`. Expanded initially and after selected-date changes; toggling uses component state only. Zero hides the section.
- Public commands, drag payloads, drop handlers, permission/capacity/physical guards, request/version contracts, Long Stay controls and room/status colors are unchanged. The new assignment card uses a presentation-only `data-room-phase="arrival"` to avoid existing room lifecycle paint; no domain state is added.

## Candidate migration and security

`202609280003_hotel_unassigned_classification_v1.sql` replaces only the existing private read helper. Exact prosrc MD5 guards cover the selected-date helper, current physical resolver, Shared unassigned reader and public snapshot_v2 dependency. CREATE OR REPLACE retains the helper owner/ACL; no public signature, table/column/state, policy, trigger or command changes. Existing 90 migrations are untouched.

Production READ ONLY recheck on 2026-09-29 confirmed all four definitions byte-for-byte against repository predecessors. snapshot_v2 body MD5 is `56b2afa3112502405d1fc7cdb4ccddfe`; it passes the helper payload through without stripping additive fields. Its date/jsonb signature, plpgsql/STABLE/SECURITY DEFINER, postgres owner, search_path public/pg_temp and postgres/authenticated/service_role execute ACL were observed unchanged. Recheck immediately before any separately approved release. No Production schema/data mutation was performed.

## Validation boundaries

Isolated PostgreSQL fixtures execute the candidate verbatim and the real Shared reader/current physical resolver; legacy history has an explicitly empty fixture implementation. This is not a full Production database replay or exhaustive performance certification. All classification cases compare original membership/IDs/capacity segments and count, plus owner/ACL/signature/data preservation and guard failure behavior.

React fixtures render actual product components and CSS with business writes and Production access disabled. Browser mobile simulation is not real-device validation. No Production command was used to manufacture a case.

## Classification-aware navigation refinement

- ARRIVAL > 0: 오늘/선택일 입실 · 배정 필요 N → dedicated arrival section ID/ref/tabIndex, using the existing scroll/focus pattern.
- Trusted non-arrival classifications > 0: 확인 필요 N → existing lower classified support anchor.
- Missing/stale/inconsistent projection or missing/unknown classification with unresolved evidence: 미배정 확인 필요 → fallback support; never infer arrival.
- Broad selected-date count 0 with no unresolved fallback evidence: no generic assignment quick link. Future quick link and default expanded behavior remain.
- Header broad count remains unchanged. Unassign drop target, all three existing unassign/reversal paths and DnD commands are preserved.

Production bounded equivalent SELECT observed at 2026-09-29 15:45:51.278148 KST: broad counts 0/1/1/1 for 9/28–10/1. Canonical arrival is 9/29 18:00 KST and actual check-in is absent. 9/29 is ARRIVAL; 9/30 and 10/1 are PLANNED_STAY_UNASSIGNED, never LATE at this observation time. No candidate function was created on Production. The previously reported late result was a semantic defect, now corrected.

ARRIVAL has precedence over LATE/PLANNED: when all canonical arrival dates equal the selected date, the selected-day arrival section remains even if a known timestamp has since passed. LATE/PLANNED only apply to prior-selected-date arrivals. Shared group lateness requires all relevant pending members to satisfy their own known/unknown-time deadlines; one not-yet-due member prevents claiming the whole group is late. Missing/contradictory canonical evidence still fails closed to OTHER. Partially checked-in Shared remains safety-first; Long Stay return retains higher priority.

Time-specific SQL cases use timestamps relative to the database statement clock/current KST date, not a fixed September 2026 clock. Every classification case checks broad membership, IDs, capacity segments and summary sum against the original helper. Production natural Shared/return/safety scenarios were not fabricated.
