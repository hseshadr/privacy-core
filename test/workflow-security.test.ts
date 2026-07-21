// GitHub Actions must resolve third-party code from immutable commits.
//
// A `uses:` reference pinned to a moving tag (`@v7`) or a branch (`@main`)
// lets whoever controls that upstream ref run arbitrary code in this repo's
// CI. A full 40-hex commit SHA cannot be repointed, so the code we audited
// is the code that runs. This is the TypeScript twin of the portfolio's
// tests/test_workflow_security.py.
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

interface Use {
  readonly file: string;
  readonly ref: string;
}

function scanWorkflows(): readonly Use[] {
  const uses: Use[] = [];
  const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"));
  for (const file of files) {
    const yaml = readFileSync(join(WORKFLOWS, file), "utf8");
    for (const match of yaml.matchAll(USES)) {
      const ref = match[1];
      if (ref !== undefined) uses.push({ file, ref });
    }
  }
  return uses;
}

describe("GitHub Actions supply chain", () => {
  it("finds workflows to scan (guards against a vacuous pass)", () => {
    const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"));
    expect(files.length).toBeGreaterThan(0);
    expect(scanWorkflows().length).toBeGreaterThan(0);
  });

  it("pins every external action to a full commit SHA", () => {
    const unpinned = scanWorkflows()
      .filter(({ ref }) => !isImmutable(ref))
      .map(({ file, ref }) => `${file}: ${ref}`);
    expect(unpinned).toEqual([]);
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
