# V2-B single-function UTF-8 repair

## Scope

Append-only `202609180002_dog_profile_v2b_utf8_audit_repair.sql` replaces only
`public.audit_dog_edit_v2b()` with the exact function body extracted from committed
180001. The only definition syntax change is CREATE → CREATE OR REPLACE.
No application changes, grants, triggers, table changes or business DML.
Existing migrations are immutable. Do not replay 180001.

Expected contract: zero arguments, trigger return, PL/pgSQL, VOLATILE,
SECURITY DEFINER, `search_path=public, pg_temp`, owner postgres,
ACL exactly `postgres=X/postgres`.

- Captured damaged body MD5: `9e45267b41d50b3bb17b7b8fc5b5ac8c`.
- Approved body MD5: `01674a5ddc93c5467543d0f13e35aa92`.
- Approved reason: `Dog Master 정보 수정`.
- Migration SHA256: `a4c2f2f2ba4f211e3c9e604c8ee9364fb586ef929dd9a9289c7b1ddfc239f3d6`.
- Encoding: UTF-8, no BOM.

## Fail-closed transaction

Before DDL, require the exact signature (no overloads), metadata, owner/ACL,
required lifecycle columns, receipt/command/preview and enabled audit/lifecycle
triggers. Only the captured damaged hash may enter CREATE OR REPLACE.
The approved hash takes a genuine no-DDL path. Any third hash fails.

Before COMMIT, verify approved body hash, Korean sentinel, absence of U+FFFD,
and unchanged pg_proc metadata including OID/owner/ACL/signature/security/config.
Failure rolls back the replacement. No persistent repair helper is created.
Run during a schema-change-free maintenance window; this is not a general repair
service and does not coordinate with unrelated concurrent administrative DDL.

## UTF-8 delivery gate (separate execution approval required)

Prefer a direct approved DB client reading the UTF-8 file with `--file`,
`ON_ERROR_STOP=1` and UTF-8 client encoding. Do not copy credentials/tokens or
create a new access path just for this repair.

If an authorized SQL Editor session must be used:

1. Recompute the file SHA above immediately before transfer.
2. Avoid intermediate HTML where possible. Any HTML must explicitly declare
   `<meta charset="utf-8">`; any HTTP text response must specify UTF-8.
3. Read back the complete execution input through supported editor/clipboard UI.
   Compare its exact text/hash with the original (not just the last visible line).
4. Verify `Dog Master 정보 수정` and the approved hash literal in the readback.
5. If exact readback is unavailable or different, STOP; do not Run.
6. Execute once, then inspect the in-transaction assertions and a READ ONLY
   catalog postflight. Do not automatically repair a failed run.

The post-assertion independently catches encoding damage in the executable
literal even if the pre-execution delivery gate were to miss it.

## Isolated QA

`python3 supabase/tests/dog_profile_v2b_utf8_repair_qa.py CAPTURE.json --output /tmp/repair-qa`

The existing catalog builder creates a new Unix-socket-only cluster. Its catalog
is restored into an explicitly UTF8 database, seeded with synthetic data, then
170002/170003/180001 are applied locally. The script accepts no remote DSN.

Cases: damaged → exact approved; already approved with unchanged function xmin;
third body; wrong signature/return/security/search_path/owner/ACL/dependency;
damaged repair delivery → full rollback; real authenticated synthetic edit →
correct audit reason; removal followed by removed edit rejection; existing full
local removal matrix. All table rows and other catalog objects are compared
before/after repair. Runtime tests roll back separately.

Local environment: PostgreSQL 18.6 vs Production 17.6; synthetic auth boundary;
pg_stat_statements/vault absent. The repaired trigger uses neither extension.

## Production evidence and release state

READ ONLY preflight: PASS; body MD5 is the expected damaged value; server UTF8;
transaction_read_only=on. No Production repair executed in this task.
The earlier forensic object inventory found only this one differing audit reason.

Production repair and its exact catalog postflight remain pending. Push/deploy
remain blocked until repair succeeds. Existing frontend deletion stays suspended
through publication of the approved V2-B frontend. No actual removal command is
part of this repair or its Production postflight.
