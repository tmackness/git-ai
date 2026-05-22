# gitai

AI-generated git commit messages from the command line. Drafts a Conventional Commit message from your staged diff, streams it in real time, and lets you confirm, edit, or regenerate before it commits.

## Quickstart

```sh
# 1. install
pnpm add -g @tma10011/git-ai     # or: npm i -g @tma10011/git-ai

# 2. save a default model and API key
gitai --setup

# 3. in a git repo, stage your changes and commit
cd ~/my-project
git add src/foo.ts        # you control what goes in
gitai                     # AI writes the message

# ...or do both in one shot:
gitai .                   # stage everything, then commit
gitai src/                # stage one path, then commit
```

When `gitai` runs it streams the message and opens an action picker:

```
Choose next action:
Use ↑/↓ and Enter to select.
› Commit     use this message
  Edit       open the message in your editor
  Try Again  regenerate without extra instructions
  Instruct   add guidance and regenerate
  Abort      do not commit
```

- **Commit** — use this message
- **Edit** — open the message in `$EDITOR` (default: `vi` on macOS/Linux, `notepad` on Windows)
- **Try Again** — discard and stream a new draft
- **Instruct** — add guidance, then stream a new draft
- **Abort** — stop without committing

## Common flags

```sh
gitai                            # commit what's already staged
gitai .                          # `git add .`, then commit
gitai src/foo.ts src/bar.ts      # `git add src/foo.ts src/bar.ts`, then commit
gitai -y                         # accept the first draft, no prompt
gitai -m anthropic:claude-3-5-haiku-latest    # pick a different model
gitai -m                         # choose from configured models first, then all others
gitai -m cloudflare:openai/gpt-4o-mini        # route through Cloudflare AI Gateway
gitai -p "fixes the flaky timeout"            # extra context for the model
gitai --release-please          # force release-please-aware commit guidance
gitai --no-release-please       # disable release-please auto-detection
gitai --providers                # list every bundled provider and its env var
gitai --setup                    # save a default model and API key
gitai --help                     # full flag list
```

In a repository with no commits yet, `gitai` treats the staged changes as an initial commit and sends the model a bounded staged summary instead of buffering the full first diff. That keeps `gitai .` usable even when a new repo accidentally stages a large import.

## Release Please

