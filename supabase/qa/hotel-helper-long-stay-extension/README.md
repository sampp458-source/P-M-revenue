# Hotel Helper Long Stay Extension — Clean QA Runbook

This package is isolated-QA only. Do not run it against production. Package
authoring does not authorize Clean QA execution.

## Required order

1. `hotel_qa.assert_isolated_environment()`
2. Run the existing public Golden capture unchanged:
   - `supabase/qa/hotel-helper-extraction/00_golden_contract_capture.sql`
   - `supabase/qa/hotel-helper-extraction/01_create_runtime_golden_capture.sql`
3. Export the normalized output as **before**.
4. Run extension Preflight and require
   `READY_TO_APPLY_HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION`.
5. Apply the extension Migration.
6. Run Postflight and require
   `HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION_READY`.
7. Run the same public Golden capture unchanged and export **after**.
8. Compare after normalizing only generated UUIDs and timestamps. Require
   `PUBLIC_CONTRACT_SEMANTIC_DIFF_0` and SQLSTATE/Audit/Replay Diff 0.
9. Run
   `202608070004_hotel_internal_helper_long_stay_extension_transaction_qa.sql`
   and require
   `HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION_TRANSACTION_QA_READY`.
10. Run the existing two-session Hotel concurrency harness, then the extension
    event-set competition described below.
11. Rehearse Rollback and verify original helper fingerprints:
    - prepare `471673afbfe5dfff9fcac28356b07603`
    - create `48d9146603c1462a02cb8df65458cc8f`
    - cross-type `2a344bee4a21279f1d6a4a7c4dac1445`
12. Reapply Preflight → Migration → Postflight.

## Golden exact fields

Compare return meaning, Stay version/state, Capacity range/type/count, Schedule
starts/ends/time-unspecified/description, Event/Assignee/Customer/Dog links,
Allocation segments, root and child Audit reason/request/changed_by, Replay, row
counts, and SQLSTATE. The normal Hotel graph remains exactly two Events.

## Extension fixture matrix

- checkout included → check-in 1, checkout 1;
- checkout excluded → check-in 1, checkout 0;
- required `check_in` → cross-type succeeds;
- required both → ordinary contract succeeds;
- duplicated requested kind → `22023`;
- missing or archived required event → `P0002`;
- failed call → no Stay/Capacity/Allocation/Schedule/Audit mutation.

## Two-session extension matrix

Use fixture dates reserved by the Hotel QA harness.

| Session A | Session B | Expected |
|---|---|---|
| check-in-only cross-type STANDARD→DELUXE | ordinary Hotel final DELUXE capacity reservation | one success or `23514`; no `40P01` |
| check-in-only move to room D1 | ordinary Hotel assignment to D1 | one success or `23P01`; no `40P01` |
| same internal request replay | same internal request replay | deterministic single result; no duplicate mutation |
| expected version N | competing mutation from version N | one success or `40001`; failed aggregate unchanged |

Lock acquisition must remain request → Stay → Capacity → Allocation → validated
Schedule rows → sorted Room Type → sorted Room → assertions/mutation. Record
server SQLSTATE and verify deadlock count zero and Hotel QA integrity ready.
