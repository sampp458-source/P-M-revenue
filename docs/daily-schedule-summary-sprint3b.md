# Daily Schedule Summary Sprint 3B candidate

Candidate only. No Production apply, enable, cron creation, commit, push or deploy.
The 97 existing migrations are unchanged. The new migration is
`202610020001_daily_schedule_summary_sprint3b.sql`.

## Contract

A recipient's first successful snapshot for a KST date is immutable, including
zero schedules. Selection uses the existing Calendar half-open overlap:
`starts_at < next KST midnight AND ends_at > current KST midnight`.
Only scheduled, non-archived schedules and non-archived assignments count.
Active Operations membership and an active profile/account are required. Active
Operations users with no assigned schedules receive a zero snapshot, not a notice.
Owners/managers receive only their own assignments. Multi-assignee schedules count
once per recipient; unknown-time, overnight and multi-day semantics are unchanged.
No fake clock time is introduced; existing UI/Push/Calendar code is reused.

## Data and transaction

`notification_daily_summary_runs` stores FULL/PILOT scope, summary date, request
identity, start/completion timestamps and exact eligible/zero/snapshot/skip/event/
notification/delivery counts. FULL has one successful run per date; PILOT has one
per recipient/date. Failed transactions leave no successful run or partial state.
There is no persistent failure row: SQL/cron error records remain the error source.

`notification_daily_summary_recipient_state` has primary key
`(summary_date, recipient_id)`, schedule count, capture timestamp, run reference and
nullable event reference. Its deferred event FK supports a single CTE pipeline.
This is notification state, not a schedule/assignment mutation or domain lock.

The runner takes a transaction advisory mutex for the date BEFORE selection.
One SQL statement materializes eligible recipients/counts and inserts snapshot
state, events and notices using one READ COMMITTED statement snapshot. A later
SELECT counts only delivery rows for newly inserted notice IDs, after queue
triggers finish; it does not reselect domain data. All run statistics commit with
those writes. No per-recipient SELECT/emit loop is used.

PILOT then FULL skips the previously captured recipient, even at zero. A successful
FULL freezes the date, including users activated or assigned afterwards. No later
summary update/late summary occurs. Subsequent business changes use realtime.
Successful reruns report zero creations, ALREADY_COMPLETED and snapshot skips.
New-run eligible/zero counts describe that invocation's selection; previously
captured recipients are counted as skips and are never rewritten.

The migration refuses previously existing Daily events: Production was audited
with Daily OFF and zero events. An unexpected old Daily history requires a separate
audit, not silent reconstruction or backfill.

## Entrypoints / OFF policy

- Existing `run_daily_schedule_summary_v1()` keeps its integer signature, now
  returning actual summaries created (zero on rerun).
- `run_daily_schedule_summary_v2()` is the service-role operational entrypoint
  returning structured statistics. Both use the actual statement clock.
- Existing `_at_v1(timestamptz)` is owner-only and delegates to the same engine.
- `run_daily_schedule_summary_pilot_v1(recipient, timestamp, request_id)` is
  postgres-only. It intentionally bypasses Daily OFF and the 08:00 time gate for
  separately approved controlled acceptance, but never bypasses disabled Schedule
  source, active Operations eligibility or recipient snapshot idempotency.
- The internal engine is postgres-only. Arbitrary client recipients/dates are not
  exposed. Clock injection exists only for internal QA/pilot; use the actual
  current KST date during Production acceptance.

## Security

Seven exact predecessor source hashes, owners, SECURITY DEFINER flags, search_path
and ACLs are checked transactionally. New tables are postgres-owned, RLS-enabled,
with no client policies and all PUBLIC/anon/authenticated/service_role grants
revoked. New/replaced functions have explicit owner/search_path/ACL handling in the
same transaction, including revocation of inherited Production default grants.
Only operational wrappers retain the necessary service_role grants. No RLS,
publication, domain command, membership or permission broadening is introduced.

