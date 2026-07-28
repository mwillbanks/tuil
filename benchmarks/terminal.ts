import { readFile } from "node:fs/promises";
import { cpus, release } from "node:os";
import {
  CellBuffer,
  CellRendererBackend,
  diffCellFrames,
  loadNativeCellAccelerator,
} from "@mwillbanks/tuil-cell";
import { DiffModel } from "@mwillbanks/tuil-content";
import { type LogRecord, LogRingBuffer } from "@mwillbanks/tuil-logging";
import {
  createRendererComponentRuntime,
  LayoutProjection,
  type RendererContext,
} from "@mwillbanks/tuil-renderer";
import { ScrollAreaState } from "@mwillbanks/tuil-scroll";
import { StreamingPipeline } from "@mwillbanks/tuil-streaming";
import { OptimizedBuffer, RGBA } from "@opentui/core";
import { renderToString, Text } from "ink";
import { createElement } from "react";

interface BenchmarkStatistics {
  readonly meanMilliseconds: number;
  readonly medianMilliseconds: number;
  readonly p95Milliseconds: number;
  readonly p99Milliseconds: number;
  readonly minimumMilliseconds: number;
  readonly maximumMilliseconds: number;
}

interface BenchmarkResult {
  readonly iterations: number;
  readonly label: string;
  readonly milliseconds: number;
  readonly name: string;
  readonly operationsPerSample: number;
  readonly statistics: BenchmarkStatistics;
  readonly warmupIterations: number;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * quantile) - 1,
  );
  return sorted[index] ?? 0;
}

function statistics(samples: readonly number[]): BenchmarkStatistics {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, sample) => sum + sample, 0);
  return Object.freeze({
    meanMilliseconds: rounded(total / sorted.length),
    medianMilliseconds: rounded(percentile(sorted, 0.5)),
    p95Milliseconds: rounded(percentile(sorted, 0.95)),
    p99Milliseconds: rounded(percentile(sorted, 0.99)),
    minimumMilliseconds: rounded(sorted[0] ?? 0),
    maximumMilliseconds: rounded(sorted.at(-1) ?? 0),
  });
}

async function measure(
  name: string,
  label: string,
  iterations: number,
  operation: () => void | Promise<void>,
  warmupIterations = Math.min(5, iterations),
): Promise<BenchmarkResult> {
  for (let index = 0; index < warmupIterations; index += 1) await operation();
  const probeStarted = performance.now();
  await operation();
  const probeMilliseconds = Math.max(
    performance.now() - probeStarted,
    Number.EPSILON,
  );
  const operationsPerSample = Math.min(
    1_000,
    Math.max(1, Math.ceil(10 / probeMilliseconds)),
  );
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    for (
      let operationIndex = 0;
      operationIndex < operationsPerSample;
      operationIndex += 1
    ) {
      await operation();
    }
    samples.push((performance.now() - started) / operationsPerSample);
  }
  const resultStatistics = statistics(samples);
  return Object.freeze({
    iterations,
    label,
    milliseconds: rounded(samples.reduce((sum, sample) => sum + sample, 0)),
    name,
    operationsPerSample,
    statistics: resultStatistics,
    warmupIterations,
  });
}

