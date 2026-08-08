# Long Stay version conflict contract repair

## Decision

Manual `expected_version` mismatches in the seven Long Stay command RPCs use
`PT409`. Genuine PostgreSQL serialization failures continue to use `40001`.

PostgREST reserves `PTxyz` for a caller-selected HTTP status. `PT409` therefore
returns HTTP 409 while remaining outside PostgreSQL class `40` (transaction
rollback). It does not overlap the existing `23505` replay/payload contract.

## Scope

- `confirm_long_stay_month`
- `complete_long_stay_check_in`
- `start_long_stay_absence`
- `complete_long_stay_absence`
- `set_long_stay_planned_checkout`
- `complete_long_stay_check_out`
- `reverse_long_stay_completion`

Each function contains exactly one approved manual version guard. The package
replaces only the exact `using errcode='40001'` token in that guard. Signature,
return JSON, ACL, SECURITY DEFINER, search_path, replay, request IDs, audit,
locks, mutations, and every other SQLSTATE remain unchanged.

The frontend maps both `PT409` and genuine `40001` to the same stale-data UX.
The action handler refreshes the selected Contract, selected month, and Hotel
Snapshot before clearing the processing state.

## Expected PostgREST contract

| Source | SQLSTATE | HTTP | Client retry meaning |
| --- | --- | --- | --- |
| Manual Long Stay version mismatch | `PT409` | 409 | application conflict; no transaction retry |
| PostgreSQL serialization failure | `40001` | 500 | database transaction rollback; unchanged |
| Replay/payload conflict | `23505` | 409 | unchanged |

Reference: PostgREST custom errors support `PTxyz`, where `xyz` is the desired
HTTP status code.
