import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOWS = resolve(import.meta.dirname, "../.github/workflows");
const CHECKOUT = "actions/checkout";
const DAGGER = "dagger/dagger-for-github";
const UPLOAD = "actions/upload-artifact";
const DOWNLOAD = "actions/download-artifact";

// The central lineage proof (hseshadr/ci#49), pinned at a literal commit.
const LINEAGE_MODULE =
  /^github\.com\/hseshadr\/ci\/modules\/portfolio-foundation@[0-9a-f]{40}$/;
// Every value is a quoted env var bound to the triggering run, so a hard-coded
// run id or SHA cannot make the proof about a different run.
const PROVENANCE_ARGS =
  'release-provenance --github-token=env:GH_TOKEN --repository="$GITHUB_REPOSITORY" ' +
  '--run-id="$RUN_ID" --head-sha="$HEAD_SHA" --publish-run-id="$GITHUB_RUN_ID" ' +
  "export --path=github-context.json";
const PUBLISH_ARGS =
  'publish --candidate=release --expected-sha="$HEAD_SHA" ' +
  "--oidc-url=env:ACTIONS_ID_TOKEN_REQUEST_URL " +
  "--oidc-token=env:ACTIONS_ID_TOKEN_REQUEST_TOKEN " +
  "--github-context=github-context.json";

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
    expect(candidateSteps.map(actionName)).toEqual([
      "run",
      CHECKOUT,
      DAGGER,
      "run",
      UPLOAD,
    ]);
    expect(mapping(candidateSteps[4]?.with)).toEqual({
      name: "privacy-core-$" + "{{ github.sha }}",
      path: "release/",
      "if-no-files-found": "error",
      "retention-days": 1,
    });
  });

  it("validates the dispatched tag before anything runs, and only ever as $TAG", () => {
    const candidateSteps = steps(
      job(workflow("release-candidate.yml"), "candidate"),
    );
    const [validate, , install, build] = candidateSteps;

    // The tag is attacker-shapeable text: it may reach shell only through the
    // environment, and the first step refuses anything but a plain vX.Y.Z.
    expect(validate?.name).toBe("Validate release tag");
    expect(mapping(validate?.env)).toEqual({ TAG: "$" + "{{ inputs.tag }}" });
    expect(String(validate?.run)).toContain("exit 1");
    expect(String(validate?.run)).toContain(
      '"$TAG" =~ ^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]',
    );
    // dagger-for-github pastes `args`/`call` into bash unquoted: install only.
    expect(mapping(install?.with)).toEqual({ version: "0.21.8" });
    expect(mapping(build?.env)).toEqual({
      TAG: "$" + "{{ inputs.tag }}",
      GITHUB_TOKEN: "$" + "{{ github.token }}",
    });
    expect(String(build?.run)).toContain(
      'release-candidate --tag="$TAG" --commit-sha="$GITHUB_SHA"',
    );
    expect(String(build?.run)).toContain(
      "--github-token=env:GITHUB_TOKEN export --path=release",
    );
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
    // Lineage and provenance come from the central Dagger function; no step
    // runs repository shell (hseshadr/ci#49).
    expect(publishSteps.map(actionName)).toEqual([DAGGER, DOWNLOAD, DAGGER]);
    expect(publishSteps.filter((step) => "run" in step)).toEqual([]);
    const release = publishSteps[2];
    expect(mapping(release?.env)).toEqual({
      HEAD_SHA: "$" + "{{ github.event.workflow_run.head_sha }}",
    });
    // The publisher CODE comes from the trusted default-branch commit this
    // workflow runs on, never from the candidate's (dispatch-controlled) sha.
    expect(mapping(release?.with)).toEqual({
      version: "0.21.8",
      verb: "call",
      module: "github.com/hseshadr/privacy-core@$" + "{{ github.sha }}",
      args: PUBLISH_ARGS,
    });
    expect(publishSteps.some((step) => actionName(step) === CHECKOUT)).toBe(
      false,
    );
    expect(readFileSync(resolve(WORKFLOWS, "publish.yml"), "utf8")).not.toMatch(
      /\b(?:build|test|install|checkout|npm publish)\b/i,
    );
  });

  it("proves the candidate's lineage in Dagger before any artifact is touched", () => {
    const [lineage, download] = steps(job(workflow("publish.yml"), "publish"));
    const invocation = { ...mapping(lineage?.with) };

    // `head_branch == default_branch` alone is satisfied by a dispatch on a TAG
    // named `main`. The central hseshadr/ci function proves from GitHub's run
    // records that the run is a successful release-candidate.yml dispatch for
    // exactly HEAD_SHA and that main contains HEAD_SHA. Only then does it emit
    // npm's provenance context, derived from the publish run record.
    expect(actionName(lineage ?? {})).toBe(DAGGER);
    expect(mapping(lineage?.env)).toEqual({
      GH_TOKEN: "$" + "{{ github.token }}",
      RUN_ID: "$" + "{{ github.event.workflow_run.id }}",
      HEAD_SHA: "$" + "{{ github.event.workflow_run.head_sha }}",
    });
    expect(String(invocation.module)).toMatch(LINEAGE_MODULE);
    delete invocation.module;
    expect(invocation).toEqual({
      version: "0.21.8",
      verb: "call",
      args: PROVENANCE_ARGS,
    });
    // The archive is that run's own artifact for that exact commit.
    expect(mapping(download?.with)).toMatchObject({
      name: "privacy-core-$" + "{{ github.event.workflow_run.head_sha }}",
      "run-id": "$" + "{{ github.event.workflow_run.id }}",
    });
  });

  it("pastes no expression into any publisher Dagger input", () => {
    const pasted = steps(job(workflow("publish.yml"), "publish"))
      .filter((step) => actionName(step) === DAGGER)
      .flatMap((step) =>
        Object.entries(mapping(step.with))
          .filter(([key]) => key !== "module")
          .map(([, value]) => String(value)),
      );

    expect(pasted.length).toBeGreaterThan(0);
    expect(pasted.filter((value) => value.includes("$" + "{{"))).toEqual([]);
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
