// Times `detect()` on repeated hostile units OUTSIDE Vitest's coverage
// instrumentation. The perf guard in detection-regressions.test.ts spawns this
// file as a plain Node child: V8 block coverage slows tight regex loops
// several-fold and unevenly, so an absolute ceiling measured in-process would
// either flake under `pnpm test` (coverage on) or be too loose to mean anything.
//
// Usage: node --experimental-strip-types detect-timing.mjs <size> <JSON units> <ceilingMs>
// Prints one JSON object: { "<unit>": <best-of-3 milliseconds>, ... }. A run
// already over the ceiling is reported as is instead of repeated, so a
// quadratic regression fails fast with its real number.
import { register } from "node:module";

// Source imports say `./patterns.js` (NodeNext style); the files are `.ts`.
// Resolve a relative `.js` specifier from a `.ts` parent to its `.ts` sibling.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (
        specifier.startsWith(".") &&
        specifier.endsWith(".js") &&
        context.parentURL?.endsWith(".ts")
      ) {
        return next(specifier.slice(0, -3) + ".ts", context);
      }
      return next(specifier, context);
    }
  `)}`,
);

const { detect } = await import(
  new URL("../../src/detect/detector.ts", import.meta.url).href
);

const size = Number(process.argv[2]);
const units = JSON.parse(process.argv[3]);
const ceiling = Number(process.argv[4]);
const timings = {};
for (const unit of units) {
  const input = unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
  let fastest = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    detect(input);
    fastest = Math.min(fastest, performance.now() - started);
    if (fastest >= ceiling) break;
  }
  timings[unit] = fastest;
}
process.stdout.write(JSON.stringify(timings));
