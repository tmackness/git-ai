import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEFAULT_MODEL,
  listProviders,
  validateModel,
  type ValidatedModel,
} from "./config.js";
import { loadConfig } from "./configFile.js";
import {
  allModelOptions,
  hasProviderConfig,
  type ModelOption,
} from "./modelOptions.js";
import {
  isGitRepo,
  repoRoot,
  hasCommits,
  addPaths,
  hasStagedChanges,
  stagedDiff,
  stagedFiles,
  stagedSummary,
  commitWithMessage,
} from "./git.js";
import { generateMessage } from "./generate.js";
import { detectReleasePlease, type ReleasePleaseContext } from "./releasePlease.js";
import { editInEditor } from "./editor.js";
import { ask, selectFromList, selectFromSections } from "./prompt.js";
import { runSetupWizard } from "./setup.js";
import { c, sym } from "./colors.js";

export const HELP = `${c.bold("gitai")} — AI-generated git commits

${c.bold("Usage:")}
  gitai [paths...] [options]

  With no paths, gitai commits whatever is already staged.
  With paths, gitai stages those paths first (passed straight to ${c.cyan("git add")}),
  then commits. Use ${c.cyan("gitai .")} to stage everything in the working tree.

${c.bold("Options:")}
  -y, --yes              commit the first message without confirming
  -m, --model <id>       '<provider>:<model>' id (default: ${c.cyan(DEFAULT_MODEL)})
                         can also be set via ${c.cyan("GITAI_MODEL")} env var
                         omit <id> to choose from a model list
  -p, --prompt <hint>    extra context for the model
      --providers        list bundled providers and their env vars
      --setup            save a default model and API key
      --release-please   force release-please commit guidance
      --no-release-please
                         disable release-please auto-detection
  -h, --help             show this help
  -v, --version          show version

${c.bold("Examples:")}
  ${c.dim("# commit what's already staged (you ran `git add` yourself):")}
  gitai

  ${c.dim("# stage everything, then commit:")}
  gitai .

  ${c.dim("# stage one path, then commit:")}
  gitai src/foo.ts

  ${c.dim("# auto-accept the first draft using a faster model:")}
  gitai -y -m groq:llama-3.3-70b-versatile

  ${c.dim("# save a default model and API key instead of exporting env vars:")}
  gitai --setup

${c.bold("Environment:")}
  ${c.cyan("GITAI_CONFIG")}            path to saved setup config
  ${c.cyan("GITAI_MODEL")}             default model id (overridden by -m)
  ${c.cyan("<PROVIDER>_API_KEY")}      api key for whichever provider you use (see --providers)
  ${c.cyan("CLOUDFLARE_ACCOUNT_ID")}   account id for Cloudflare AI Gateway
  ${c.cyan("CLOUDFLARE_AI_GATEWAY_ID")} gateway id for Cloudflare AI Gateway (default: default)
  ${c.cyan("EDITOR / VISUAL")}         editor for the [e]dit option (default: vi / notepad)
  ${c.cyan("NO_COLOR")}                set to disable color output`;

export interface Streams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
}

const defaultStreams = (): Streams => ({
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
});

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function header(modelId: string): string {
  return `${c.bold(c.cyan("gitai"))} ${c.dim(`${sym.sparkle} ${modelId}`)}`;
}

function renderFileSummary(rawNameStatus: string): string {
  const lines = rawNameStatus.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return "";
  const styled = lines.map((line) => {
    const m = /^(\S+)\s+(.+)$/.exec(line);
    if (!m) return `  ${c.dim(line)}`;
    const status = m[1] ?? "";
    const path = m[2] ?? "";
    const tag =
      status.startsWith("A") ? c.green(status) :
      status.startsWith("D") ? c.red(status) :
      status.startsWith("M") ? c.yellow(status) :
      status.startsWith("R") ? c.magenta(status) :
      c.cyan(status);
    return `  ${tag}  ${path}`;
  });
  return styled.join("\n");
}

function renderInitialSummary(rawSummary: string): string {
  const lines = rawSummary.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return `  ${c.dim("(no stat summary)")}`;
  return lines.map((line) => `  ${c.dim(line)}`).join("\n");
}

interface PreparedArgs {
  args: string[];
  selectModel: boolean;
}

export function prepareArgs(argv: string[]): PreparedArgs {
  const args: string[] = [];
  let selectModel = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if ((arg === "-m" || arg === "--model") && (!argv[i + 1] || argv[i + 1]!.startsWith("-"))) {
      selectModel = true;
      continue;
    }
    args.push(arg);
  }

  return { args, selectModel };
}

function renderModelOption(option: ModelOption): string {
  const keyHint =
    option.spec.apiKeyRequired === false ? "no API key" : option.spec.envVar;
  return `${option.modelId.padEnd(58)} ${c.dim(option.spec.label)} ${c.dim(`(${keyHint})`)}`;
}

