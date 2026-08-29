import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOWS = resolve(import.meta.dirname, "../.github/workflows");
const CHECKOUT = "actions/checkout";
const DAGGER = "dagger/dagger-for-github";
const UPLOAD = "actions/upload-artifact";
const DOWNLOAD = "actions/download-artifact";

type Mapping = Readonly<Record<string, unknown>>;

function mapping(value: unknown): Mapping {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Mapping)
    : {};
}

function workflow(name: string): Mapping {
  return mapping(parse(readFileSync(resolve(WORKFLOWS, name), "utf8")));
}

function job(document: Mapping, name: string): Mapping {
  return mapping(mapping(document.jobs)[name]);
}

function steps(node: Mapping): readonly Mapping[] {
  return Array.isArray(node.steps) ? node.steps.map(mapping) : [];
}

function actionName(step: Mapping): string {
  return typeof step.uses === "string"
    ? (step.uses.split("@")[0] ?? "")
    : "run";
}

describe("Dagger CI/CD ingress", () => {
  it("keeps one protected Dagger ingress and the two local npm release bridges", () => {
    expect(readdirSync(WORKFLOWS).sort()).toEqual([
      "dagger.yml",
      "publish.yml",
      "release-candidate.yml",
    ]);
  });

  it("routes code, manual, and weekly events through one exact-SHA Dagger check", () => {
    const document = workflow("dagger.yml");
    const dagger = job(document, "dagger");
    const ingress = steps(dagger);
    const triggers = mapping(document.on);

    expect(dagger.name).toBe("Dagger");
    expect(mapping(triggers.push).branches).toEqual(["main"]);
    expect(triggers.pull_request).toBeNull();
    expect(triggers.workflow_dispatch).toBeNull();
    expect(triggers.schedule).toEqual([{ cron: "0 6 * * 1" }]);
    expect(ingress.map(actionName)).toEqual([CHECKOUT, DAGGER]);
    expect(mapping(ingress[0]?.with)).toEqual({
      "fetch-depth": 0,
      "persist-credentials": false,
      ref: "$" + "{{ github.sha }}",
    });
    expect(mapping(ingress[1]?.with)).toEqual({
      version: "0.21.8",
      call: "ci --commit-sha=$" + "{{ github.sha }}",
    });
    expect(ingress.every((step) => typeof step.run !== "string")).toBe(true);
  });
});

describe("exact Dagger npm release bridge", () => {
  it("persists only the manually requested Dagger candidate", () => {
    const document = workflow("release-candidate.yml");
    const candidate = job(document, "candidate");
    const candidateSteps = steps(candidate);

    expect(mapping(document.on).workflow_dispatch).toBeDefined();
    expect(candidate.if).toBe("github.ref == 'refs/heads/main'");
    expect(candidateSteps.map(actionName)).toEqual([CHECKOUT, DAGGER, UPLOAD]);
    expect(String(mapping(candidateSteps[1]?.with).args)).toContain(
      "release-candidate --tag=$" +
        "{{ inputs.tag }} --commit-sha=$" +
        "{{ github.sha }}",
    );
    expect(mapping(candidateSteps[2]?.with)).toEqual({
      name: "privacy-core-$" + "{{ github.sha }}",
      path: "release/",
      "if-no-files-found": "error",
      "retention-days": 1,
    });
  });

  it("publishes from a source-free OIDC and provenance bridge", () => {
    const document = workflow("publish.yml");
    const publish = job(document, "publish");
    const publishSteps = steps(publish);
    const permissions = mapping(publish.permissions);

    expect(mapping(mapping(document.on).workflow_run).workflows).toEqual([
      "Dagger release candidate",
    ]);
    expect(String(publish.if)).toContain(
      "workflow_run.conclusion == 'success'",
    );
    expect(permissions).toEqual({
      actions: "read",
      contents: "read",
      "id-token": "write",
    });
    expect(publishSteps.map(actionName)).toEqual([DOWNLOAD, DAGGER]);
    expect(mapping(publishSteps[1]?.with).module).toBe(
      "github.com/hseshadr/privacy-core@$" +
        "{{ github.event.workflow_run.head_sha }}",
    );
    expect(String(mapping(publishSteps[1]?.with).args)).toContain(
      "publish --candidate=release --expected-sha=$" +
        "{{ github.event.workflow_run.head_sha }}",
    );
    expect(String(mapping(publishSteps[1]?.with).args)).toContain(
      "--oidc-url=env:ACTIONS_ID_TOKEN_REQUEST_URL --oidc-token=env:ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    );
    expect(publishSteps.some((step) => actionName(step) === CHECKOUT)).toBe(
      false,
    );
    expect(readFileSync(resolve(WORKFLOWS, "publish.yml"), "utf8")).not.toMatch(
      /\b(?:build|test|install|checkout|npm publish)\b/i,
    );
  });

  it("keeps every external bridge pinned to immutable identity", () => {
    const refs = readdirSync(WORKFLOWS).flatMap((file) =>
      steps(job(workflow(file), basename(file, ".yml"))).flatMap((step) =>
        typeof step.uses === "string" ? [step.uses] : [],
      ),
    );
    expect(refs.every((ref) => /@[0-9a-f]{40}$/.test(ref))).toBe(true);
  });
});
