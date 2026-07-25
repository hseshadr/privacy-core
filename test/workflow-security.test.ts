// A workflow is executable code holding this repo's token and secrets. This
// file is the security gate on that surface, and it covers the three distinct
// ways such a workflow gets turned against the repo:
//
//   1. SUPPLY CHAIN — a `uses:` ref pinned to a moving tag (`@v7`) or a branch
//      (`@main`) lets whoever controls that upstream ref run arbitrary code in
//      this repo's CI. A full 40-hex commit SHA cannot be repointed, so the
//      code we audited is the code that runs.
//   2. TOKEN SCOPE — a workflow with no top-level `permissions:` block inherits
//      the repository default, which may be read-WRITE. Declaring a read-only
//      scope at the top means a compromised step cannot push code or cut a
//      release. A single job may still request a narrower write scope for
//      itself (publish.yml needs `id-token: write` for OIDC) — that is the
//      least-privilege pattern, not a violation, so only the top level is read.
//   3. SCRIPT INJECTION — interpolating attacker-controlled text (a PR title, a
//      branch name) anywhere in a workflow lets that text run as code. Those
//      values must reach a step through `env:`, never through `${{ }}`.
//      Relatedly, `pull_request_target` hands a privileged token and the repo's
//      secrets to code from an untrusted fork.
//
// This file previously checked ONLY (1) while being named for all of it, so an
// insecure change to (2) or (3) landed green. Each rule below is paired with
// its own accept/reject cases so the rule itself is proven, not assumed.
// This is the TypeScript twin of a shared workflow-security test.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOWS = fileURLToPath(
  new URL("../.github/workflows", import.meta.url),
);

// Matches `uses: <ref>` / `- uses: <ref>`, stopping before a trailing comment.
const USES = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm;

// owner/repo[/sub/path]@<40 lowercase hex>
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/;

/** Local (`./`) actions ship in this commit, so they need no pin. */
const isImmutable = (ref: string): boolean =>
  ref.startsWith("./") || PINNED.test(ref);

/**
 * Contexts an outside contributor controls the text of. `github.event.*` covers
 * PR titles and issue bodies; `github.head_ref` is the source branch name.
 */
const UNTRUSTED_INTERPOLATION =
  /\$\{\{[^}]*\b(?:github\.event\b|github\.head_ref\b)[^}]*\}\}/;

/** Runs against a fork's code WITH the base repo's token and secrets. */
const PRIVILEGED_UNTRUSTED_TRIGGER = /\bpull_request_target\b/;

/**
 * The value of the top-level `permissions:` key — any inline value plus every
 * following indented or comment line, stopping at the next column-0 key. Job
 * scopes live under `jobs:` and are deliberately NOT captured.
 */