type CommitAction = "commit" | "edit" | "try-again" | "instruct" | "abort";

interface CommitActionOption {
  action: CommitAction;
  label: string;
  description: string;
}

function commitActions(): CommitActionOption[] {
  return [
    { action: "commit", label: "Commit", description: "use this message" },
    { action: "edit", label: "Edit", description: "open the message in your editor" },
    { action: "try-again", label: "Try Again", description: "regenerate without extra instructions" },
    { action: "instruct", label: "Instruct", description: "add guidance and regenerate" },
    { action: "abort", label: "Abort", description: "do not commit" },
  ];
}

function renderCommitAction(option: CommitActionOption): string {
  return `${option.label.padEnd(10)} ${c.dim(option.description)}`;
}

function renderReleasePleaseStatus(
  detected: ReleasePleaseContext | undefined,
  enabled: ReleasePleaseContext | undefined,
  force: boolean,
  disabled: boolean,
): string | null {
  if (enabled?.detected) {
    const sourceText = enabled.sources.length > 0
      ? c.dim(` ${sym.bullet} ${enabled.sources.join(", ")}`)
      : "";
    const mode = force ? c.cyan("forced") : c.green("enabled");
    return `${c.magenta(sym.sparkle)} ${c.bold("release-please")} ${mode}${sourceText}`;
  }

  if (disabled && detected?.detected) {
    return `${c.yellow(sym.cross)} ${c.bold("release-please")} ${c.yellow("detected, disabled")} ${c.dim(`(${detected.sources.join(", ")})`)}`;
  }

  if (disabled) {
    return `${c.yellow(sym.cross)} ${c.bold("release-please")} ${c.yellow("disabled")}`;
  }

  return null;
}

async function chooseCommitAction(): Promise<CommitAction> {
  const selected = await selectFromList(
    "Choose next action:",
    commitActions(),
    renderCommitAction,
  );
  return selected?.action ?? "abort";
}

async function chooseModel(
  env: NodeJS.ProcessEnv,
  savedConfig: ReturnType<typeof loadConfig>,
): Promise<string | null> {
  const models = allModelOptions();
  const configured = models.filter((option) =>
    hasProviderConfig(option, env, savedConfig),
  );
  const remaining = models.filter((option) =>
    !hasProviderConfig(option, env, savedConfig),
  );
  const sections = [
    configured.length > 0 ? { label: "Configured", items: configured } : undefined,
    remaining.length > 0 ? { label: "Not configured", items: remaining } : undefined,
  ].filter((section): section is { label: string; items: ModelOption[] } => Boolean(section));

  const selected = await selectFromSections(
    "Choose a model:",
    sections,
    renderModelOption,
  );
  return selected?.modelId ?? null;
}

