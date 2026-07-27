# Testing sync

How to conduct a sync test with the Diagnostics panel and how to read the
report it writes. See ADR 0004 (why the harness exists and how it's built),
ADR 0005 (arming, and the capture-acquisition defect this harness found),
and ADR 0006 (the standalone one-click suite and Metronome-based Guide
described below).

## Opening the panel

The Diagnostics panel opens from the toolbar and is separate from the normal
recording UI. It does not require a Project to be open — it spins up its own
ephemeral Project and Metronome (a generated Guide; see "The diagnostics
Guide is always a Metronome" below).

## Run Full Diagnostics — the one-click path

**Run Full Diagnostics** is the primary action. One click runs, in order:

1. **Calibration** — a Synthetic Sync Scenario pass at a known nonzero
   simulated latency, checked against that injected value.
2. **Synthetic Sync Scenario** (Mode B) — the real, zero-injected-latency
   measurement, only run if calibration passed.
3. **Acoustic Loopback** (Mode A) — only run if Mode B ran, per the
   Mode-B-before-Mode-A reasoning below.

All three phases write into **one report file** per suite run — there is no
longer a separate file per phase to correlate by `sessionId` or timestamp.

**If calibration fails, the suite aborts before Mode B or Mode A run.** No
report is written that could be mistaken for a real measurement. This is
enforced by the suite now, not left as reader discipline — see "Calibrate
before you trust a clean result" below for why the check exists.

## Advanced: running phases manually

The individual phases — Write Report, Synthetic Sync Scenario alone,
Acoustic Loopback alone, and the scenario config fields (Track count,
tempo, beats per bar, beat count, simulated latency) that Run Full
Diagnostics fixes to sensible defaults — remain available behind an
Advanced disclosure, for debugging the harness itself (e.g. iterating on
the onset detector without paying for a full suite run each time). Running
phases manually does **not** get the calibration gate for free — the
discipline below still applies by hand in that mode.

## Run Mode B before Mode A, always

Mode B substitutes a synthetic capture adapter for the microphone/camera —
no human performs, and playback stays entirely real. It is the fixed
reference: it's how you know the *engine* is scheduling correctly, isolated
from a human performer, a microphone, or room acoustics.

Mode A plays the Metronome through your speakers and records it back
through the microphone, producing a true round-trip latency figure. That
number only means something once you already trust the engine — otherwise
you can't tell whether a bad reading is the engine or the round trip through
air. Run Mode B first and get a clean result before treating a Mode A
reading as meaningful. Run Full Diagnostics enforces this order
automatically; running phases manually in the Advanced area does not.

**Mode A requires speakers, not headphones.** Over headphones, or with
speakers muted, the microphone never picks up the click and the panel
reports "No onsets detected — likely headphones instead of speakers, or
speakers muted" rather than a spurious number.

## The diagnostics Guide is always a Metronome

Both modes capture against one Metronome — a generated Guide, not an
imported one — created once per suite run and shared by Mode B and Mode A
alike, rather than each mode computing its own independent expected-beat-time
math. A Metronome has a single constant tempo and time signature for its
whole duration; mid-Guide tempo or meter changes are not supported.

This means diagnostics **never** exercises an imported Guide, regardless of
anything generated or imported in the main app's Project — "Generate Guide"
or an import there has no bearing on a diagnostics run. There is no path
today to diagnose sync against a specific imported Guide file; diagnostics
is Metronome-only by design (ADR 0006).

## Calibrate before you trust a clean result

Both the Synthetic Sync Scenario's "Simulated latency (ms)" field and the
per-beat error numbers exist to answer one question: is the harness actually
measuring anything, or does it just always say zero?

A report showing zero error is not evidence of a correct engine by itself —
it's also what a broken instrument that never detects anything would show.
Run Full Diagnostics runs this check automatically and aborts on failure
(see above). If you're running phases manually in the Advanced area, do this
by hand: run the Synthetic Sync Scenario once with a nonzero simulated
latency (e.g. 80ms) and confirm the per-beat errors come back at
approximately that value before trusting any zero-error result from that
session. The panel labels a nonzero-latency run as a calibration check, not
a measurement, so a report can't be mistaken for the other.

## Where reports go

Reports are written as JSON to the gitignored `diagnostics/` directory at
the repository root, named `report-<ISO-timestamp>.json` with `:` and `.`
replaced by `-` (e.g. `report-2026-07-26T12-34-56-789Z.json`). Sort by
filename or mtime to find the newest. A Run Full Diagnostics run writes one
file covering calibration, Mode B, and Mode A together; a manually-run
Advanced phase writes its own file per action, same as before.

## Reading a report

### Check `captureStart.delayAfterCountInMs` first

This is the standing guard on ADR 0005's fix. The Project timeline's zero
point is the instant the Count-in ends — that's where the Guide's first
beat sits and what every Take's Offset is measured from. Capture is supposed
to begin at that same instant, so this field should read **0** (or very
close to it) on every Take. A healthy report looks like this, on every
Take, not just the first:

```json
"captureStart": { "delayAfterCountInMs": 0 }
```

Before ADR 0005 landed, seven manually measured Takes across five sessions
came in at values from 349ms to 931ms, and this was the whole cause of the
multi-Track sync failure the harness was built to find: each Take was
displaced from the Guide by its own gap, different per Take. If you ever see a
non-trivial value here again, every Take in that pass is off from the Guide
by that much — this is the first thing to check, before looking at per-beat
errors at all.

### Check `audioClock.sessionId` next

Every timestamp in a report (`atMs` on each event) is measured from one
`AudioContext`'s creation. `audioClock.sessionId` identifies which context
stamped the report; `audioClock.createdAtEpochMs` is that context's creation
wall-clock time. Two reports are only comparable if they share a
`sessionId` — that's what distinguishes a cold start (context just created,
still paying `AudioContext` priming cost) from a warm one (context reused
across several Takes in one session, priming cost already paid). Don't
compare a padding measurement from a cold-start report against one from a
warm session; they're not measuring the same thing.

### Read the per-beat errors as one of three shapes

`analysis.tracks[i].perBeatErrorMs` is one signed millisecond error per
expected beat, in order, `null` where a beat was never detected
(`missingBeatIndices`) — spurious/double-triggered onsets are reported
separately in `spuriousOnsetsMs` rather than folded into a shifted error.
The Synthetic Sync Scenario and Acoustic Loopback sections of the panel both
render a `WaveformCanvas` from this same analysis object after a run, so you
can read the shape visually — stacked, beat-gridded waveforms with onset
marks — instead of only from the numbers, and the two can never disagree
since both are rendered from one shared result.

Three shapes to tell apart, each pointing at a different class of cause:

- **Constant offset** — every beat's error is (about) the same nonzero
  value. Points at the Offset arithmetic: a fixed miscalculation somewhere
  in scheduling, not a live drift.
- **Drift** — errors ramp up (or down) across beats. Points at a clock or
  playback-rate mismatch: two clocks disagreeing about how fast time is
  passing, so the gap grows.
- **Jitter** — errors scatter with no consistent trend. Points at
  scheduling raciness: something timing-sensitive firing inconsistently
  (e.g. `setTimeout`-driven scheduling under load), not a systematic
  miscalculation.

There is no automatic classifier in the report — this is a judgment call
the reader (or the reading agent, per the skill in issue #23) makes by eye
or by inspecting the array. A small constant lead in every Track's numbers
is not necessarily sync error: a real-hardware calibration run at
`simulatedLatencyMs: 0` measured a flat ~4ms systematic lead on every Track
and beat, traced to the onset detector's forward-looking energy window
(it starts averaging before the true onset) rather than to sync error —
see issue #19's close-out for the reports it was measured from.

### Missing beats and spurious onsets

Check `missingBeatIndices` and `spuriousOnsetsMs` before reading
`perBeatErrorMs` as a trend — a beat the onset detector never found, or a
double-triggered transient it mistook for two, will distort a shape read
that ignores them. The report states these explicitly rather than folding
them into a shifted error number.

### Don't draw conclusions from a Guide-less pass

This applies to the main app's normal recording, where a pass can be run
without a Guide or with it excluded from the Monitor Mix — that pass
exercises a different Offset path than normal use, and its numbers don't
describe the case a normal recording session is in. It does not describe
diagnostics: since ADR 0006, a diagnostics run is never Guide-less — it
always has its generated Metronome as Guide (see "The diagnostics Guide is
always a Metronome" above). Don't compare diagnostics numbers against a
Guide-ful baseline from an *imported* Guide, though — the Metronome and an
imported Guide are both "Guide-ful," but not necessarily equivalent cases.

## Arming and what it changes about conducting a test

Per ADR 0005, the capture device is armed — acquired and held open —
before the lead-in begins, and released only after a period of idle, not
immediately after each Take. This means:

- **The first Take of a run is not equivalent to its retakes.** The first
  Take pays an `arming-started` → `armed` wait (visible in the panel as its
  own state, distinct from the Count-in Padding "get ready") before the
  lead-in can start. A retake recorded soon after reuses the already-armed
  device and has no arming events at all. When comparing Takes within one
  report's `events` timeline, expect the arming pair on the first one and
  not on the others — that's correct, not a missing event.
- **A long pause between passes may re-trigger arming.** If the device idled
  out and released, the next recording pays the arming wait again.

## The Count-in Padding constant is provisional — and known to be too big

The Count-in Padding is a fixed 1000ms silent interval before the Count-in,
existing solely to let the shared `AudioContext` prime. Measurement from
real sessions (ADR 0005) puts the real priming need at about 200ms, paid
once per `AudioContext` — never again for later Takes on the same context
— against the 1000ms constant currently spent on every single Take. That
slack has been deliberately left unspent rather than trimmed: shrinking the
constant is deferred until the capture-acquisition fix (#24 / ADR 0005) had
landed and been measured, so as not to conflate two changes in one
measurement. If you're using a report's `padding.actualMs` to judge whether
the constant can be shortened, compare it against a *warm* session (same
`audioClock.sessionId` across several Takes) — the first Take of a cold
session pays context creation inside that same window, which isn't the
priming cost the constant is meant to cover.

## History

The cause of the original multi-Track sync drift was unknown when this
harness was designed (ADR 0004); two candidate explanations were examined
during design and discarded. The harness found the real cause — capture
device acquisition, costing anywhere from 349ms to 931ms depending on the
Take — on its first real use, via
the event-timeline report alone, before synthetic capture, onset detection,
or the waveform canvas existed (see ADR 0005 and issue #24's close-out).
The instrument was built to find an unknown cause; it did, and the fix it
found is now the standing case `captureStart.delayAfterCountInMs` guards
against regressing.