`gitai` writes Conventional Commits by default, which already works well with release automation. When a repo uses [release-please](https://github.com/googleapis/release-please), `gitai` detects it and gives the model stricter guidance about release impact before drafting the message.

Detection looks for:

- `release-please-config.json`
- `.release-please-manifest.json`
- `.github/workflows/*.yml` or `.yaml` files that reference release-please

When enabled, `gitai` nudges the draft toward release-please-friendly messages:

- `feat:` for user-visible new capability, usually a minor release
- `fix:` for user-visible bug fixes, usually a patch release
- `perf:` for user-visible performance improvements
- `docs:`, `test:`, `chore:`, `ci:`, `build:`, `refactor:`, and `style:` only when that is the real change type
- `type(scope)!:` plus a `BREAKING CHANGE:` footer only when the staged diff clearly introduces incompatible behavior

For monorepos with a release-please manifest, `gitai` also passes configured package paths and affected packages into the prompt so scopes are more likely to match the component being released.

The CLI prints whether release-please guidance is enabled, forced, or disabled before generating the commit message. Use `--release-please` for repos with unusual release-please setup that auto-detection misses, or `--no-release-please` when you want the plain Conventional Commit prompt.

## Bundled providers

The `--model` flag is `<provider>:<model>`. Run `gitai --setup` to choose a default model and save its API key, or set the matching env var yourself. Run `gitai --providers` to see this list any time.

| Provider                    | Env var                         | Example                                  |
| --------------------------- | ------------------------------- | ---------------------------------------- |
| `openai`                    | `OPENAI_API_KEY`                | `openai:gpt-4o-mini` _(default)_         |
| `anthropic`                 | `ANTHROPIC_API_KEY`             | `anthropic:claude-3-5-haiku-latest`      |
| `google`                    | `GOOGLE_GENERATIVE_AI_API_KEY`  | `google:gemini-1.5-flash`                |
| `mistral`                   | `MISTRAL_API_KEY`               | `mistral:mistral-small-latest`           |
| `groq`                      | `GROQ_API_KEY`                  | `groq:llama-3.3-70b-versatile`           |
| `xai`                       | `XAI_API_KEY`                   | `xai:grok-2-latest`                      |
| `deepseek`                  | `DEEPSEEK_API_KEY`              | `deepseek:deepseek-chat`                 |
| `kimi` _(Moonshot)_         | `MOONSHOT_API_KEY`              | `kimi:moonshot-v1-8k`                    |
| `qwen` _(DashScope)_        | `DASHSCOPE_API_KEY`             | `qwen:qwen-plus`                         |
| `minimax`                   | `MINIMAX_API_KEY`               | `minimax:MiniMax-Text-01`                |
| `openrouter`                | `OPENROUTER_API_KEY`            | `openrouter:anthropic/claude-3.5-sonnet` |
| `cloudflare` _(AI Gateway)_ | `CLOUDFLARE_AI_GATEWAY_API_KEY` | `cloudflare:openai/gpt-4o-mini`          |
| `ollama` _(local)_          | _(none)_                        | `ollama:llama3.2`                        |

Set a different default without typing `-m` every time:

```sh
export GITAI_MODEL=groq:llama-3.3-70b-versatile
```

`GITAI_MODEL` and real environment variables take precedence over saved setup values. `gitai --setup` stores config in your OS config directory, or the path in `GITAI_CONFIG` when set.

Cloudflare AI Gateway uses model ids like `cloudflare:<provider>/<model>`, for example `cloudflare:openai/gpt-4o-mini` or `cloudflare:workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The picker includes Cloudflare's OpenAI-compatible providers: Anthropic, OpenAI, Groq, Mistral, Cohere, Perplexity, Workers AI, Google AI Studio, Google Vertex AI, xAI/Grok, DeepSeek, Cerebras, Baseten, and Parallel. It also needs `CLOUDFLARE_ACCOUNT_ID`; `CLOUDFLARE_AI_GATEWAY_ID` defaults to `default` when omitted. The setup wizard can save these values so you do not have to export them in your shell.

## Why use it

- **You control staging.** No more `git add .` surprises — `gitai` only commits what you've staged. Pass paths to stage in one step (`gitai src/foo.ts`).
- **Streams in real time.** You watch the message form as the model writes it.
- **Confirm before commit.** Every message is shown and approved by you.
- **Conventional Commits out of the box.** The system prompt enforces `type(scope): subject` formatting.
- **Covers broad diffs.** Multi-change commits get a body that calls out the notable features, fixes, docs, tests, and build/config changes.
- **Flexible provider setup.** Switch between direct provider keys, Cloudflare AI Gateway, Ollama, and more with a flag.
- **Cross-platform.** macOS, Linux, Windows — all tested in CI.

## Requirements

- Node.js 20+
- `git` on your `PATH`
- An API key for at least one bundled provider (or a local Ollama instance)

## Configuration

| Variable                           | Purpose                                                    |
| ---------------------------------- | ---------------------------------------------------------- |
| `GITAI_CONFIG`                     | path to the saved `gitai --setup` JSON config              |
| `GITAI_MODEL`                      | default model id (overridden by `-m`)                      |
| `<PROVIDER>_API_KEY`               | api key for whichever provider you use (see `--providers`) |
| `CLOUDFLARE_ACCOUNT_ID`            | account id for `cloudflare:*` models                       |
| `CLOUDFLARE_AI_GATEWAY_ID`         | gateway id for `cloudflare:*` models (default: `default`)  |
| `CLOUDFLARE_AI_GATEWAY_API_KEY`    | Cloudflare AI Gateway token for `cloudflare:*` models      |
| `GIT_EDITOR` / `VISUAL` / `EDITOR` | editor for the `[e]dit` option (precedence in that order)  |
| `NO_COLOR`                         | set to disable all color output                            |

## Development

```sh
git clone git@github.com:tmackness/git-ai.git
cd git-ai
pnpm install
pnpm run typecheck
pnpm test         # full vitest suite (unit + git integration)
pnpm run build    # compile to dist/
node dist/cli.js --help
```

Source layout:

```
src/
  cli.ts        # entry: shebang + thin runner
  main.ts       # CLI orchestration: arg parsing, prompt loop, color/branding
  config.ts     # provider registry + system prompt
  configFile.ts # saved setup config
  format.ts     # pure helpers: diff truncation, message cleaning
  git.ts        # cross-platform git wrappers (child_process)
  generate.ts   # AI SDK streaming, lazy provider resolution
  editor.ts     # external editor launch
  prompt.ts     # interactive yes/no/edit/regen prompt
  setup.ts      # setup wizard
  colors.ts     # picocolors wrapper with on/off switch
tests/          # vitest suites mirroring src/
```

## License

MIT — see [LICENSE](LICENSE).