export async function main(
  argv: string[] = process.argv.slice(2),
  streams: Streams = defaultStreams(),
): Promise<number> {
  const { stdout, stderr, env } = streams;
  const prepared = prepareArgs(argv);
  const die = (msg: string, code = 1): number => {
    stderr.write(`${c.red(c.bold("gitai:"))} ${msg}\n`);
    return code;
  };

  let parsed;
  try {
    parsed = parseArgs({
      args: prepared.args,
      options: {
        yes: { type: "boolean", short: "y", default: false },
        model: { type: "string", short: "m" },
        prompt: { type: "string", short: "p" },
        providers: { type: "boolean", default: false },
        setup: { type: "boolean", default: false },
        "release-please": { type: "boolean" },
        "no-release-please": { type: "boolean" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
      allowPositionals: true,
    });
  } catch (err) {
    return die((err as Error).message);
  }
  const values = parsed.values;
  const positionals = parsed.positionals;

  if (values.help) {
    stdout.write(HELP + "\n");
    return 0;
  }

  if (values.version) {
    stdout.write(readPackageVersion() + "\n");
    return 0;
  }

  if (values.providers) {
    stdout.write(`${c.bold("Bundled providers")} ${c.dim("(use as `<provider>:<model>` with -m)")}\n\n`);
    stdout.write(listProviders() + "\n");
    return 0;
  }

  if (values.setup) {
    return runSetupWizard({ stdout, stderr, env });
  }

  const forceReleasePlease = values["release-please"] === true;
  const disableReleasePlease = values["no-release-please"] === true;
  if (forceReleasePlease && disableReleasePlease) {
    return die("use either --release-please or --no-release-please, not both");
  }

  const savedConfig = loadConfig(env);
  const selectedModel = prepared.selectModel ? await chooseModel(env, savedConfig) : undefined;
  if (prepared.selectModel && !selectedModel) {
    return die("no model selected");
  }
  const modelId =
    selectedModel ??
    (values.model as string | undefined) ??
    env.GITAI_MODEL ??
    savedConfig.defaultModel ??
    DEFAULT_MODEL;

  let validated: ValidatedModel;
  try {
    validated = validateModel(modelId);
  } catch (err) {
    return die((err as Error).message);
  }

  const { spec } = validated;
  for (const [key, value] of Object.entries(savedConfig.env ?? {})) {
    if (!env[key]) {
      process.env[key] = value;
    }
  }
  const apiKey = env[spec.envVar] ?? savedConfig.apiKeys?.[spec.envVar];
  if (apiKey) {
    process.env[spec.envVar] = apiKey;
  }
  for (const requiredEnvVar of spec.requiredEnvVars ?? []) {
    const value = env[requiredEnvVar] ?? savedConfig.env?.[requiredEnvVar];
    if (!value) {
      return die(
        `${c.bold(requiredEnvVar)} is not set (required for model "${modelId}"). Run ${c.cyan("gitai --setup")} to save it instead.`,
      );
    }
    process.env[requiredEnvVar] = value;
  }
  for (const optionalEnvVar of spec.optionalEnvVars ?? []) {
    const value = env[optionalEnvVar] ?? savedConfig.env?.[optionalEnvVar];
    if (value) {
      process.env[optionalEnvVar] = value;
    }
  }
  if (spec.apiKeyRequired !== false && !apiKey) {
    return die(
      `${c.bold(spec.envVar)} is not set (required for model "${modelId}"). Run ${c.cyan("gitai --setup")} to save it instead.`,
    );
  }

  if (!isGitRepo()) return die("not inside a git repository");

  const root = repoRoot();

  if (positionals.length > 0) {
    addPaths(positionals);
  }

  if (!hasStagedChanges()) {
    stderr.write(
      `${c.yellow("nothing to commit")} ${c.dim("— stage files with `git add <path>` first, or run `gitai .` to stage everything")}\n`,
    );
    return 0;
  }

  const initialCommit = !hasCommits();
  const diff = initialCommit ? "" : stagedDiff();
  const files = initialCommit ? stagedSummary() : stagedFiles();
  const detectedReleasePlease = detectReleasePlease(root, initialCommit ? "" : files);
  const releasePlease: ReleasePleaseContext | undefined =
    forceReleasePlease && !detectedReleasePlease?.detected
      ? {
          detected: true,
          sources: ["--release-please"],
          packagePaths: [],
          releaseTypes: [],
          changelogTypes: [],
          affectedPackages: [],
        }
      : detectedReleasePlease?.detected
        ? disableReleasePlease ? undefined : detectedReleasePlease
        : undefined;
  const releasePleaseStatus = renderReleasePleaseStatus(
    detectedReleasePlease,
    releasePlease,
    forceReleasePlease,
    disableReleasePlease,
  );
  let hint = values.prompt as string | undefined;
  const printChunk = (chunk: string) => stdout.write(c.dim(chunk));

  stdout.write(`\n${header(modelId)}\n\n`);
  stdout.write(
    initialCommit
      ? `${c.bold("Initial commit summary")}\n${renderInitialSummary(files)}\n\n`
      : `${c.bold("Staged files")}\n${renderFileSummary(files)}\n\n`,
  );
  if (releasePleaseStatus) {
    stdout.write(`${releasePleaseStatus}\n\n`);
  }
  stdout.write(`${c.dim(`${sym.arrow} generating commit message...`)}\n\n`);

  let message = await generateMessage({ modelId, diff, files, hint, releasePlease, initialCommit, onChunk: printChunk });
  stdout.write("\n");

  while (!values.yes) {
    const choice = await chooseCommitAction();
    if (choice === "commit") break;
    if (choice === "abort") {
      stdout.write(c.dim("aborted\n"));
      return 0;
    }
    if (choice === "edit") {
      message = editInEditor(message);
      stdout.write(`\n${c.bold("Edited message")}\n${message}\n`);
      continue;
    }
    if (choice === "try-again" || choice === "instruct") {
      if (choice === "instruct") {
        const instruction = await ask(`\n${c.cyan("?")} ${c.bold("Instruction for next draft:")} `);
        if (instruction) {
          hint = hint ? `${hint}\n${instruction}` : instruction;
        }
      }
      const label = choice === "instruct" ? "regenerating with instructions..." : "regenerating...";
      stdout.write(`\n${c.dim(`${sym.arrow} ${label}`)}\n\n`);
      message = await generateMessage({ modelId, diff, files, hint, releasePlease, initialCommit, onChunk: printChunk });
      stdout.write("\n");
      continue;
    }
  }

  if (!message) return die("empty commit message");

  commitWithMessage(message);
  stdout.write(`\n${c.green(sym.check)} ${c.bold("committed")}\n`);
  return 0;
}
