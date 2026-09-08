## What changed and why

<!-- 1-3 sentences. Link the Day ID card if this is a build-loop PR, e.g. docs/cards/D0XX.md -->

## Self-review checklist

This checklist is the CC8 (change-management) evidence for this change — it records that the
author reviewed their own diff before asking anyone else to, not just that CI is green.

- [ ] I re-read my own diff, file by file, before requesting review.
- [ ] `pnpm lint` passes locally.
- [ ] `pnpm typecheck` passes locally.
- [ ] `pnpm test` passes locally.
- [ ] `pnpm test:isolation` passes locally, if this change touches `packages/db` or tenant-scoped
      code.
- [ ] New dependencies (if any) are justified in this description.
- [ ] No secrets, credentials, or card data are introduced (hosted fields only — see
      `docs/design/07`).
- [ ] Prices/totals affected by this change are recomputed server-side, never trusted from a
      client payload.
- [ ] Commit message(s) follow Conventional Commits.

## Security check

<!-- Answer the card's security question here, if this PR corresponds to a build card. -->