## Wake and expiration

The existing wake path now nests a second exception handler around diagnostic
UPDATE. Both UPDATEs retain `WHERE singleton IS TRUE`; safeupdate stays enabled.
Wake and diagnostic failures cannot propagate ordinary exceptions into business
notification transactions. A fixed, non-sensitive LOG marker reports diagnostic
failure. Domain/constraint errors still correctly roll back the whole transaction.

Daily validity requires its local date to equal the current server KST date.
The claim path converts old PENDING/FAILED/expired-lease PROCESSING Daily deliveries
to CANCELLED with `DAILY_DATE_EXPIRED`, including exhausted retries. Cleanup uses
ordered row locking/SKIP LOCKED and runs before the backend-enabled claim gate.
No app notification/read history is deleted. Other event validity is unchanged.
An unexpired provider lease is not stolen; get_delivery rechecks validity before
send, and an abandoned lease is cleaned on a later worker claim.

If backend is OFF or worker unavailable, cleanup runs when worker claims resume;
there is deliberately no new cron. No expired Daily is handed to the provider by
a post-midnight get_delivery. A provider request already in flight before midnight
cannot be recalled, and provider-side exactly-once or device presentation is not
guaranteed. Existing TTL/retry behavior and the Edge worker are unchanged.

## QA and reproducibility

`daily_schedule_summary_sprint3b_qa.py --safeupdate LIBRARY --output RESULT_JSON`
creates a fresh Unix-socket-only PostgreSQL cluster with canonical-shaped synthetic
fixtures, exact migrations, Production default ACL grants and actual safeupdate.
Vault/network are local doubles; no external Push is sent. The forced MVCC barrier
updates/completes a shared-assignee schedule after selection begins and verifies
both recipient counts reflect the same snapshot.

`daily_schedule_summary_sprint3b_clone_qa.py --socket LOCAL_SOCKET --port PORT
--database LOCAL_CLONE --psql PSQL --safeupdate LIBRARY --output RESULT_JSON`
requires the isolated Production-schema clone's six synthetic 20000000-* profiles
and canonical calendar/type fixtures. It verifies actual create/read/publish/delete
RPCs after candidate installation. It is destructive only to that local QA clone.

Existing Schedule 3A, ACL, Push, hard-delete, and lock-order suites are also run.
The original lock-order suite runs on a separate Production-schema clone with this
candidate installed (100 iterations each OFF/ON, 444 concurrent transactions).
Frontend tests exercise existing Daily rendering, no ACK, typed navigation, Push
content and notification behavior. No frontend source change is necessary.

## Staged release plan (not executed)

1. Review the candidate, exact SHA manifest, logs and immutable migration baseline.
2. Recheck live predecessors/config/catalog and take normal release evidence.
3. Separately approve/apply only this migration; keep Daily OFF and no Daily cron.
4. Postflight schema, ACL, RLS, old signatures, unchanged domain data and realtime.
5. Separately authorize owner-only PILOT for the operator's account/current date.
   If that date has already had a successful FULL run, choose another date; never
   delete snapshot guards for repeat testing. Pilot needs natural assigned data.
6. Verify event/notice/deliveries and actual device/read/Calendar acceptance.
7. Separately approve Daily ON and a Daily cron, preserving existing Push retry.
   Production cron timezone is GMT: 08:00 KST is 23:00 UTC on the previous UTC day.
   A proposed bounded catch-up window is UTC 23:00–23:10; success makes retries no-op.
   Missing the entire window requires an explicitly authorized same-day manual run.
8. First automatic-run postflight: exact statistics, zero snapshots, no duplicates,
   queue health and device results. No automatic previous-day backfill.

If migration fails, require confirmed rollback and stop. If postflight fails, do
not enable Daily. Operational containment is Daily OFF/cron suspension under the
separate release authority; do not erase evidence or weaken guards. No app/Edge
redeploy is needed for this DB-only candidate.