const topLevelScope = (yaml: string): string | null =>
  /^permissions:(.*(?:\n[ \t#].*)*)/m.exec(yaml)?.[1] ?? null;

/** An explicit top-level scope that grants no write anywhere. */
const hasReadOnlyTopLevelScope = (yaml: string): boolean => {
  const scope = topLevelScope(yaml);
  return scope !== null && scope.trim() !== "" && !/\bwrite\b/.test(scope);
};

interface Use {
  readonly file: string;
  readonly ref: string;
}

interface Workflow {
  readonly file: string;
  readonly yaml: string;
}

function readWorkflows(): readonly Workflow[] {
  return readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith(".yml"))
    .map((file) => ({
      file,
      yaml: readFileSync(join(WORKFLOWS, file), "utf8"),
    }));
}

function scanWorkflows(): readonly Use[] {
  const uses: Use[] = [];
  for (const { file, yaml } of readWorkflows()) {
    for (const match of yaml.matchAll(USES)) {
      const ref = match[1];
      if (ref !== undefined) uses.push({ file, ref });
    }
  }
  return uses;
}

describe("GitHub Actions supply chain", () => {
  it("finds workflows to scan (guards against a vacuous pass)", () => {
    expect(readWorkflows().length).toBeGreaterThan(0);
    expect(scanWorkflows().length).toBeGreaterThan(0);
  });

  it("pins every external action to a full commit SHA", () => {
    const unpinned = scanWorkflows()
      .filter(({ ref }) => !isImmutable(ref))
      .map(({ file, ref }) => `${file}: ${ref}`);
    expect(unpinned).toEqual([]);
  });
});

describe("GitHub Actions token scope", () => {
  it("gives every workflow an explicit read-only top-level scope", () => {
    const overscoped = readWorkflows()
      .filter(({ yaml }) => !hasReadOnlyTopLevelScope(yaml))
      .map(({ file }) => file);
    expect(overscoped).toEqual([]);
  });
});

describe("GitHub Actions untrusted input", () => {
  it("never interpolates attacker-controlled context into a workflow", () => {
    const injectable = readWorkflows()
      .filter(({ yaml }) => UNTRUSTED_INTERPOLATION.test(yaml))
      .map(({ file }) => file);
    expect(injectable).toEqual([]);
  });

  it("never runs untrusted fork code under a privileged trigger", () => {
    const privileged = readWorkflows()
      .filter(({ yaml }) => PRIVILEGED_UNTRUSTED_TRIGGER.test(yaml))
      .map(({ file }) => file);
    expect(privileged).toEqual([]);
  });
});

describe("the token-scope rule itself", () => {
  it.each([
    ["no permissions block at all", "name: CI\non:\n  push:\njobs:\n  a:\n"],
    ["an empty permissions block", "permissions:\njobs:\n  a:\n"],
    ["a blanket write-all", "permissions: write-all\njobs:\n  a:\n"],
    ["a top-level write grant", "permissions:\n  contents: write\njobs:\n"],
    [
      "one write hidden among reads",
      "permissions:\n  contents: read\n  packages: write\njobs:\n",
    ],
  ])("rejects %s", (_label, yaml) => {
    expect(hasReadOnlyTopLevelScope(yaml)).toBe(false);
  });

  it.each([
    ["a read-only scope", "permissions:\n  contents: read\njobs:\n  a:\n"],
    ["an inline read-all", "permissions: read-all\njobs:\n  a:\n"],
    [
      "several read grants with a comment",
      "permissions:\n  contents: read\n  # needed for the PR API\n  pull-requests: read\njobs:\n",
    ],
    [
      // The real publish.yml shape: read at the top, write scoped to one job.
      "a job-level write under a read-only top level",
      "permissions:\n  contents: read\njobs:\n  publish:\n    permissions:\n      id-token: write\n",
    ],
  ])("accepts %s", (_label, yaml) => {
    expect(hasReadOnlyTopLevelScope(yaml)).toBe(true);
  });
});

// These fixtures are GitHub Actions expressions, not JavaScript interpolation.
// They are written as template literals with an escaped `\${` so the `${{ ... }}`
// is a literal two-brace Actions expression and never a JS placeholder.
describe("the untrusted-input rule itself", () => {
  it.each([
    ["a PR title", `run: echo "\${{ github.event.pull_request.title }}"`],
    ["an issue body", `run: echo \${{ github.event.issue.body }}`],
    ["a source branch name", `run: git checkout \${{ github.head_ref }}`],
    ["padded whitespace", `run: echo \${{   github.event.comment.body   }}`],
  ])("rejects %s", (_label, yaml) => {
    expect(UNTRUSTED_INTERPOLATION.test(yaml)).toBe(true);
  });

  it.each([
    ["a secret", `env:\n  GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}`],
    ["a repository name", `run: echo \${{ github.repository }}`],
    ["a commit SHA", `run: echo \${{ github.sha }}`],
    ["plain text mentioning the word event", "run: echo 'the event ran'"],
  ])("accepts %s", (_label, yaml) => {
    expect(UNTRUSTED_INTERPOLATION.test(yaml)).toBe(false);
  });
});

describe("the pin rule itself", () => {
  it.each([
    ["a moving major tag", "actions/checkout@v7"],
    ["an exact version tag", "actions/checkout@v7.0.0"],
    ["a branch", "actions/checkout@main"],
    ["a short SHA", "actions/checkout@9c091bb"],
    // 39 hex — one short of a real SHA.
    [
      "a truncated SHA",
      "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e",
    ],
    [
      "an uppercase SHA",
      "actions/checkout@9C091BB21B7C1C1D1991BB908D89E4E9DDDFE3E0",
    ],
    ["no ref at all", "actions/checkout"],
  ])("rejects %s", (_label, ref) => {
    expect(isImmutable(ref)).toBe(false);
  });

  it.each([
    [
      "a pinned action",
      "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
    ],
    [
      "a pinned reusable workflow with a subpath",
      "hseshadr/ci/.github/workflows/ts-publish.yml@36bf999acd0617135497b62605e19bed29ee1b94",
    ],
    ["a local action", "./.github/actions/setup"],
  ])("accepts %s", (_label, ref) => {
    expect(isImmutable(ref)).toBe(true);
  });

  it("flags an unpinned ref that appears alongside pinned ones", () => {
    const refs = [
      "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
      "pnpm/action-setup@v6",
    ];
    expect(refs.filter((r) => !isImmutable(r))).toEqual([
      "pnpm/action-setup@v6",
    ]);
  });

  it("extracts refs from real workflow syntax, ignoring comments", () => {
    const yaml = [
      "      - uses: actions/checkout@abc # v7",
      "        uses: pnpm/action-setup@def",
      "      # uses: not/a-real@ref",
    ].join("\n");
    const refs = [...yaml.matchAll(USES)].map((m) => m[1]);
    expect(refs).toEqual(["actions/checkout@abc", "pnpm/action-setup@def"]);
  });
});
