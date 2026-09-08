# Change Management Policy and Process

**Status:** Added 2026-09-08, describing the process as it actually exists — not a forward plan. Every mechanism named here is a real file, a real GitHub setting, or a real CI job in this repo as of D009. This is the evidence artifact `09`'s "Change management" control row points to.

## Principle

A change is trustworthy when the record of what was checked survives the change itself. Every mechanism below exists to make that record automatic — produced by the act of shipping, not written afterward to satisfy a reviewer.

## The change lifecycle

Every change, from a one-line fix to a full card, goes through the same shape:

```
work on a branch  →  local gate  →  commit (hooked)  →  push (hooked)  →  PR (checklist)  →  CI (backstop)  →  merge
```

### 1. Work happens on a branch, never directly on `main`

`main` is protected on GitHub (`origin` → `github.com/harley-bit/smb-commerce-os`): no direct push, no force-push, no branch deletion, **enforced for admins too** — there is no override button, including for the repo owner. This was verified for real, not just configured: a direct push to `main` was attempted from this repo and rejected (`GH006: Protected branch update failed for refs/heads/main`).

Card work under the token-maxing loop (`CLAUDE.md`) commits to local `main` directly — that's fine, because local git has no concept of GitHub's branch protection; it only applies when something is actually pushed. **As of 2026-09-08, `.claude/settings.json` permits any git operation, including push and remote**, by explicit founder decision (the project directory is the trust boundary now, not the operation) — but the loop's own prompt (`scripts/run_build_loop.py`'s `build_prompt()`) still only instructs it to commit locally, so in practice nothing has changed yet about *where* card commits land. And even if a session did push straight to `main`, GitHub's branch protection would still reject it (`GH006`, verified for real during D009) — a local permission grant doesn't change what the remote is willing to accept. See "Open item" below.

### 2. The local gate, before every commit

`pnpm lint && pnpm typecheck && pnpm test && pnpm test:isolation` — per `CLAUDE.md`'s build protocol, run before starting new work and before committing. Not a hook; a discipline every card and every manual change follows.

### 3. Git hooks — fast, local, and impossible to forget

Installed automatically by the root `package.json`'s `prepare` script (`git config core.hooksPath .githooks`), three hooks in `.githooks/`:

| Hook | Checks | Blocks on |
|---|---|---|
| `pre-commit` | `gitleaks protect --staged` | Any secret in staged changes |
| `commit-msg` | Conventional Commits format on the subject line | A message not matching `type(scope): description` |
| `pre-push` | `pnpm audit --audit-level=high`, then `semgrep scan --config p/security-audit --error` | Any high/critical dependency vulnerability, or any blocking SAST finding |

`pre-push` was added deliberately alongside this policy: `pnpm audit` and semgrep already ran in CI (D007, D008) and in the local test suite (as fixture-driven tests), but nothing stopped a vulnerable dependency or a flagged pattern from being *pushed* before this. Now it's caught on the developer's machine, before it ever reaches the remote — CI is the backstop for a bypassed or missing hook, not the first line.

All three hooks are tested the same way the rest of this project tests security tooling: by shelling out to the real script or the real binary, never a mock (`packages/config/test/{commit-message-format,secret-scanning,pre-push-hook}.test.ts`).

### 4. The pull request — the self-review checklist *is* the CC8 evidence

`.github/pull_request_template.md` (built in D009) is not a formality. Its self-review checklist is explicitly the change-management evidence an auditor would ask for: lint/typecheck/test/isolation passing, no unjustified new dependency, no secrets or card data touched, no client-trusted pricing, Conventional Commits used. Checking a box is asserting a fact about the change, recorded permanently in the PR's history.

### 5. CI — the backstop, not the first check

`.github/workflows/ci.yml`'s single job (`install, lint, typecheck, test`, per D005–D008) re-runs the full gate on every PR and every push to `main`: frozen-lockfile install, `pnpm audit --audit-level=high`, semgrep SAST, lint, typecheck, test, isolation, gitleaks (full-history scan, not just staged changes), and SBOM generation (retained 90 days). This is required to pass before merge — GitHub branch protection has `required_status_checks` naming this exact job, with `strict: true` (the branch must be up to date with `main` before merging, not just green in isolation).

