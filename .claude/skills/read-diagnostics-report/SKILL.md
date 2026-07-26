---
name: read-diagnostics-report
description: Read one Diagnostics panel report or compare a set of them (ADR 0004). Use when asked to check sync, latency, or drift results, interpret a diagnostics/report-*.json file, or assess a scenario-runner (#18) output set.
---

# Reading a diagnostics report

Agent-facing counterpart to [`docs/testing-sync.md`](../../../docs/testing-sync.md), which is the doctrine: the three per-beat error shapes (constant offset / drift / jitter) and what each points at, the Mode B-before-Mode A ordering, arming behaviour, the Count-in Padding constant. Read it first if you haven't this session — this skill does not restate it. What follows is specific to reading reports as an agent: where they are, what to extract before reading them whole, and the gates that block a wrong conclusion.

Anything computable belongs in the report, not here — if a question needs a figure the report doesn't state, that's a gap in `src/diagnostics/report.ts` (`DiagnosticsReport`, `src/diagnostics/types.ts`), not something to derive by hand from the JSON.

## 1. Find the report(s)

Reports live at the gitignored `diagnostics/` directory in the repo root, named `report-<ISO-timestamp>.json` with `:` and `.` replaced by `-`. Sort by filename (or mtime) — it sorts chronologically as written:

```sh
ls -t diagnostics/*.json | head -n 1        # newest
ls -t diagnostics/*.json | head -n N        # newest N
```

## 2. Extract summary fields before reading anything whole

A report carries a downsampled `peaks` array and a `perBeatErrorMs` array per Track — thousands of numbers across a multi-Take set. Pull the summary fields with `jq` first; go to `analysis.tracks[].peaks` or `.perBeatErrorMs` only once a specific question needs them.

```sh
# One report's shape at a glance
jq '{mode: .mode, createdAt: .createdAt, audioClock: .audioClock, scenario: .scenario, captureStart: .captureStart, padding: .padding, countIn: .countIn}' diagnostics/report-*.json

# Calibration value used
jq '.analysis.simulatedLatencyMs // .scenario.simulatedLatencyMs' diagnostics/report-*.json

# Per-Track error summary without the raw arrays
jq '.analysis.tracks[] | {label: .label, missingBeatIndices: .missingBeatIndices, spuriousOnsetsMs: .spuriousOnsetsMs}' diagnostics/report-*.json

# Only pull perBeatErrorMs once you need the shape itself
jq '.analysis.tracks[] | {label: .label, perBeatErrorMs: .perBeatErrorMs}' diagnostics/report-*.json
```

(spell out `key: .key` rather than shorthand `{key, ...}` — jq on Windows chokes on the shorthand form)

## 3. Calibration gate — hard stop

Check `analysis.simulatedLatencyMs` (synthetic scenario) or the run's recorded `scenario.simulatedLatencyMs` across every report in the set you're assessing.

**If every run in the set was made at `simulatedLatencyMs: 0`, the instrument is unvalidated for that set.** No conclusion about engine correctness may be drawn from it, zero-error or not — a broken detector that never finds anything also reports zero. Say so explicitly and ask for a calibration run (a nonzero `simulatedLatencyMs`, e.g. 80ms) before proceeding. This applies even if every number in the set looks clean; a clean report from an unvalidated instrument is not evidence, it's the same reading a dead instrument would give.

Only once at least one report in context (this set, or a prior calibration run you can point to) demonstrates the harness reporting a known nonzero error at approximately the injected value is a zero-error run from the same instrument state treatable as a real measurement.

## 4. Cross-run comparability

Two reports are only comparable if:

- `audioClock.sessionId` matches — this is what distinguishes a cold start (context just created, still paying priming cost) from a warm one (context reused across Takes, priming cost already paid). Don't compare `padding.actualMs` or timing figures across a cold-start report and a warm-session report; they're not measuring the same thing.
- Same `scenario` shape (`trackCount`, `tempoBpm`, `beatsPerBar`, `beatCount`) if comparing scenario runs, or the equivalent `loopback` fields for Mode A.

## 5. What a report alone cannot tell you

- **A Guide-less pass exercises a different Offset path than normal use.** Check `project.guide` — `null`, or `includeInMonitorMix: false` on a recording pass — before comparing its numbers against a Guide-ful baseline. They aren't measuring the same case.
- **No automatic classification of the three error shapes.** The report states `perBeatErrorMs`, `missingBeatIndices`, `spuriousOnsetsMs`; reading those as constant-offset/drift/jitter is the judgment call `docs/testing-sync.md` describes — this skill doesn't add a second copy of that doctrine.
- **A single report can't say whether an engine is regressed** without either the calibration gate (§3) passing, or a prior baseline report to diff against with matching `sessionId`/scenario shape (§4).

## 6. Machine-specific baselines

Any baseline figure worth citing while reading a report (e.g. a measured systematic lead, a priming-cost number) is a measurement of one machine, not a portable expectation (ADR 0004) — cite it only with the machine and date it was measured on, and prefer pointing at the issue/ADR it came from over restating the number. A stale, unlabelled baseline presented as an expectation is worse than none.
