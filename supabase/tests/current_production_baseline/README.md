# Latest status: final structured provenance closure

The historical results below describe the initial baseline discovery, not the latest gate.
See [final provenance closure](../../../docs/dog-structured-trace-provenance-closure.md)
for current hashes, complete inventory, Production READ ONLY sweep and validation.

Current run order: captured catalog → Schedule correction → final READ provenance correction
→ V2-B candidate. Journal, terminal-family Shared and exact creation-to-reassignment Sales
coverage are included. Production correction/candidate execution remains prohibited here.

Rebuild the bounded diagnostic (requires the private READ ONLY captured manifest):
`python3 supabase/tests/current_production_baseline/build_trace_sweep.py /path/to/production-catalog.json`

The emitted diagnostic is READ ONLY, 500 source rows per run. Change only the OFFSET and
reported offset together for each batch, preserve source ordering, verify population stability,
and aggregate every batch. It installs no functions and returns no customer/dog names.

---

# Current Production catalog baseline QA

Latest correction/results: [schedule-dog provenance review](../../../docs/dog-schedule-audit-provenance-correction.md).
Run `python3 run_integration.py <catalog.json> <output-directory> --accept-local-environment-differences` after reviewing the documented PG/auth/extension boundaries.
The runner applies correction before V2-B, records both hashes, runs independent suites and returns failure while Journal coverage is blocked.
The original findings below are retained as pre-correction history.


This is isolated QA infrastructure, not a deployment package. No business data is
captured. No historical migration or application source is changed.

## Reproduction

1. Run `catalog.sql` in an authorized READ ONLY catalog session. It ends with
   ROLLBACK. Concatenate ordered `chunk_text` values from the export, checking the
   returned text length and MD5 before saving the JSON outside the repository.
2. `python3 build.py /absolute/catalog.json --output /absolute/result-directory`
   builds a fresh Unix-socket-only cluster and stops it. Inspect build-result.json
   and alignment-differences.json. Any catalog mismatch blocks candidate apply.
3. `python3 dependencies.py /absolute/catalog.json /absolute/dependency-output`
   records conservative dependency closure. Review dynamic SQL separately.
4. Restart only the cluster named in build-result.json, using PostgreSQL pg_ctl,
   `-h '' -k <cluster-directory> -p 55509`. Use psql `-X -v ON_ERROR_STOP=1`,
   local socket, database dog_current_baseline, user postgres.
5. Execute seed.sql, then domain_smoke.sql and domain_extended.sql. The latter two
   use real domain RPCs under the synthetic authenticated role and end ROLLBACK.
6. Only after baseline/domain gates pass and environment differences are reviewed,
   verify candidate SHA256 below and apply that exact file to this LOCAL database.
7. Execute the same two domain scripts again, then domain_removal.sql. Do not hide
   or treat its current assertion failure as an expected success. Stop release QA
   on failure. Stop the cluster when finished.

Candidate: supabase/migrations/202609180001_dog_profile_removal.sql
SHA256: 387b666f4d853fc3ea99962be56fe595ea444bdd0cab09ea26d9a447411cefe0

## Initial pre-correction result (2026-09-18)

Catalog: 47 public tables, 230 functions (including auth helpers), 110 triggers,
464 constraints, 166 indexes, 65 policies. Exact per-object comparison passed;
ACL/object order is compared without collation-dependent ordering. PG18 exposes
429 NOT NULL constraint records absent from PG17; column nullability is separately
compared exactly. Production capture SHA256:
3b43373b06e7e636a7fb48e839a2fcea189973d5e1d92a9eb1494484f835400b.

Environment limitations: Production PG17.6 versus local PG18.6; minimal synthetic
four-column auth.users identity boundary; pg_stat_statements and supabase_vault
not installed (no exercised domain dependency). pgcrypto/uuid-ossp versions match.
No Production latency claims. Regex dependency discovery is conservative, not an
arbitrary PL/pgSQL AST proof; dynamic structured-trace lookup uses captured public
JSON-bearing tables. No missing explicit public dependency was found.

PRE and POST real RPC smoke passed: schedule create/update/complete; hotel
reservation, actual 016 check-in/checkout/reversal, 016B recovery, finalize,
preassign/cancel; daycare create/check-in/out; split-payment sale/payment/refund;
Long Stay confirmation/check-in/outing/return/checkout; Shared allocation/member
check-in/out/history; journal draft/best-friend/complete.
These are bounded scenarios, not all variants in the requested full matrix.

## Release blocker

Completed Daycare removal preview fails after genuine create/check-in/out RPCs.
The Daycare business record is ALLOW, but its normal operation_schedule_dogs audit
is UNKNOWN / UNRESOLVED_STRUCTURED_IDENTITY. The audit entity_id is the link UUID;
the business record key is its schedule UUID. The classifier accepts an entity
only if entity_id occurs among business record keys, so these legitimate distinct
identities do not match. after_data contains the correct dog_id and schedule_id.
The same predicate exists in captured current V2-A and the V2-B candidate; this is
an inherited coverage gap, not evidence of Production drift or a newly introduced
V2-B regression. No function/guard was changed to bypass it.

domain_removal.sql fails on its first history-removal eligibility assertion.
Later removal assertions in that file have NOT executed. The removal command is
not reached. On connection termination the transaction rolls back: schedule,
daycare, removal receipt and non-active dog counts are all zero. This is scenario
transaction rollback evidence, NOT command fault-injection rollback coverage.

Inactive/removed full-domain negatives, post-removal historical preservation,
real-RPC concurrency/deadlock matrix, fault-injected command rollback and measured
performance remain incomplete. Earlier lightweight concurrency results must not
be substituted for this current-baseline real-RPC matrix. Release/Production apply
remain blocked; candidate and existing 81 migrations are unchanged.
