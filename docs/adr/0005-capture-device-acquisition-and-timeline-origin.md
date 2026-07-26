# 0005. Capture device acquisition is not instantaneous

## Status

Proposed

Supersedes part of ADR 0003 (recording lead-in and timeline origin) — see
_Relationship to ADR 0003_ below. Triggers the revisit clause in ADR 0004.

## Context

ADR 0003 established that the Project timeline's zero point is the instant
recording capture begins, and that a Take's Offset therefore carries latency
correction and nothing else: a Take performed on a device with no latency has
an Offset of zero, because its own t=0 and the timeline's t=0 are the same
instant.

That premise was never measured. The diagnostics harness from ADR 0004 has now
measured it, and it is false.

`recordTake` awaits `capture.startCapture()` *after* the Count-in has ended.
In `BrowserCaptureAdapter` that call performs `getUserMedia` — negotiating for
the camera and microphone — and then constructs and starts a `MediaRecorder`.
Device acquisition happens at the moment the timeline is supposed to begin,
not before it.

Seven manually performed recording passes, across five sessions and both
Guide-ful and Guide-less Projects, measured the interval between the Count-in
ending and capture actually starting:

| Pass | Gap (ms) |
|---|---|
| 1 | 349.33 |
| 2 | 618.67 |
| 3 | 629.33 |
| 4 | 669.33 |
| 5 | 720.00 |
| 6 | 730.67 |
| 7 | 930.67 |

Mean 664ms, spread 581ms. At the default 100bpm a beat is 600ms, so the
displacement is on the order of a beat and its *variation* is on the order of
a beat.

Three findings shape the decision.

**Every Take pays it.** `stopCapture` calls
`stream.getTracks().forEach(track => track.stop())`, releasing the device, so
the next Take reacquires from scratch. This is not a first-run cost. A
four-pass session on one continuous `AudioContext` measured 930.67, 349.33 and
669.33 on its three successive Takes.

**It is not a constant.** Because each Take is displaced by its own gap while
composite playback aligns every Take at the same `startAtMs`, Tracks within a
single Project land up to 581ms apart from one another. This is the audible
multi-Track sync failure that motivated ADR 0004. No calibrated constant can
correct it; correcting by the mean would still leave successive Takes
hundreds of milliseconds apart.

**The scheduling logic is correct.** ADR 0004 suspected the playback and
scheduling layer. Every `startAtMs` in every recorded schedule is right: a
Monitor Mix entry with Offset -10 against a 3400ms lead-in schedules at 3390,
and a composite schedule normalises Offsets of -10/-10/-10/0 to 0/0/0/10, both
exactly as specified. The `-10ms` latency correction the engine applies is
real and is 1.5% of the error sitting beside it. The fault is entirely in
when capture starts, not in where anything is scheduled.

The same measurements incidentally settle two open questions: `AudioContext`
priming costs ~200ms and is paid once per context, never again (the second and
third Takes of a session measured their Count-in Padding at exactly 1000.00ms
against a requested 1000ms); and the Count-in itself is accurate, measuring
2400.00ms against a requested 2400ms on every warm pass.

## Decision

**Separate device acquisition from recording.** Acquiring the camera and
microphone becomes a distinct step from starting and stopping a Take's
recording. The stream is acquired once and held for the session; per Take,
only the `MediaRecorder` is started and stopped. `stopCapture` stops
recording without releasing the device.

This makes ADR 0003's premise true rather than working around its being
false. Capture can begin when the Count-in ends because there is nothing left
to negotiate at that moment.

**`Offset` keeps its current meaning.** The alternative — stamping actual
capture start and folding the residual into the Take's Offset — was
considered and rejected as the primary fix. It would be exact per Take, and
would collapse the cross-Track error without touching the capture path. But
it widens `Offset` from "latency correction, and nothing else" to "latency
correction plus however late the device happened to be", making a domain
concept absorb an implementation artifact. Every future reader of an Offset
would have to know which part was which. `CONTEXT.md` needs no amendment
under the decision taken here.

**The residual is measured, not assumed.** `MediaRecorder.start()` on an
already-live stream is expected to be fast, but "expected to be" is what
produced this ADR. `captureStart.delayAfterCountInMs` stays in the
diagnostics report as a standing guard: if it is small and stable the premise
holds, and if it is not that is visible immediately rather than by ear. The
fix is not considered done because the code looks right — it is done when the
report says so.

**The Count-in Padding is left alone for now.** It is measured at ~200ms of
real need against a 1000ms constant, and ADR 0003 explicitly flagged that
constant as a guess awaiting this measurement. Shrinking it is deferred: it is
the only slack in the lead-in, and it should not be spent before the capture
change has landed and been measured.

## Relationship to ADR 0003

ADR 0003's decisions stand. Its factual premise did not.

The timeline origin, the bars-based Count-in, the fixed Count-in Padding, and
the meaning of `Offset` are all unchanged and are all reaffirmed by the
measurements above. What is superseded is the implicit assumption that
capture begins when the engine asks it to. ADR 0003 reasoned as though
`startCapture()` were instantaneous; it costs a beat, variably.

That is a correction to a factual premise, not a reversal of a decision,
which is why this ADR restores the premise rather than revising the model
built on it.

## Relationship to ADR 0004

ADR 0004 recorded that the cause of the sync drift was unknown, that two
candidate explanations had been examined and discarded, and that the harness
was "an instrument for finding an unknown cause, not a fixture for a diagnosed
one". The instrument worked: the cause above was found on its first real use,
by the event-timeline report alone, before any synthetic capture, onset
detection, or waveform rendering existed.

ADR 0004 also wrote its own revisit clause:

> Once the harness identifies the cause, the fixed behaviour may be
> expressible as a cheap headless test, and this decision should be revisited
> then.

That clause is now live, and the remaining harness tickets should be
re-triaged against it rather than built on momentum. One point is sharp
enough to state here: ADR 0004 substitutes a synthetic capture adapter on the
reasoning that "playback stays entirely real, which is what isolates the
suspect layer". That reasoning assumed the suspect layer was playback. It is
capture — the layer the synthetic adapter replaces. A synthetic harness built
as currently specified would not reproduce this defect, and would report
green over it.

## Consequences

- Cross-Track sync error from this cause goes to whatever
  `MediaRecorder.start()` costs on a live stream, instead of 349-931ms per
  Take.
- A held-open camera and microphone means the OS recording indicator stays lit
  for the session rather than per Take, and the device is unavailable to other
  applications throughout. This is a visible behavioural change for the
  performer and is the real price of the decision.
- Acquisition failure moves earlier and becomes a separate failure mode:
  permission denial or an absent device now surfaces when acquiring rather
  than at the end of a Count-in. This is an improvement — failing after
  counting a performer in is worse — but it is new handling, not free.
- The capture seam gains a lifecycle it did not have. `CaptureAdapter`
  currently has no concept of a device being open between Takes, and
  `FakeCaptureAdapter` will need to model one.
- Session length now matters in a way it did not: a stream held for an hour
  may be reclaimed by the OS, a laptop may sleep, a device may be unplugged.
  Recovery from a stream that has died mid-session is new work this ADR
  creates and does not solve.
- The measurements here are from one machine on one date. The shape of the
  finding — that acquisition is per-Take and variable — is expected to be
  portable; the specific milliseconds are not.