const results: BenchmarkResult[] = [];
let calibrationChecksum = 0;
results.push(
  await measure(
    "calibration.integer-1m",
    "One million integer operations",
    100,
    () => {
      let value = 0;
      for (let index = 0; index < 1_000_000; index += 1) {
        value = (value + index) >>> 0;
      }
      calibrationChecksum ^= value;
    },
  ),
);
if (!Number.isInteger(calibrationChecksum)) {
  throw new Error("benchmark calibration did not complete");
}
results.push(
  await measure("scroll.list-1k", "1,000-row visible range", 100, () => {
    const state = new ScrollAreaState({
      id: "list",
      viewport: { width: 80, height: 30 },
      extent: { width: 80, height: 1_000 },
    });
    state.wheel(0, 100);
    state.visibleRange(
      "vertical",
      Array.from({ length: 1_000 }, () => 1),
    );
  }),
);
results.push(
  await measure("scroll.list-100k", "100,000-row visible range", 100, () => {
    const state = new ScrollAreaState({
      id: "list",
      viewport: { width: 80, height: 40 },
      extent: { width: 80, height: 100_000 },
    });
    state.scrollTo({ y: 50_000 });
    state.visibleRange(
      "vertical",
      Array.from({ length: 100_000 }, () => 1),
    );
  }),
);
results.push(
  await measure(
    "streaming.jsonl-logs",
    "250 JSONL log records",
    20,
    async () => {
      const pipeline = new StreamingPipeline({
        format: "jsonl",
        maxSourceLength: 128 * 1_024,
      });
      for (let index = 0; index < 250; index += 1) {
        await pipeline.write(
          `{"level":"info","message":"record-${index}","trace_id":"${index.toString(16).padStart(32, "0")}"}\n`,
        );
      }
      await pipeline.end();
    },
  ),
);
results.push(
  await measure(
    "streaming.markdown-128k",
    "128 KiB incremental Markdown",
    20,
    async () => {
      const pipeline = new StreamingPipeline({
        format: "markdown",
        maxSourceLength: 128 * 1_024,
      });
      const source = Array.from(
        { length: 1_000 },
        (_, index) =>
          `## Section ${index}\n\n| id | value |\n| - | - |\n| ${index} | text |\n`,
      )
        .join("\n")
        .slice(0, 128 * 1_024);
      for (let offset = 0; offset < source.length; offset += 257) {
        await pipeline.write(source.slice(offset, offset + 257));
      }
      await pipeline.end();
    },
  ),
);
results.push(
  await measure("content.split-diff", "Split diff projection", 100, () => {
    new DiffModel("@@ -1 +1 @@\n-old\n+new").render("split");
  }),
);
results.push(
  await measure("renderer.cell-diff", "TUIL cell diff, 120x40", 100, () => {
    const before = new CellBuffer(120, 40);
    const after = new CellBuffer(120, 40);
    after.write(30, 20, "updated");
    diffCellFrames(before.frame(), after.frame());
  }),
);
const nativePrototype = await loadNativeCellAccelerator();
if (!nativePrototype) {
  throw new Error("native cell diff prototype is unavailable");
}
results.push(
  await measure(
    "renderer.cell-diff.native-prototype",
    "Explicit Zig count prototype plus TypeScript diff, 120x40",
    100,
    () => {
      const before = new CellBuffer(120, 40);
      const after = new CellBuffer(120, 40);
      after.write(30, 20, "updated");
      nativePrototype.diff(before.frame(), after.frame());
    },
  ),
);
results.push(
  await measure("renderer.resize-storm", "Nine 40-row resizes", 100, () => {
    for (let width = 40; width <= 120; width += 10) {
      new CellBuffer(width, 40).frame();
    }
  }),
);
results.push(
  await measure(
    "renderer.animated-frame",
    "TUIL animated frame diff, 80x24",
    100,
    () => {
      const before = new CellBuffer(80, 24);
      const after = new CellBuffer(80, 24);
      after.write(10, 10, "frame");
      diffCellFrames(before.frame(), after.frame());
    },
  ),
);
results.push(
  await measure("renderer.large-table", "40 of 10,000 table rows", 20, () => {
    const rows = Array.from({ length: 10_000 }, (_, row) => [
      String(row),
      `service-${row % 20}`,
      `status-${row % 4}`,
    ]);
    const buffer = new CellBuffer(120, 40);
    for (const [index, row] of rows.slice(5_000, 5_040).entries()) {
      buffer.write(0, index, row.join(" | ").slice(0, 120));
    }
    buffer.frame();
  }),
);
results.push(
  await measure(
    "logging.bounded-retention",
    "100,000 bounded log inserts",
    20,
    () => {
      const records = new LogRingBuffer(100_000);
      const record: LogRecord = {
        attributes: {},
        body: "benchmark",
        diagnostics: [],
        original: "benchmark",
        resource: {},
        source: "text",
      };
      for (let index = 0; index < 100_000; index += 1) records.push(record);
    },
  ),
);

