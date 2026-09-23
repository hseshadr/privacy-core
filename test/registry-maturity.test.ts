import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("registry maturity (supply-chain cooldown)", () => {
  it("refuses dependency releases younger than 24 hours, with no exemptions", () => {
    // pnpm 11.5.0 happens to default to 1440 as well, but a default is not a
    // policy: it can change under a toolchain bump, and `pnpm config get
    // minimumReleaseAge` reports `undefined` while it is in force. Declaring it
    // makes the cooldown a fact of this repo that this test can hold.
    const workspace = parse(
      readFileSync(
        resolve(import.meta.dirname, "../pnpm-workspace.yaml"),
        "utf8",
      ),
    ) as Readonly<Record<string, unknown>>;

    expect(workspace.minimumReleaseAge).toBe(1440);
    expect(workspace.minimumReleaseAgeExclude).toBeUndefined();
    expect(workspace.minimumReleaseAgeStrict).toBeUndefined();
  });

  it("allows lifecycle scripts only for the reviewed native toolchain", () => {
    const workspace = parse(
      readFileSync(
        resolve(import.meta.dirname, "../pnpm-workspace.yaml"),
        "utf8",
      ),
    ) as Readonly<Record<string, unknown>>;

    expect(workspace.onlyBuiltDependencies).toBeUndefined();
    expect(workspace.allowBuilds).toEqual({
      "@biomejs/biome": true,
      esbuild: true,
    });
    expect(workspace.overrides).toMatchObject({
      nanoid: ">=3.3.17 <4",
      postcss: ">=8.5.18",
    });
  });
});
