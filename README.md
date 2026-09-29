# LEVEXx

TypeScript modular monolith. Accepted architecture decisions are in
`docs/architecture/adr/`.

- Domain Kernel v0: `packages/domain/README.md`
- Scope and current-state review: `docs/architecture/kernel-v0-plan.md`
- Verification evidence: `docs/verification/kernel-v0.md`

Checks: `npm run format:check`, `npm run lint`, `npm run typecheck`,
`npm run architecture:check`, `npm run test:unit`, `npm run build`.
Database bootstrap regression checks require a disposable PostgreSQL instance:
set `DATABASE_URL`, run `npm run db:migrate`, then `npm run test:integration`.

Kernel v0 is server-only domain code; no domain mutation endpoint or persistent
kernel state is exposed by the bootstrap API.