const comparisonLines = Array.from({ length: 24 }, (_, row) =>
  `row-${row.toString().padStart(2, "0")} ${"renderer comparison ".repeat(4)}`.slice(
    0,
    80,
  ),
);
const comparisonText = comparisonLines.join("\n");
let comparisonOutputBytes = 0;
results.push(
  await measure(
    "comparison.full-frame.ink",
    "Ink public render pipeline, 80x24 frame",
    100,
    () => {
      comparisonOutputBytes = new TextEncoder().encode(
        renderToString(createElement(Text, null, comparisonText), {
          columns: 80,
        }),
      ).byteLength;
    },
  ),
);

const openTuiForeground = RGBA.fromInts(255, 255, 255, 255);
const openTuiBackground = RGBA.fromInts(0, 0, 0, 255);
results.push(
  await measure(
    "comparison.full-frame.opentui",
    "OpenTUI public buffer pipeline, 80x24 frame",
    100,
    () => {
      const buffer = OptimizedBuffer.create(80, 24, "unicode");
      for (const [row, line] of comparisonLines.entries()) {
        buffer.drawText(line, 0, row, openTuiForeground, openTuiBackground);
      }
      comparisonOutputBytes = buffer.getRealCharBytes(true).byteLength;
      buffer.destroy();
    },
  ),
);

const rendererContext: RendererContext = {
  capabilities: {
    width: 80,
    height: 24,
    colorDepth: 24,
    unicode: true,
    hyperlinks: true,
    interactive: true,
    tty: true,
    alternateScreen: true,
    mouse: true,
    images: false,
    reducedMotion: false,
    platform: "linux",
  },
  mode: "static",
  layout: new LayoutProjection(),
  signal: new AbortController().signal,
};
const comparisonApplication = createRendererComponentRuntime({
  initialState: { lines: comparisonLines },
  component: ({ state }) => ({ lines: state.lines }),
});
const comparisonBackend = new CellRendererBackend();
results.push(
  await measure(
    "comparison.full-frame.tuil-cell",
    "TUIL public application and cell pipeline, 80x24 frame",
    100,
    async () => {
      const frame = await comparisonBackend.render(
        await comparisonApplication.project(rendererContext),
        rendererContext,
      );
      comparisonOutputBytes = comparisonBackend.diff(undefined, frame).bytes
        .byteLength;
    },
  ),
);

if (comparisonOutputBytes === 0) {
  throw new Error("renderer comparison produced no output");
}

type CapturedBaselineResult = Omit<
  BenchmarkResult,
  "operationsPerSample" | "statistics"
> & {
  readonly operationsPerSample?: number;
  readonly statistics?: BenchmarkStatistics;
};

interface NormalizedBaselineResult {
  readonly name: string;
  readonly normalizedP95: number;
}

type BaselineBenchmarkResult =
  | CapturedBaselineResult
  | NormalizedBaselineResult;

interface BenchmarkBaseline {
  readonly environment?: {
    readonly architecture: string;
    readonly bunVersion: string;
    readonly cpuCount: number;
    readonly cpuModel: string;
    readonly operatingSystem: string;
    readonly operatingSystemRelease: string;
    readonly profile: string;
  };
  readonly results: readonly BaselineBenchmarkResult[];
  readonly policy?: {
    readonly maximumNormalizedP95Ratio?: number;
    readonly minimumNormalizedP95Budget?: number;
  };
}

const calibrationName = "calibration.integer-1m";
const defaultPolicy = Object.freeze({
  maximumNormalizedP95Ratio: 1.75,
  minimumNormalizedP95Budget: 0.05,
});
const environment = {
  architecture: process.arch,
  bunVersion: Bun.version,
  cpuCount: cpus().length,
  cpuModel: cpus()[0]?.model ?? "unknown",
  operatingSystem: process.platform,
  operatingSystemRelease: release(),
  profile: process.env["CI"] ? "ci" : "development",
};
const requestedBaseline =
  process.env["TUIL_BENCHMARK_BASELINE"] ??
  (process.env["CI"] ? `${process.platform}-${process.arch}` : undefined);
