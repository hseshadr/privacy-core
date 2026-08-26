import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOWS = resolve(import.meta.dirname, "../.github/workflows");
const SHADOW = resolve(WORKFLOWS, "dagger-shadow.yml");

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function shadowSteps(): readonly Readonly<Record<string, unknown>>[] {
  const document = asRecord(parse(readFileSync(SHADOW, "utf8")));
  const jobs = asRecord(document.jobs);
  const job = asRecord(jobs["dagger-shadow"]);
  const steps = job.steps;
  return Array.isArray(steps) ? steps.map(asRecord) : [];
}

describe("Dagger shadow ingress", () => {
  it("runs the exact checkout through the pinned Dagger graph", () => {
    expect(existsSync(SHADOW)).toBe(true);
    if (!existsSync(SHADOW)) return;

    const steps = shadowSteps();
    expect(steps.map((step) => String(step.uses).split("@")[0])).toEqual([
      "actions/checkout",
      "dagger/dagger-for-github",
    ]);
    expect(asRecord(steps[0]?.with)).toEqual({
      "fetch-depth": 0,
      "persist-credentials": false,
    });
    expect(asRecord(steps[1]?.with)).toEqual({
      version: "0.21.8",
      verb: "call",
      args: "ci --commit-sha=$" + "{{ github.sha }}",
    });
    expect(existsSync(resolve(WORKFLOWS, "ci.yml"))).toBe(true);
  });
});
