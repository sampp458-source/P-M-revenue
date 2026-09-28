# Selected-date unassigned V1 — local candidate only

No Production apply, commit, push, or deployment is part of this candidate.

## API and compatibility

`get_hotel_operations_snapshot_v2(date) RETURNS jsonb` retains its arguments,
return type, security mode, owner, ACL and existing payload fields. The additive
`selectedDateUnassigned` field contains `date`, final booking-unit `count`,
`singleStayIds`, `sharedGroupIds`, and `items`. Each item has `kind`, `canonicalId`
and `capacitySegments` (capacity ID, room type ID, canonical start/end). Separate
segments are retained rather than creating a synthetic continuous interval.
No dog, owner or contact fields are returned by the new projection.

A new internal stable security-definer read helper is not executable by PUBLIC,
anon, authenticated or service_role. The existing snapshot invokes it as owner.
The same active Operations membership helper guards both paths. Candidate
migration checks exact predecessor body hashes for snapshot_v2 and the Shared
read function. These are repository/captured-audit expectations, not a new
Production pre-apply attestation; recheck live catalog before any future release.

## Single identity and assignment

Canonical nonarchived `source_kind=stay` capacity, quantity 1, linked to a
nonarchived, not-checked-out stay, must overlap the selected KST business day.
No schedule status/name/date substitutes for capacity boundaries.

Assignment follows the existing allocation source: a nonarchived allocation of
that same capacity must overlap the selected capacity/day intersection. An old
segment ending before the day, an archived preassignment, or a segment starting
after the day cannot assign that day's demand. A partial-day actual entry or
same-day room move is still an assignment, not a newly invented full-day
coverage requirement. This field answers **no assignment in the selected slice**;
it is not an allocation-gap validator or room-availability guarantee.

Same-stay unassigned demand segments collapse to one booking unit. The existing
Single eligibility contract requires one active capacity; the Long Stay invariant
requires one current runtime capacity and closes/archives earlier segments.
There is no approved independent multi-room Single contract. Multiple rows in
the isolated QA case are a defensive read-projection test, not new permission to
create multiple concurrent room demands. Dog identity is never used to dedup.

## Shared and Long Stay

Shared reuses `get_unassigned_shared_hotel_room_groups(date)` verbatim: requested,
validated DELUXE group, one group capacity, valid member linkage, selected-day
overlap, no physical occupancy. Group IDs dedup the final result. Member count
is never capacity. Existing invalid-linkage errors still fail the snapshot rather
than returning a false zero.

Long Stay keep_room capacity/allocation remains assigned. release_room closes
and archives the old capacity and keeps the future-return guarantee interval.
The release gap is not demand; an overlapping future-return interval without
assignment is demand. Neither stay creation time nor scheduled check-in is used
to bridge that gap. No command, guard or lifecycle mutation is changed.

Unknown-time conservative boundaries come directly from stored canonical
capacity intervals. No fake actual midnight is generated. Half-open boundaries
are reused: reserved_from < next_day AND reserved_until > day_start.

## Header

Current/future operational Header renders existing server `conservativeRemaining`
(or known-type confirmed remaining) under 선택일 계획 여유. Unknown-type evidence
never falls back to an optimistic confirmed value if conservative data is missing.
It prints the final server unassigned count only. Missing/stale projection displays
확인 필요, not zero or a locally derived guess. Date changes suppress stale values.

Primary 빈방 is removed. Overall remaining stays subordinate and is labeled
전체 계획 여유 with a separate-type/full-period limitation. Existing arrival/departure
semantics, historical-date UI, future disclosure, canonical stay/group identity,
room cards, commands, permissions and physical-occupancy logic are unchanged.

## Validation and limits

The PostgreSQL harness uses a disposable Unix-socket-only database. It executes
the real Shared read function, original snapshot_v2, and candidate migration.
It verifies read-only execution, A–M cases, identity, permission/date rejection,
old snapshot field/ACL/signature preservation, and row preservation on migration.
Its bounded storage fixture is not a full Production RLS/lifecycle emulator.
Unknown-time tests consume established capacity boundaries; they do not rerun
reservation creation commands. No Production migration or write was performed.

React captures render the actual working-tree HotelRoomBoard with a local
Production-equivalent fixture and a Supabase access blocker. They are not
Production screenshots or a live end-to-end DB-to-browser session. Mobile is a
390px browser simulation. SQL projection and React rendering are tested in
separate isolated layers.
