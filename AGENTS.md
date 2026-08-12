# Codex Guide: crawler

This repository crawls fashion SKU data and imports it into the shared kiko.ai database. The database schema is owned by `../kiko.ai-app`; crawler code writes to that contract.

## Stack

- Node.js 22+
- TypeScript, ESM, `tsx`
- pnpm
- Playwright for browser-based engines
- Supabase/PostgREST and R2/S3-compatible storage

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm crawl --list
pnpm crawl --probe=<platform-key>
pnpm crawl --site=<platform-key>
pnpm import:products
pnpm import:attributes
pnpm import:brand-nodes
```

Run crawler/import commands carefully. They may hit external sites or write to DB depending on flags and env.

## Qwen Import Hard Rule

- Category/subcategory normalization is part of a completed production import.
- Before any DB-writing `import:products`, onboarding, recollection, or candidate-refresh run, create the SSH forwards for both local Qwen endpoints and verify both `/v1/models` responses plus `pnpm smoke:qwen`.
- The current lab tunnel is `ssh -N -L 8001:127.0.0.1:8001 -L 8002:127.0.0.1:8002 kjk@100.70.101.17`.
- Never report an import complete when Qwen shows `unavailable`, `failed`, or `schema_failed`. `success=0 deferred=N` is a failed/incomplete run and must be retried after restoring the tunnel.
- `unchanged` is different: Qwen responded, but the safe patch policy preserved the existing official category. Report it separately from connection failures.
- Do not use `--allow-qwen-deferred` in normal or automated runs. It is an explicit incident-only escape hatch.

## Key Directories

- `src/configs/platforms.ts`: registered platform configs
- `src/lib/*-engine.ts`: platform engine implementations
- `src/lib/parsers/`: detail/review parser infrastructure
- `src/crawl.ts`: crawl entrypoint
- `src/import-*.ts`: DB import scripts
- `tests/`: Node test runner tests
- `docs/add-platform.md`: new platform guide
- `docs/operations.md`: operational guidance
- `.moai/specs/`: prior MoAI SPECs; use as important design and requirement context when touching related areas

## Development Rules

- Add new sites by updating `src/configs/platforms.ts` and reusing existing engines when possible.
- For a new engine type, add a focused implementation under `src/lib/` and tests around parsing/normalization.
- Keep platform-specific selectors and quirks in config or parser modules, not scattered through import code.
- DB schema changes should be made in `../kiko.ai-app/database/migrations/`, then crawler import code should follow.
- Do not commit `.env`, crawl output, or downloaded artifacts.
- Existing `.claude/`, `.moai/`, and `CLAUDE.md` contain important prior decisions, specs, workflow expectations, and domain context. Use them as project knowledge when relevant. Only translate or skip Claude-specific execution protocols that conflict with Codex, such as Claude subagent routing or Claude-only question/approval tools.

## Harness and Quality Policy

Mirror the MoAI harness intent from `.moai/config/sections/`:

- Development mode is DDD: analyze existing behavior, preserve it, then improve.
- Add or update characterization/parser tests before risky behavior changes when existing behavior is not already covered.
- Keep transformations small; avoid broad rewrites unless explicitly requested or necessary.
- Use minimal validation for docs/config/simple bugfixes, standard validation for platform additions/refactors or multi-file changes, and thorough validation for migrations, import scripts, security-sensitive fetch/URL handling, or DB-write paths.
- Escalate validation depth after any quality gate failure or critical review finding.
- Maintain zero new typecheck/test regressions. If a pre-existing failure blocks verification, report it clearly.
- Prefer behavior/spec tests with meaningful assertions over implementation-coupled tests.

## Validation

```bash
pnpm typecheck
pnpm test
```

For parser/platform work, also run a narrow probe when safe:

```bash
pnpm crawl --probe=<platform-key>
```

If a command would write to the shared DB or trigger broad crawling, ask for explicit user intent first.

## Git Policy

- Manual workflow: do not create branches, push, or open PRs unless the user asks.
- If asked to commit, use conventional commit style and keep the header near 72 chars.
- Do not use broad staging; stage only the files intended for the change.
