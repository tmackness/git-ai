import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ReleasePleaseContext {
  readonly detected: boolean;
  readonly sources: readonly string[];
  readonly packagePaths: readonly string[];
  readonly releaseTypes: readonly string[];
  readonly changelogTypes: readonly string[];
  readonly affectedPackages: readonly string[];
}

interface ReleasePleaseConfig {
  packages?: Record<
    string,
    {
      "release-type"?: string;
      "package-name"?: string;
      component?: string;
      "changelog-types"?: Array<{ type?: string; section?: string; hidden?: boolean }>;
    }
  >;
  "release-type"?: string;
  "package-name"?: string;
  component?: string;
  "changelog-types"?: Array<{ type?: string; section?: string; hidden?: boolean }>;
}

const emptyContext: ReleasePleaseContext = {
  detected: false,
  sources: [],
  packagePaths: [],
  releaseTypes: [],
  changelogTypes: [],
  affectedPackages: [],
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function safeReadJson(path: string): ReleasePleaseConfig | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ReleasePleaseConfig;
  } catch {
    return null;
  }
}

function detectWorkflow(repoRootPath: string): string[] {
  const workflowsDir = join(repoRootPath, ".github", "workflows");
  if (!existsSync(workflowsDir)) return [];

  return readdirSync(workflowsDir)
    .filter((name) => /\.(ya?ml)$/i.test(name))
    .filter((name) => {
      const path = join(workflowsDir, name);
      if (!statSync(path).isFile()) return false;
      const body = readFileSync(path, "utf8");
      return /release-please|googleapis\/release-please-action/.test(body);
    })
    .map((name) => `.github/workflows/${name}`);
}

function changedFilePaths(nameStatus: string): string[] {
  return nameStatus
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const fields = line.split("\t");
      if (fields.length >= 3 && /^[CR]/.test(fields[0] ?? "")) return fields.at(-1) ?? "";
      if (fields.length >= 2) return fields[1] ?? "";
      return line.trim().split(/\s+/).at(-1) ?? "";
    })
    .filter(Boolean);
}

function affectedPackagePaths(packagePaths: readonly string[], stagedNameStatus: string): string[] {
  const files = changedFilePaths(stagedNameStatus);
  return packagePaths.filter((packagePath) => {
    if (packagePath === ".") return files.length > 0;
    const normalized = packagePath.replace(/\/+$/, "");
    return files.some((file) => file === normalized || file.startsWith(`${normalized}/`));
  });
}

function packageLabel(path: string, config: ReleasePleaseConfig): string {
  if (path === ".") {
    return config.component ?? config["package-name"] ?? ".";
  }
  const pkg = config.packages?.[path];
  return pkg?.component ?? pkg?.["package-name"] ?? path;
}

export function detectReleasePlease(
  repoRootPath: string,
  stagedNameStatus = "",
): ReleasePleaseContext {
  const configPath = join(repoRootPath, "release-please-config.json");
  const manifestPath = join(repoRootPath, ".release-please-manifest.json");
  const hasConfig = existsSync(configPath);
  const hasManifest = existsSync(manifestPath);
  const workflowSources = detectWorkflow(repoRootPath);

  if (!hasConfig && !hasManifest && workflowSources.length === 0) {
    return emptyContext;
  }

  const config = hasConfig ? safeReadJson(configPath) : null;
  const packagePaths = config?.packages
    ? Object.keys(config.packages)
    : config?.["release-type"] || config?.["package-name"] || config?.component
      ? ["."]
      : [];
  const rootReleaseType = config?.["release-type"];
  const packageReleaseTypes = Object.values(config?.packages ?? {})
    .map((pkg) => pkg["release-type"])
    .filter((value): value is string => Boolean(value));
  const rootChangelogTypes = config?.["changelog-types"] ?? [];
  const packageChangelogTypes = Object.values(config?.packages ?? {}).flatMap(
    (pkg) => pkg["changelog-types"] ?? [],
  );
  const affectedPaths = affectedPackagePaths(packagePaths, stagedNameStatus);

  return {
    detected: true,
    sources: [
      ...(hasConfig ? ["release-please-config.json"] : []),
      ...(hasManifest ? [".release-please-manifest.json"] : []),
      ...workflowSources,
    ],
    packagePaths,
    releaseTypes: unique([rootReleaseType ?? "", ...packageReleaseTypes]),
    changelogTypes: unique(
      [...rootChangelogTypes, ...packageChangelogTypes]
        .filter((entry) => entry.hidden !== true)
        .map((entry) => entry.type ?? ""),
    ),
    affectedPackages: unique(affectedPaths.map((path) => packageLabel(path, config ?? {}))),
  };
}

export function renderReleasePleasePrompt(context: ReleasePleaseContext): string {
  const lines = [
    "This repository uses release-please.",
    "",
    "Release-please parses Conventional Commit messages to decide releases and changelog entries.",
    "Choose the commit type by actual release impact:",
    "- feat: user-visible new capability; usually a minor release",
    "- fix: user-visible bug fix; usually a patch release",
    "- perf: user-visible performance improvement; usually a patch release",
    "- docs, test, chore, ci, build, refactor, style: use only when that is the true change type; do not use feat/fix just to force a release",
    "- breaking changes: use ! after the type/scope and include a BREAKING CHANGE footer only when the staged diff clearly introduces incompatible behavior",
    "- never generate chore(release): messages for normal user commits",
  ];

  if (context.packagePaths.length > 0) {
    lines.push("", `Configured release package paths: ${context.packagePaths.join(", ")}`);
  }
  if (context.affectedPackages.length > 0) {
    lines.push(
      `Affected release package(s): ${context.affectedPackages.join(", ")}`,
      "Prefer a short scope matching the affected package/component when one package dominates.",
    );
  }
  if (context.releaseTypes.length > 0) {
    lines.push(`Release type(s): ${context.releaseTypes.join(", ")}`);
  }
  if (context.changelogTypes.length > 0) {
    lines.push(`Configured changelog type(s): ${context.changelogTypes.join(", ")}`);
  }

  return lines.join("\n");
}
