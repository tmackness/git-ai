# AGENTS.md

Instructions for AI coding agents working in this repo.

## What this project is

`gitai` is a small CLI that:

1. optionally stages the paths you name on the command line (`gitai .`, `gitai src/foo.ts`),
2. asks an LLM to write a Conventional Commit message from the *already staged* diff,
3. lets you confirm, edit, or regenerate the draft,
4. then commits via `git commit -F -`.

It's a published npm package. Package name: `git-ai`. **Binary name: `gitai`** (no dash). They differ on purpose — keep that distinction whenever you touch `package.json` or docs.

## Tech stack — pin this in mind

- **Language:** TypeScript with `"strict": true`. `noUnusedLocals` and `noUnusedParameters` are on.
- **Module system:** ESM (`"type": "module"`). Internal imports use `.js` extensions even though sources are `.ts` (NodeNext resolution).
- **Runtime:** Node.js ≥ 20. **Do not introduce Bun APIs** — the original `index.ts` used Bun and was rewritten specifically to drop that dependency.
- **Package manager:** **pnpm**, not npm. `packageManager` is pinned in `package.json` and CI uses `pnpm/action-setup`. **Do not run `npm install`** — it would create a `package-lock.json` that conflicts with `pnpm-lock.yaml`.
- **Testing:** [vitest](https://vitest.dev/) with both unit tests and one integration suite (`tests/git.test.ts`) that creates a real temp git repo per test.
- **AI SDK:** `ai@^4` + several `@ai-sdk/*@^1` packages + `@ai-sdk/openai-compatible@^0.2`. **The v4 API uses `maxTokens`, not `maxOutputTokens`** — v5 renamed it.
- **CLI parsing:** `node:util` `parseArgs` with `allowPositionals: true`. No commander/yargs.
- **Color:** `picocolors` wrapped in `src/colors.ts` so it can be turned off in tests (and respects `NO_COLOR` / TTY detection automatically).

## Commands

```sh
pnpm install              # install deps (uses pnpm-lock.yaml)
pnpm run typecheck        # tsc --noEmit
pnpm test                 # vitest run
pnpm run test:watch       # vitest in watch mode
pnpm run build            # clean dist/, tsc, chmod +x dist/cli.js
node dist/cli.js --help   # smoke-test the built binary
```

## Repo layout

```
src/
  cli.ts        entry: shebang + thin runner that calls main()
  main.ts       CLI orchestration (arg parsing, top-level flow, color/branding). Exports main(argv, streams) — streams is injected for testability.
  config.ts     constants, PROVIDERS table, model id parsing/validation, listProviders()
  format.ts     pure helpers: diff truncation, message cleaning, prompt building
  git.ts        cross-platform git wrappers via node:child_process spawnSync
  generate.ts   AI SDK streamText wrapper + lazy provider instantiation (switch on provider key)
  editor.ts     external editor launch (cross-platform)
  prompt.ts     interactive yes/no/edit/regen prompt (readline)
  colors.ts     picocolors wrapper with setColorEnabled() so tests can disable
tests/
  setup.ts      called by vitest setupFiles; sets setColorEnabled(false)
  *.test.ts     one file per src module; main.test.ts covers end-to-end CLI paths that don't hit network
.github/workflows/
  ci.yml        matrix: {ubuntu, macos, windows} × {node 20, 22}
  publish.yml   triggered by GitHub Release; verifies tag matches package.json version; publishes via npm Trusted Publishing (OIDC)
```

## Behavior contract — read before changing CLI surface

- **`gitai` (no args)** commits whatever is already staged. If nothing is staged, prints a friendly hint and exits 0 — *not* an error.
- **`gitai <path>...`** runs `git add -- <path>...` first, then commits. The `--` separator is mandatory in our git wrapper so paths starting with `-` don't get parsed as flags.
- **There is no `--no-add` flag** anymore. The user *always* controls staging. This is a deliberate design choice — the original Bun implementation auto-staged everything and the redesign explicitly dropped that.
- **`-m`** beats **`GITAI_MODEL`** beats **`DEFAULT_MODEL`**. Don't add a config file unless asked.

## Adding a new provider

1. If it has a native `@ai-sdk/*` package: `pnpm add @ai-sdk/<provider>`. Then:
   - Add the import + `case` in the switch in `src/generate.ts`.
   - Add the entry to `PROVIDERS` in `src/config.ts` (no `baseURL`).
2. If it's OpenAI-compatible (custom baseURL, no native SDK):
   - Add the entry to `PROVIDERS` in `src/config.ts` *with* a `baseURL`. No code change in `generate.ts` needed — the `default:` branch handles it via `createOpenAICompatible`.
3. If it doesn't need an API key (like Ollama): set `apiKeyRequired: false`.
4. Add a row to the README provider table.
5. Add a case to the `it.each(...)` test in `tests/config.test.ts`.

## Cross-platform constraints — non-negotiable

The package must work on macOS, Linux, **and Windows**. CI runs all three.

- **Never use shell strings.** Pass args as arrays to `spawnSync` with `shell: false`. Avoids quoting bugs and command injection.
- **Never use Unix-only paths.** Use `path.join`, `os.tmpdir`.
- **Editor defaults differ by platform:** `notepad` on `win32`, `vi` elsewhere. Resolved in `src/editor.ts:defaultEditor`. `resolveEditor` takes platform as a parameter so it's unit-testable.
- **`chmod +x` in `postbuild`** is a no-op on Windows but doesn't error — leave it.
- **Git integration tests** (`tests/git.test.ts`) `git init` a fresh temp repo and configure `user.email`/`user.name`/`commit.gpgsign=false` per-test. Don't rely on the host's git config.
- **Colors** are turned off in tests via `tests/setup.ts`. If you add assertions on stdout/stderr substrings, you don't have to worry about ANSI escape codes leaking in.

## Style rules

- **No comments unless the WHY is non-obvious.** Don't restate what the code does.
- **No defensive validation at internal boundaries.** Trust types. Validate only user input / external APIs.
- **No feature flags or "for future use" abstractions.** YAGNI.
- **No emojis** in code or commits unless explicitly requested. (The `sym` table in `src/colors.ts` uses a few Unicode glyphs like `✓` and `✦` for styled output — these are not emoji and are allowed.)
- **Don't add docstrings** for self-explanatory functions.

## Things that have bitten people before

- **AI SDK v4 vs v5 API drift.** v4 uses `maxTokens`. v5 renamed it to `maxOutputTokens`. If you bump major, rename it.
- **Lazy provider instantiation.** `src/generate.ts` only constructs the model the user picked. Don't move the `createOpenAICompatible` calls to module scope — startup time would suffer for users who never touch those providers.
- **Vitest with chdir.** `tests/git.test.ts` chdirs into a temp dir per test. Vitest runs tests within a file serially, so this is safe — but don't add parallel-within-file chdir tests in other files.
- **Shebang preservation.** `tsc` preserves the `#!/usr/bin/env node` line at the top of `src/cli.ts`. Don't remove it. `postbuild` makes the output executable.
- **Bin vs package name.** Bin is `gitai`, package is `git-ai`. Don't "fix" the discrepancy without asking.

## How to test changes

```sh
pnpm run typecheck && pnpm test
```

For local end-to-end:

```sh
pnpm run build
cd /tmp && mkdir t && cd t && git init -b main && echo hi > x.txt && git add x.txt
OPENAI_API_KEY=sk-... node /path/to/git-ai/dist/cli.js -y
```

## How to release

1. Bump `version` in `package.json` on `main`.
2. Push, then create a GitHub Release with tag `v<version>` (matching exactly — the publish workflow refuses to publish if `package.json` version and the tag disagree).
3. The workflow runs typecheck + tests + build, then publishes with `npm publish` using GitHub Actions OIDC.

One-time npm setup:

1. Publish the package once manually if it does not exist on npm yet.
2. Configure npm Trusted Publishing for GitHub Actions:
   - owner/repository: `tmackness/git-ai`
   - workflow filename: `publish.yml`
3. Confirm `package.json` repository metadata exactly matches the GitHub repo.

Do not add an `NPM_TOKEN` secret for publishing. Trusted Publishing grants a short-lived publish credential only to the trusted workflow and produces provenance automatically for public packages from public repos.
