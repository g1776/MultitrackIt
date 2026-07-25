# 0004. In-app synthetic-capture harness for diagnosing sync

## Status

Accepted

## Context

Multi-Track sync was being tested by singing a sustained note against the
metronome, recording a second Take at a different pitch, and listening for
whether they lined up. This method cannot distinguish performer error from
engine error, cannot say which Track is ahead, and cannot produce a number —
so a report of "it sounds off" is not actionable, and there is no way to
tell whether a change improved things.

The cause of the drift is not known. Several hypotheses were examined and
discarded during design: the first-Take negative Offset described in ADR
0003 turns out to fire only in Guide-less Projects, not in the normal
workflow, and the fixed Count-in cancelled symmetrically between
`recordTake` and `stopRecording`. The harness is therefore an instrument
for finding an unknown cause, not a fixture for a diagnosed one.

The existing test suite covers `scheduling` and `RecordingEngine` as pure
logic against fake adapters and passes. Vitest runs in `environment:
"node"`, which has no `AudioContext` and no `HTMLVideoElement` — precisely
the components under suspicion, since scheduling is driven by real clock
readings and `setTimeout`-triggered `video.play()` calls in
`browserAdapters.ts`. A headless test of this behaviour would have to
substitute the suspect layer with a fake, and would pass regardless of the
bug.

## Decision

Build a diagnostics harness that runs inside the real Electron renderer,
against the real `BrowserPlaybackAdapter` and real `AudioContext`, in two
modes.

**Mode B (synthetic capture)** substitutes a `SyntheticCaptureAdapter` for
`BrowserCaptureAdapter`. No microphone or camera is involved: it fabricates
the media a flawless performer would have produced, timed against the same
clock the playback graph uses. Capture is the only synthetic part —
playback stays entirely real, which is what isolates the suspect layer. It
exposes a `simulatedLatencyMs` control, defaulting to zero. This is not
optional detail: a harness that always reports zero error is
indistinguishable from a correct one until it is made to report a known
non-zero value, so injecting a deliberate error is how the instrument is
calibrated before its readings are trusted.

**Mode A (acoustic loopback)** plays the synthetic signal through the
speakers and records it through the microphone, with no human performing.
This yields a true round-trip latency figure — output through air to
input — which the app currently cannot obtain, since the Web Audio API
exposes no input-side latency and `getLatencyMs()` estimates output latency
only. It requires speakers rather than headphones; the harness reports
"no onsets detected" plainly rather than emitting a spurious offset.

Mode B is built first and must be green before Mode A's results mean
anything; otherwise the reference is a moving target. A human-in-the-loop
mode was considered and deferred, since it reintroduces exactly the
variability being eliminated.

**Measurement is onset-based.** The signal is a sequence of short beeps on
the beat grid, one per beat, with a per-Track distinct pitch that serves
only to help human ears and eyes tell Tracks apart — it carries no
measurement duty. Each Track's audio is decoded and onset-detected
independently, and each onset compared against the expected beat time
produced by `computeMetronomeClicks` — the same function that generates the
Guide, so expectations cannot drift from what the app actually plays. One
error value per beat rather than one per Track is what distinguishes
constant offset (all errors equal) from drift (errors ramp) from jitter
(errors scatter). Cross-correlation against the Guide was rejected as the
primary measure: it collapses drift into a single average.

**The default scenario is three Tracks of one Take each**, at 100bpm in
4/4 over 16 beats, executed by a single action that drives the real
`recordTake`/`stopRecording` path including real Count-in Padding and
Count-in. Cross-Track sync is the property under test; multiple Takes on
one Track is Take selection, which introduces no timing logic. The
scenario must not shortcut to pushing Takes onto Tracks, as that would skip
the very arithmetic being investigated. A scripted scenario rather than
repeated manual clicks is what makes runs comparable to each other.

**A synthetic Take is an ordinary Take.** The engine has no concept of
synthetic-ness; it lives entirely in the capture adapter. Tagging Takes as
synthetic would contaminate the production model to serve the harness and
would mean the harness no longer exercises the real path.

**Output is split by consumer.** A stacked, beat-gridded waveform canvas on
screen serves human gestalt judgement across Tracks. The report file
carries numbers, not images: a downsampled peak array per Track plus
detected onsets and per-beat errors, which support reasoning about cause in
a way a picture does not, and reveal missed beats or double-triggers the
onset detector mishandled. Both are rendered from one shared analysis
result, so the screen and the file can never disagree.

The report includes a full event timeline — monitor-mix start, padding
start and end, Count-in start and end, capture start and stop, and each
schedule entry's computed `startAtMs` and originating Offset — read off the
`AudioContext` clock, for both recording and playback passes. Reporting
only measured error was rejected: the lead-in must be stated data rather
than something inferred from a residual, since offsetting errors can cancel
and present as correct while the performer's experience is plainly wrong.

Reports are written as JSON to a gitignored `diagnostics/` directory at the
repository root, via IPC to the main process. The repository root is chosen
over the conventional Electron `userData` location because these files are
a channel to a coding agent reading the repository, not user-facing
artifacts, and a stable repo-relative path removes the need to relay
absolute paths.

The harness lives in a separate diagnostics panel rather than inline in the
application UI, keeping a hard boundary between the app and the instrument
measuring it — in particular so that a latency-simulation control cannot
sit in the main toolbar silently corrupting a real recording session.

## Consequences

- Sync problems become quantified and attributable: a specific Track,
  a specific beat, a signed millisecond error, and a shape (offset, drift,
  or jitter) that points at a class of cause.
- The harness's own correctness is verifiable via `simulatedLatencyMs`
  rather than assumed.
- Nothing runs in CI. Sync remains unguarded against regression by
  automated tests. This is accepted for now: a regression test written
  before the failure is understood would encode a guess. Once the harness
  identifies the cause, the fixed behaviour may be expressible as a cheap
  headless test, and this decision should be revisited then.
- A scenario run takes real time — three recording passes with real
  padding, Count-in, and 16 beats of performance each — rather than being
  instant. This is inherent in exercising the real path.
- Mode A depends on the machine's speakers and microphone and on ambient
  noise, so its absolute numbers are environment-specific. It is a
  measurement of a particular machine, not a portable assertion.
- `docs/testing-sync.md` documents how to conduct both modes, including the
  speakers-not-headphones requirement, and how to read a report.
