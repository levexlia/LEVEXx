# LEVEX Security Disposition — BLOCKED-F01

**Date:** 2026-09-26\
**Scope:** P0.2–P0.3 Slice 1 — trigger inventory conflict\
**Security stage:** INTERNAL TARGETED REVIEW\
**Disposition:** **APPROVED WITH MANDATORY CONDITIONS**\
**Implementation:** NOT IMPLEMENTED\
**Testing:** NOT RUN\
**Verification:** NOT VERIFIED\
**External security approval / pentest:** NOT CLAIMED

## Decision

The two trigger functions proposed by Platform Lead are approved as explicit additions to the `levex_private` function inventory:

| Function                                | Security           | Owner      | Attachment                                                            |
| --------------------------------------- | ------------------ | ---------- | --------------------------------------------------------------------- |
| `levex_private.guard_account_binding()` | `SECURITY INVOKER` | `db_owner` | `BEFORE UPDATE` on `levex.accounts`, `FOR EACH ROW`                   |
| `levex_private.guard_role_assignment()` | `SECURITY INVOKER` | `db_owner` | `BEFORE INSERT OR UPDATE` on `levex.role_assignments`, `FOR EACH ROW` |

They MUST NOT be converted to `SECURITY DEFINER`.

## Mandatory containment contract

Both functions:

- return `trigger`;
- use trusted `plpgsql`;
- are `SECURITY INVOKER`;
- are owned by `db_owner`;
- use `SET search_path = pg_catalog, levex_private, pg_temp`;
- schema-qualify LEVEX helper references;
- use no dynamic SQL;
- accept no ordinary arguments and no `TG_ARGV` authorization inputs;
- perform no base-table query and no table write;
- emit no sensitive values in errors;
- have `PUBLIC` EXECUTE revoked;
- receive no explicit `app_runtime` or `worker_runtime` EXECUTE grant;
- may only be attached to the exact inventoried table/event;
- do not grant DML authority and do not replace application authorization or RLS.

Runtime trigger behavior and privilege assumptions MUST be demonstrated on PostgreSQL 18.6 in tests before verification.

## `guard_account_binding()` exact behavior

On UPDATE it rejects any change to:

- `id`
- `actor_id`
- `provider`
- `provider_subject`
- `created_at`

Comparison is NULL-safe.

It does not create a new runtime account-update capability. Existing lifecycle constraints/version rules remain authoritative.

## `guard_role_assignment()` exact behavior

### Phase A — Slice 1 / before actor-context runtime writes

The function is attached immediately, but runtime role mutation remains fail-closed.

`BOOTSTRAP` INSERT is permitted only when both are true:

```text
session_user = migrator
current_user = db_owner
```

and the canonical BOOTSTRAP invariants hold, including `assigned_by_actor_id IS NULL`.

All non-migration INSERT/UPDATE paths that require actor attribution remain denied until actor-context helpers, RLS and runtime grants are installed.

### Phase B — actor-context migration

After canonical `current_actor_id()` exists, the same function is replaced in place with `CREATE OR REPLACE FUNCTION` before runtime role-write grants are introduced.

Runtime INSERT must require:

- source = `OPERATOR`;
- non-null validated current actor;
- `assigned_by_actor_id = current_actor_id()`.

Runtime revoke must require:

- canonical `ACTIVE -> REVOKED` transition;
- `revoked_by_actor_id = current_actor_id()`;
- valid revoke timestamp/version update.

The trigger does not prove operator authority by itself. Application authorization + RLS must independently allow the operation.

Reactivation/reuse of a REVOKED assignment is forbidden.

## Migration ordering amendment

Required ordering:

```text
Slice 1:
db security/roles
-> actors/accounts
-> role_assignments
-> immutable/history trigger guards attached
-> no runtime authority writes exposed

Later actor-context phase:
current_actor_id/current_actor_role/current_request_id
-> CREATE OR REPLACE guard_role_assignment with runtime attribution checks
-> RLS
-> runtime grants
```

No cohort/guardian/consent implementation is pulled into Slice 1 solely to make this amendment work.

## Required tests

All remain `NOT RUN` until concrete implementation exists.

- `TRIGGER-001` — exact catalog inventory, owner, security mode, search_path, ACL, attachment, enabled state.
- `TRIGGER-002` — every immutable account binding field rejects mutation.
- `TRIGGER-003` — every immutable role-history field rejects mutation; revoked assignment cannot reactivate.
- `ATTR-001` — forged assignment attribution rejected after actor context is enabled.
- `ATTR-002` — forged revocation attribution rejected after actor context is enabled.
- `TRIGGER-004` — runtime roles cannot create/replace/disable/drop trigger/function or assume owner/migrator authority.
- `TRIGGER-005` — body inventory proves no dynamic SQL, base-table query/write, privileged nested helper or RLS recursion.
- `TRIGGER-006` — runtime BOOTSTRAP spoof attempts fail; canonical migrator -> `SET ROLE db_owner` provisioning route works.
- `TRIGGER-007` — clean migration sequencing exposes no role-write path before prerequisites exist.
- `TRIGGER-008` — on PostgreSQL 18.6, direct runtime function EXECUTE remains absent while an otherwise authorized later runtime DML operation fires the attached trigger as designed.

Retain all existing DBROLE, RLS, migration rollback/recovery, uniqueness and historical QA requirements.

## Security conclusion

**BLOCKED-F01 security contract conflict: RESOLVED AT SPECIFICATION LEVEL.**

This is not implementation verification. No test has passed yet.

**Security targeted re-review:** PASS FOR AMENDMENT\
**External validation:** NOT PERFORMED / NOT CLAIMED
