import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOWS = fileURLToPath(
  new URL("../.github/workflows", import.meta.url),
);
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/;
const UNTRUSTED =
  /\$\{\{[^}]*\b(?:github\.event\b|github\.head_ref\b|inputs\.)[^}]*\}\}/;
type Mapping = Readonly<Record<string, unknown>>;

interface Workflow {
  readonly file: string;
  readonly yaml: string;
  readonly document: Mapping;
}

function mapping(value: unknown): Mapping {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Mapping)
    : {};
}

function isWorkflowFilename(file: string): boolean {
  return file.endsWith(".yml") || file.endsWith(".yaml");
}

function workflows(): readonly Workflow[] {
  return readdirSync(WORKFLOWS)
    .filter(isWorkflowFilename)
    .map((file) => {
      const yaml = readFileSync(join(WORKFLOWS, file), "utf8");
      return { file, yaml, document: mapping(parse(yaml)) };
    });
}

function jobs(document: Mapping): readonly Mapping[] {
  return Object.values(mapping(document.jobs)).map(mapping);
}

function steps(document: Mapping): readonly Mapping[] {
  return jobs(document).flatMap((node) =>
    Array.isArray(node.steps) ? node.steps.map(mapping) : [],
  );
}

function uses(document: Mapping): readonly string[] {
  return steps(document).flatMap((step) =>
    typeof step.uses === "string" ? [step.uses] : [],
  );
}

function readOnlyTopLevel(document: Mapping): boolean {
  const permissions = mapping(document.permissions);
  return (
    Object.keys(permissions).length > 0 &&
    Object.values(permissions).every((scope) => scope === "read")
  );
}

describe("GitHub Actions executable surface", () => {
  it("scans both supported workflow filename extensions", () => {
    expect(isWorkflowFilename("gate.yml")).toBe(true);
    expect(isWorkflowFilename("gate.yaml")).toBe(true);
    expect(isWorkflowFilename("notes.md")).toBe(false);
    expect(workflows().length).toBeGreaterThan(0);
  });

  it("pins every external action to an immutable commit", () => {
    const moving = workflows().flatMap(({ file, document }) =>
      uses(document)
        .filter((ref) => !ref.startsWith("./") && !PINNED.test(ref))
        .map((ref) => `${file}: ${ref}`),
    );
    expect(moving).toEqual([]);
  });

  it("gives every workflow an explicit read-only top-level token", () => {
    expect(
      workflows()
        .filter(({ document }) => !readOnlyTopLevel(document))
        .map(({ file }) => file),
    ).toEqual([]);
  });

  it("never runs untrusted event text as shell code", () => {
    const injectable = workflows().flatMap(({ file, document }) =>
      steps(document)
        .filter(
          (step) => typeof step.run === "string" && UNTRUSTED.test(step.run),
        )
        .map(() => file),
    );
    expect(injectable).toEqual([]);
  });

  it("never pastes untrusted text into an action's shell-templated inputs", () => {
    // dagger/dagger-for-github templates `args`, `call`, `shell` and `check`
    // straight into a bash script, so an expression there is shell text too:
    // a dispatched tag containing `'` would run as code. Pass it via `env:`.
    const injectable = workflows().flatMap(({ file, document }) =>
      steps(document).flatMap((step) =>
        Object.entries(mapping(step.with))
          .filter(([, value]) => typeof value === "string")
          .filter(([, value]) => UNTRUSTED.test(String(value)))
          .filter(([key]) => ["args", "call", "shell", "check"].includes(key))
          .map(([key]) => `${file}: ${String(step.uses)} ${key}`),
      ),
    );
    expect(injectable).toEqual([]);
  });

  it("never grants privileged base-repository context to fork code", () => {
    expect(
      workflows()
        .filter(({ yaml }) => /\bpull_request_target\b/.test(yaml))
        .map(({ file }) => file),
    ).toEqual([]);
  });

  it("disables credential persistence on every checkout", () => {
    const unsafe = workflows().flatMap(({ file, document }) =>
      steps(document)
        .filter((step) => String(step.uses).startsWith("actions/checkout@"))
        .filter((step) => mapping(step.with)["persist-credentials"] !== false)
        .map(() => file),
    );
    expect(unsafe).toEqual([]);
  });

  it("never enables all dependency lifecycle scripts", () => {
    expect(
      workflows().filter(({ yaml }) =>
        yaml.includes("dangerously-allow-all-builds"),
      ),
    ).toEqual([]);
  });
});
