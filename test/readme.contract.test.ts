import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The portfolio README contract: it stops the README's first screen (title
 * down to "Try it in 60 seconds") drifting from the template. String and regex
 * checks only; it does not judge prose.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  description: string;
  version: string;
};

const at = (heading: string): number => {
  const index = readme.indexOf(`\n${heading}\n`);
  expect(index, heading).toBeGreaterThan(-1);
  return index;
};

describe("README contract", () => {
  const lines = readme.split("\n");

  it("opens with the title, then a plain tagline equal to the package description", () => {
    expect(lines[0]).toMatch(/^# \S/);
    const tagline = lines
      .slice(1)
      .find((line) => line.trim() !== "" && !line.startsWith("[!["));
    expect(tagline).toBe(pkg.description);
    expect(pkg.description.length).toBeLessThanOrEqual(120);
  });

  it("shows at most four badges before At a glance", () => {
    const firstScreen = readme.slice(0, at("## At a glance"));
    expect(firstScreen.split("[![").length - 1).toBeLessThanOrEqual(4);
  });

  it("carries every At a glance label, bolded exactly, on the first screen", () => {
    const firstScreen = readme.slice(0, at("## How it works"));
    for (const label of [
      "**What it does**",
      "**Who it's for**",
      "**What stays on your device / what leaves it**",
      "**Runs on**",
      "**Not for**",
      "**Status**",
    ]) {
      expect(firstScreen, label).toContain(label);
    }
  });

  it("puts the hero caption before the example, and the example before How it works", () => {
    const tryIt = at("## Try it in 60 seconds");
    expect(tryIt).toBeLessThan(at("## How it works"));
    const caption = readme.indexOf("Real output of the example below");
    expect(caption).toBeGreaterThan(-1);
    expect(caption).toBeLessThan(tryIt);
  });

  it("links the interactive architecture map, whose source exists", () => {
    expect(readme).toMatch(
      /\[[^\]]*Explore the interactive architecture map[^\]]*\]\(docs\/architecture\/index\.html\)/,
    );
    expect(
      existsSync(join(root, "docs/architecture/runtime.architecture.json")),
    ).toBe(true);
  });

  it("states the released version, and Beta while it is pre-1.0", () => {
    // The release workflow tags v<package.json version>, so this is the
    // latest pushed tag once a release is out.
    const status = lines.find((line) => line.startsWith("- **Status**"));
    expect(status).toContain(`v${pkg.version}`);
    if (pkg.version.startsWith("0.")) expect(status).toMatch(/— Beta\b/);
  });

  it("resolves every relative link to a file in the repo", () => {
    const targets = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map(
      (match) => match[1] ?? "",
    );
    const relative = targets.filter(
      (target) => !/^(?:[a-z]+:|#)/i.test(target),
    );
    expect(relative.length).toBeGreaterThan(0);
    for (const target of relative) {
      const path = target.split("#")[0] ?? "";
      expect(existsSync(join(root, path)), target).toBe(true);
    }
  });
});
