# LEVEXx — GitHub Engineering Context
Snapshot: 2026-10-12
Repository: levexlia/LEVEXx
Default branch: main
Visibility: public

> This document is a repository-facing context handoff. Live GitHub state always wins over this snapshot.

## 1. What LEVEXx is
LEVEXx is the canonical greenfield implementation of the LEVEX platform.

LEVEX is designed as a server-authoritative platform that can support multiple clients:
- Web
- Mobile
- future 3D game client
- controlled AI subsystems

The central domain loop is:
Quest → Artifact → Evaluation → Evidence → Mastery → Progression.

## 2. Architectural boundary
The platform should evolve toward:

apps/
  api/
  worker/               # when current architecture authorizes it

packages/
  domain/
  application/
  infrastructure/
  contracts/            # only when justified

tests/
docs/
scripts/

Rules:
- Domain cannot depend on infrastructure, HTTP or AI providers.
- Application orchestrates use cases and transaction boundaries.
- Infrastructure implements database/storage/adapters.
- Routes/controllers remain thin.
- Critical state is server-authoritative.
- AI proposes; Domain decides.

## 3. Accepted architecture on main
Read `docs/architecture/adr/` before implementation.

Accepted:
- ADR-001 modular monolith / PostgreSQL / RLS / outbox / audit
- ADR-002 Domain authority for Mastery/Progression
- ADR-003A greenfield canonical implementation
- ADR-004 immutable/version-linked evidence and evaluation history
- ADR-005 transaction/outbox/idempotency boundary
- ADR-006 online-only critical mutation policy
- ADR-007 AI optional and disabled by default

Do not silently contradict these.

## 4. Current PR topology
As of this snapshot:

PR #1
`[EXPERIMENTAL / HOLD] LEVEX Kernel v0 future candidate`
- contains a pure TypeScript Domain candidate;
- includes QuestAttempt, Artifact, Evaluation, Evidence, Mastery, Progression;
- verified within its bounded branch scope;
- must not be merged/released while HOLD is active.

PR #2
`[EXPERIMENTAL / HOLD] Kernel PostgreSQL persistence future candidate`
- stacked on the Kernel candidate;
- adds application command orchestration and PostgreSQL persistence;
- includes atomic receipts/audit/outbox work and extensive persistence/concurrency tests;
- must not be merged/released while HOLD is active.

PR #3
`P0.2–P0.3 Slice 1: DB roles and Identity/Auth containment (A1)`
- active canonical engineering track at snapshot time;
- implements bounded identity/auth database containment;
- has deterministic CI/security/delivery evidence for its current scope;
- merge remains governed by protected-main requirements and review policy;
- inspect live PR state before any action.

PR #4/#5
Disposable regression/protection proofs; closed without merge. They are evidence, not production branches.

## 5. Why Kernel is on hold
The project deliberately chose to secure identity/authorization/database containment before allowing the game Kernel to become canonical.

This prevents a technically correct mastery engine from being built on an unsafe actor/permission foundation.

Do not interpret HOLD as “bad code”; interpret it as dependency sequencing.

## 6. Product semantics engineers must preserve
Core:
QUEST → ACTION → ARTIFACT → EVIDENCE → RUBRIC → EVALUATION → DOMAIN VALIDATION → MASTERY → PROGRESSION → WORLD STATE CHANGE.

Rules:
- Evidence before reward.
- Explanation before adaptation.
- Safety before autonomy.
- An artifact is not proof of human mastery by itself.
- Mastery needs traceable provenance.
- Repeated requests must not duplicate critical rewards.
- historical accepted/finalized evidence must not be silently mutated.

## 7. 3D / client integration
Do not put canonical mastery/world access logic inside Unity or Unreal.

Future pattern:
LEVEX Platform
→ API/events
→ 3D Client

Example:
`physics_district = unlocked`
is canonical server state.

The 3D client responds by:
- opening the gate;
- changing collision/navigation;
- playing animation/VFX/audio;
- exposing new NPCs/quests.

Current preferred advanced 3D candidate: Unreal Engine.
Final engine decision remains requirements-driven.

## 8. Language direction
Core platform:
- TypeScript
- Node.js
- PostgreSQL / SQL

Web:
- TypeScript / React / HTML / CSS

Likely advanced 3D:
- Unreal Engine
- C++
- Blueprints

C# is only central if Unity becomes the selected 3D runtime.

## 9. Git workflow
Significant changes:
1. inspect exact main;
2. inspect accepted ADRs/current active PRs;
3. branch from correct base;
4. implement minimal scope;
5. run format/lint/typecheck/tests/architecture/security checks applicable to scope;
6. capture evidence;
7. open PR;
8. respect required reviews/protected-main checks;
9. do not merge held/experimental work without explicit authorization.

## 10. Status vocabulary
Use:
FACT
INFERENCE
PROPOSAL
ASSUMPTION
EVIDENCE
MISSING
BLOCKED
SUPERSEDED

Delivery state:
IMPLEMENTED
TESTED
VERIFIED
ACCEPTED

Never collapse these into “done”.

## 11. Security / privacy
Repository is public.

Never commit:
- secrets
- access tokens
- database passwords
- private keys
- real user personal data
- confidential safety/legal records

Authorization must be enforced server-side and, where architecture specifies, through PostgreSQL RLS/structural constraints.

## 12. Next-order roadmap
Current dependency order should be decided from live project governance, but the long-term technical direction is:

Identity/Auth foundation
→ policy/consent/actor context
→ authorization/RLS verification
→ canonical Kernel integration
→ artifact/evidence pipeline
→ application/API surface
→ AI mentor/evaluation adapters
→ web vertical slice
→ first bounded 3D vertical slice
→ broader world/social/economy systems

Do not jump to open-world production before the core evidence-to-progression loop is reliable.