if (requestedBaseline && !/^[a-z0-9-]+$/.test(requestedBaseline)) {
  throw new Error(
    "TUIL_BENCHMARK_BASELINE must contain only lowercase letters, digits, and hyphens",
  );
}
const baselineUrl = new URL(
  requestedBaseline
    ? `./baseline.${requestedBaseline}.json`
    : "./baseline.json",
  import.meta.url,
);
const updateBaseline = process.argv.includes("--update");
const baseline = updateBaseline
  ? { environment, policy: defaultPolicy, results }
  : (JSON.parse(await readFile(baselineUrl, "utf8")) as BenchmarkBaseline);
if (updateBaseline) {
  await Bun.write(
    baselineUrl,
    `${JSON.stringify(
      {
        schemaVersion: 3,
        runtime: "bun",
        capturedAt: new Date().toISOString(),
        environment,
        policy: defaultPolicy,
        results,
      },
      null,
      2,
    )}\n`,
  );
}
const maximumRatio =
  baseline.policy?.maximumNormalizedP95Ratio ??
  defaultPolicy.maximumNormalizedP95Ratio;
const minimumNormalizedBudget =
  baseline.policy?.minimumNormalizedP95Budget ??
  defaultPolicy.minimumNormalizedP95Budget;
function baselineP95(result: BaselineBenchmarkResult): number {
  if ("normalizedP95" in result) return result.normalizedP95;
  return result.statistics
    ? result.statistics.p95Milliseconds
    : result.milliseconds / result.iterations;
}

const currentCalibration = results.find(
  (result) => result.name === calibrationName,
);
const baselineCalibration = baseline.results.find(
  (result) => result.name === calibrationName,
);
if (!currentCalibration || !baselineCalibration) {
  throw new Error("benchmark calibration baseline is missing");
}
const currentCalibrationP95 = currentCalibration.statistics.p95Milliseconds;
const baselineCalibrationP95 = baselineP95(baselineCalibration);
if (
  !Number.isFinite(currentCalibrationP95) ||
  currentCalibrationP95 <= 0 ||
  !Number.isFinite(baselineCalibrationP95) ||
  baselineCalibrationP95 <= 0
) {
  throw new Error("benchmark calibration p95 must be finite and positive");
}

function regressionFor(result: BenchmarkResult): readonly string[] {
  if (result.name === calibrationName) return [];
  const expected = baseline.results.find((entry) => entry.name === result.name);
  if (!expected) return [`${result.name}: missing baseline`];
  const normalizedP95 =
    result.statistics.p95Milliseconds / currentCalibrationP95;
  const expectedNormalizedP95 = baselineP95(expected) / baselineCalibrationP95;
  const budget = Math.max(
    minimumNormalizedBudget,
    expectedNormalizedP95 * maximumRatio,
  );
  return normalizedP95 > budget
    ? [
        `${result.name}: normalized p95 ${normalizedP95.toFixed(3)} exceeds ${budget.toFixed(3)} calibration units`,
      ]
    : [];
}
const regressions = results.flatMap(regressionFor);

process.stdout.write(
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      environment,
      methodology: {
        calibration:
          "Every p95 is compared as a ratio to the same-run one-million-integer-operation calibration; stored absolute times are diagnostic only",
        comparison:
          "Equivalent 80x24 text frame through each renderer's public application or buffer API, including output encoding",
        statistic: "p95 wall-clock milliseconds per iteration",
        sampling:
          "Each sample batches enough operations to target at least 10 milliseconds, capped at 1,000 operations, and reports per-operation latency",
        warmup:
          "Each case runs isolated warmup iterations and one batch-sizing probe before measurement",
      },
      regressions,
      results,
      schemaVersion: 3,
    },
    null,
    2,
  )}\n`,
);
if (regressions.length > 0) process.exitCode = 1;
