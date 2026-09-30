# HANDOFF — Platform Lead — RESUME Slice 1 after BLOCKED-F01

**STATUS:** RESUME AUTHORIZED\
**Repository:** `levexlia/LEVEXx`\
**Canonical baseline:** `702a320a6981b7b2fb541de1e1e3925758541ac2`

BLOCKED-F01 is resolved at specification level by Director Amendment A1 after targeted Security review.

## Implement only Slice 1

```text
DB security/roles
-> actors
-> accounts
-> role_assignments
-> approved trigger guards
-> migrations
-> runtime privilege/migration/unit/security tests
-> evidence
```

Approved inventory additions:

- `levex_private.guard_account_binding()` — trigger, SECURITY INVOKER, owner db_owner.
- `levex_private.guard_role_assignment()` — trigger, SECURITY INVOKER, owner db_owner.

Use the exact mandatory containment and staged migration ordering in the attached Security Disposition.

Important sequencing:

- attach immutable/history guards in Slice 1;
- do NOT expose premature app_runtime account/role writes;
- BOOTSTRAP is only canonical migrator -> SET ROLE db_owner;
- when actor-context phase later introduces `current_actor_id()`, replace the role guard in place before runtime role-write grants;
- do not add a fifth role or RLS bypass;
- do not convert either guard to SECURITY DEFINER;
- do not implement cohort/guardian/consent in this slice.

Return:

- changed files;
- migrations;
- grants/ownership;
- trigger/function catalog state;
- tests and actual results;
- evidence;
- unresolved risks;
- exact commit/PR SHA.

Statuses must remain separate:
IMPLEMENTED / TESTED / VERIFIED / ACCEPTED.

Platform does not self-declare VERIFIED or ACCEPTED.
