# 0005. Arming: capture device acquisition is not instantaneous

## Status

Accepted

Corrects a factual premise of ADR 0003 (recording lead-in and timeline
origin) without reversing any of its decisions — see _Relationship to ADR
0003_ below. Triggers the revisit clause in ADR 0004.

Implemented by #24. The related capture-processing defect, which shares the
gain symptom but not the cause, is #25.

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

### Timing is not the only cost of reacquisition

Reacquiring a device also resets it. On a USB microphone the operating
system's input level maps onto the microphone's own gain, so opening the
device writes over whatever gain the performer had set. A performer using an
external microphone therefore loses their gain staging once per Take, and
spends the beginning of a recording restoring it — a report we have from a
performer using an Apogee HypeMiC with other recording software, whose cause
is the same acquisition step this ADR is about.

This matters to the decision because it means acquisition frequency is not
purely an internal timing concern. Every acquisition is a visible disruption
to the performer's instrument, which argues for acquiring rarely and
predictably rather than silently and often.

(The related question of *which* audio processing constraints are requested at
acquisition — automatic gain control, echo cancellation, noise suppression —
is a separate defect with its own issue. It is not decided here.)

### How this is normally solved

Digital audio workstations open the audio device persistently — Ableton's
audio engine, Pro Tools' Playback Engine — and run a continuous callback,
so recording sets a flag rather than starting a device, and punch-in is
sample-accurate because nothing is negotiated at the punch point. Two things
make that acceptable, and both inform the decision below: the device going
hot is an explicit, visible act (**record-arm**), not a silent background
state; and idle release exists, Reaper offering to close the audio device
when stopped and inactive.

The analogy is directional rather than literal. A DAW negotiates exclusive
access to an audio interface, where reopening is genuinely expensive; and no
DAW holds a camera open. The privacy weight of a lit camera indicator has no
equivalent in Ableton, and is why "hold the device for the whole session" is
not simply inherited here.

## Decision

**Introduce arming as an explicit step, distinct from recording.** Acquiring
the camera and microphone becomes something the performer does — arming —
rather than a side effect of pressing record. While armed, the stream is held
open; per Take, only the `MediaRecorder` is started and stopped. `stopCapture`
stops recording without disarming.

**Arming completes before the lead-in begins.** Recording an unarmed Track
arms it first and waits for readiness, and only then starts the Count-in
Padding. Acquisition is deliberately *not* hidden inside the padding: ADR 0003
made the padding a fixed interval so that the gap between pressing record and
the first counted beat is the same every time and can be learned, and
acquisition varies by 581ms. Hiding it there would either make the lead-in
variable or pad every recording to the worst case. Placing it ahead of the
lead-in keeps the lead-in exactly fixed, and puts acquisition's variance in
dead time, before any timing reference exists. That wait must be visible as
its own state — a variable pause with no explanation reads as a hang.

**Readiness means more than the acquisition promise resolving.** A resolved
`getUserMedia` means a stream object exists, not that frames are flowing:
cameras ramp exposure and gain, and a `MediaRecorder` started at that instant
can produce media whose opening is missing or dark. Arming is complete only on
a positive signal that the device is actually delivering. Without this the
decision merely moves the delay instead of removing it, and — worse — moves it
somewhere the diagnostics report cannot see, since capture would appear to
start on time while the media was short at the front.

**Disarm on idle, not on stop.** A Take is by definition one attempt, and a
Track holds several for comparison, so retakes are the common case and must
not each pay the wait or lose the performer's gain. The device is released
after a period of inactivity rather than immediately after a Take. This is
Reaper's idle-release behaviour, and it recovers most of what
persistent-holding offers at almost none of its cost.

**Holding is an action, not a preference.** A mode setting was considered and
rejected. It would be a preference the performer must first understand to set
correctly, and it leaves the device's state invisible. Arming is a visible
act with visible state: armed means the device is hot, the gain is the
performer's own, and retakes are immediate. It also matches the muscle memory
of every DAW, and it is the affordance that makes holding a device legible
rather than covert.

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
already-armed stream is expected to be fast, but "expected to be" is what
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
  `MediaRecorder.start()` costs on an armed stream, instead of 349-931ms per
  Take.
- A performer's gain staging survives across Takes, because the device is not
  reopened between them.
- Arming introduces a state the app did not have, and every entry point to
  recording must account for it. This is the bulk of the work and the main
  risk: the capture seam currently has no concept of a device being open
  between Takes, and `FakeCaptureAdapter` will need to model one.
- The OS recording indicator is lit while armed rather than only while
  recording. This is a real change and the honest price of the decision. It is
  bounded by idle release and made legible by arming being an explicit act,
  but it is not eliminated.
- Acquisition failure moves earlier and becomes a separate failure mode:
  permission denial or an absent device surfaces on arming rather than at the
  end of a Count-in. This is an improvement — failing after counting a
  performer in is worse — but it is new handling, not free.
- Recording an unarmed Track now has a variable pause before the lead-in,
  where previously the pause sat invisibly *inside* the lead-in, corrupting
  it. Surfacing the wait is better than hiding it, but it is more visible
  waiting than before for a performer who never arms explicitly.
- A stream held while armed can still be lost — OS reclaim, sleep, an
  unplugged device. Idle release shortens the window rather than closing it,
  and recovery from a stream that has died while armed is new work this ADR
  creates and does not solve.
- The measurements here are from one machine on one date. The shape of the
  finding — that acquisition is per-Take, variable, and destructive to device
  settings — is expected to be portable; the specific milliseconds are not.
