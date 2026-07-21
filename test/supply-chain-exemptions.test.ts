import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// pnpm's `minimumReleaseAge` cooldown is a supply-chain control: it refuses to
// install a version published less than N minutes ago — the window in which a
// compromised release is usually caught and unpublished. pnpm v11 ships that
// cooldown ON by default (1440 minutes / 24h) but evaluates it in NON-STRICT
// mode, so a plain (non-frozen) `pnpm install` does not fail. It appends the
// tripped package to an exemption list in pnpm-workspace.yaml:
//
//   minimumReleaseAgeExclude:
//     - '@edgeproc/avow@0.1.0'
//
// The install still exits 0, so the developer is left holding a modified
// workspace file that rides along in the next `git commit -a`. That is exactly
// how the key reached this repo's `main`, and it has slipped into commits
// elsewhere in this portfolio and been reverted twice.
//
// A committed exemption permanently disables the cooldown for the listed
// packages — in CI too — so a compromised fresh release of those packages
// installs without resistance. First-party packages are NOT a safe carve-out:
// a first-party exemption is still an unmonitored hole, and carving out
// first-party refs is precisely what concealed a live supply-chain gap
// elsewhere in this portfolio. This guard fails the gate the moment the key
// reappears as an active setting.

const testDir = dirname(fileURLToPath(import.meta.url));
const workspaceFile = resolve(testDir, "..", "pnpm-workspace.yaml");

/** The pnpm setting that opts a package OUT of the release-age cooldown. */
const EXEMPTION_KEY = "minimumReleaseAgeExclude";

/** Matches the exemption as a YAML key at any indentation. */
const EXEMPTION_KEY_LINE = new RegExp(`^\\s*${EXEMPTION_KEY}\\s*:`);

/** A `#`-prefixed line is inert to pnpm, so it documents the ban, not a breach. */
function isComment(line: string): boolean {
  return line.trimStart().startsWith("#");
}

/**
 * 1-based line numbers at which `minimumReleaseAgeExclude` appears as an ACTIVE
 * YAML key. Comment lines are ignored so this file may name the key freely.
 */
function findExemptionLines(yaml: string): number[] {
  const hits: number[] = [];
  yaml.split("\n").forEach((line, index) => {
    if (!isComment(line) && EXEMPTION_KEY_LINE.test(line)) {
      hits.push(index + 1);
    }
  });
  return hits;
}

/** The actionable remediation shown when the guard trips. */
function remediation(lines: readonly number[]): string {
  return [
    `\`${EXEMPTION_KEY}\` is committed in pnpm-workspace.yaml`,
    `(line ${lines.join(", ")}). It must NEVER be committed.`,
    "",
    "WHY IT IS THERE: pnpm v11 enables the `minimumReleaseAge` cooldown by",
    "default (1440 minutes) but runs it in non-strict mode, so ANY non-frozen",
    "`pnpm install` auto-appends this key and still exits 0. It was almost",
    "certainly added by a local install, not on purpose.",
    "",
    "WHAT IT BREAKS: it permanently disables the release-age supply-chain",
    "cooldown for every package listed under it, so a compromised fresh",
    "release of those packages installs without resistance — in CI too.",
    "",
    "A FIRST-PARTY PACKAGE IS NOT AN EXCEPTION. Exempting our own packages is",
    "the same hole; it just hides behind a trusted name.",
    "",
    "HOW TO REMOVE: delete the whole `minimumReleaseAgeExclude:` block (the",
    "key and its `- 'pkg@version'` entries) from pnpm-workspace.yaml, then run",
    "`pnpm install --frozen-lockfile` — it must report 'Already up to date'.",
    "",
    "The cooldown firing is the control WORKING. Wait the release window out.",
    "Never exempt a package to turn a gate green.",
  ].join("\n");
}

describe("pnpm supply-chain exemptions", () => {
  it("are absent from the committed workspace config", () => {
    const yaml = readFileSync(workspaceFile, "utf8");
    const lines = findExemptionLines(yaml);
    expect(lines, remediation(lines)).toEqual([]);
  });

  it("are detected in the block form pnpm injects", () => {
    const injected = [
      "packages:",
      '  - "."',
      `${EXEMPTION_KEY}:`,
      "  - '@edgeproc/avow@0.1.0'",
    ].join("\n");
    expect(findExemptionLines(injected)).toEqual([3]);
  });

  it("are detected as an inline flow mapping", () => {
    const inline = `${EXEMPTION_KEY}: ['@edgeproc/avow@0.1.0']`;
    expect(findExemptionLines(inline)).toEqual([1]);
  });

  it("are detected when nested under indentation", () => {
    const nested = ["settings:", `  ${EXEMPTION_KEY}:`, "    - 'x@1.0.0'"].join(
      "\n",
    );
    expect(findExemptionLines(nested)).toEqual([2]);
  });

  it("are not reported when the key appears only in a comment", () => {
    const documented = [
      "packages:",
      '  - "."',
      `# never commit ${EXEMPTION_KEY} here`,
    ].join("\n");
    expect(findExemptionLines(documented)).toEqual([]);
  });

  it("do not confuse `minimumReleaseAge` with the exclude list", () => {
    const cooldownOnly = ["minimumReleaseAge: 1440"].join("\n");
    expect(findExemptionLines(cooldownOnly)).toEqual([]);
  });
});
