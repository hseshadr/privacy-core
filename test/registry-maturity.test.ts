import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("continuous dependency resolution", () => {
  it("does not wait for a registry-age window", () => {
    const workspace = parse(
      readFileSync(
        resolve(import.meta.dirname, "../pnpm-workspace.yaml"),
        "utf8",
      ),
    ) as Readonly<Record<string, unknown>>;

    expect(workspace.minimumReleaseAge).toBeUndefined();
    expect(workspace.minimumReleaseAgeExclude).toBeUndefined();
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
