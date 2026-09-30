# LEVEX Director Reconciliation — BLOCKED-F01 / Amendment A1

**Date:** 2026-09-26\
**Stage:** P0.2–P0.3 Slice 1\
**Status:** **RESUME AUTHORIZED**

## Inputs

- Platform Lead blocker report `BLOCKED-F01`.
- Platform Lead targeted Security proposal.
- Final Platform Implementation Specification P0.2–P0.3 v1.2.
- Targeted Security disposition for BLOCKED-F01.

## Director decision

Security approved the minimal trigger-inventory amendment with mandatory containment and staged migration ordering.

No Frozen Product Contract change is required.

No canonical Architecture change is required.

No ADR change is required.

No Owner decision is required.

## Canonical amendment

Final Platform Implementation Specification P0.2–P0.3 v1.2 is amended by **A1**:

1. Add:
   - `levex_private.guard_account_binding()`
   - `levex_private.guard_role_assignment()`
2. Both are `SECURITY INVOKER`, owner `db_owner`, trigger-returning functions.
3. Runtime/public direct EXECUTE is not granted.
4. Slice 1 installs guards but exposes no premature runtime role/account mutation authority.
5. Runtime role-attribution logic is activated only after actor-context helpers exist and before runtime grants.
6. BOOTSTRAP writes are limited to canonical migrator -> `SET ROLE db_owner` provisioning.
7. Required trigger/attribution tests are added to the QA execution contract with initial status `NOT RUN`.

## Lifecycle status

- Implementation authorization: **ACTIVE**
- BLOCKED-F01: **RESOLVED AT SPECIFICATION LEVEL**
- Slice 1 implementation: **RESUME AUTHORIZED**
- Implementation: **NOT IMPLEMENTED until code exists**
- Testing: **NOT RUN**
- Verification: **NOT VERIFIED**
- Acceptance: **NOT ACCEPTED**
- Pilot/Production readiness: **NOT CLAIMED**

## Next action

Platform Lead resumes only Slice 1:

```text
DB security/roles
-> actors
-> accounts
-> role_assignments
-> trigger guards
-> migrations
-> first-slice tests/evidence
```

Platform Lead returns code/migrations/test evidence and does not self-declare VERIFIED or ACCEPTED.