Two real ordering/false-positive bugs were caught this way on this repo's *first* real push (PR #1) — see `docs/logs/D009.md` and the "Notes for next session" entries in `BUILD_STATE.md` for D008 (syft install ordering) and D006 (gitleaks flagging its own deliberate test fixture, fixed via `.gitleaks.toml`'s scoped allowlist). This is exactly what CI-on-a-real-push is for.

### 6. Merge — solo-maintainer reality, not a weakened control

`required_approving_review_count: 0`. This is deliberate, not an oversight: GitHub does not allow a PR author to approve their own PR, and this repo has one maintainer. Requiring `1` approval combined with `enforce_admins: true` would have made the repo **unmergeable** — no override path exists once admin enforcement is on. Requiring `0` approvals keeps every other control (PR required, CI required, no direct push, no force-push) while making solo self-merge possible. The day a second contributor exists, raising this to `1` is a one-line settings change, not a redesign — the audit trail (PR existence, checklist, CI result) is identical either way.

### 7. Rollback

Forward-only. A bad merge is corrected by a new PR containing a `git revert` commit, going through the same lifecycle above — never a force-push, never rewritten history. `allow_force_pushes: false` and `allow_deletions: false` on `main` make this the only path structurally, not just the recommended one.

## What counts as evidence, and where it lives

| Evidence | Location |
|---|---|
| What changed and why | PR description + commit messages (Conventional Commits, day ID where applicable) |
| What was checked before merge | PR self-review checklist (`.github/pull_request_template.md`) |
| Automated proof the checks actually ran | CI run history (GitHub Actions), linked from the required status check |
| Dependency inventory at merge time | SBOM artifact per CI run, retained 90 days |
| No secret was introduced | gitleaks output in the CI log, plus the pre-commit/pre-push hook having run locally |
| Who could have approved, and didn't need to | Branch protection settings themselves (`required_approving_review_count: 0`, documented here as a deliberate choice, not a gap) |

## Open item, tracked honestly

The loop's own commits (to local `main`) are still not part of this PR-gated flow in practice — they're covered by the local gate and the pre-commit/commit-msg hooks (pre-push doesn't fire on a local-only commit), but not by CI or the PR checklist until a human syncs local `main` to GitHub. The *permission* barrier to the loop doing this itself is gone (`.claude/settings.json` no longer denies push/remote), but the loop's own prompt was never changed to instruct it to push a branch or open a PR — that's a deliberate design question (should every card become its own PR? batched periodically? still a human's job?), not something that should change silently just because the permission exists. Whoever picks this up next should decide it explicitly and update `build_prompt()` accordingly, rather than assuming the loop already does this.

**Fixed, 2026-09-08 (same day it was found):** two real branch/worktree collisions happened — the automated loop and an interactive session shared one working directory, so the loop committed to whatever branch happened to be checked out at the moment it fired. Twice, an interactive session had checked out a feature branch for unrelated PR work, and the loop's next card (D010, then D011) landed there instead of on `main`. Both times the work was recovered by cherry-picking onto a fresh branch off `main` — nothing was lost, but catching it after the fact isn't a real fix.

**The actual fix:** a dedicated `git worktree` for the loop, at `../smb-commerce-os-loop`, permanently checked out to `main` — a worktree exclusively owns whatever branch it holds, so the primary interactive checkout can no longer check out local `main` at all (by git's own design, not a convention this project has to remember to follow). The LaunchAgent plist (`~/Library/LaunchAgents/com.smbcos.buildloop.plist`, machine-local, not in git) points `open_build_loop_terminal.sh` at the worktree path instead of the main repo path — the script's own content is unchanged, since `run_build_loop.py`'s `REPO` constant self-resolves from wherever it's actually invoked from. Practical consequence for anyone doing interactive branch work in the primary checkout: branch from `origin/main` directly (`git checkout -b my-branch origin/main`), never from a local `main` — there isn't one to branch from anymore, and that's the point. After merging a PR, fast-forward the *worktree* (`cd ../smb-commerce-os-loop && git fetch && git merge --ff-only origin/main`), not the primary checkout, to keep the loop's next run current.
