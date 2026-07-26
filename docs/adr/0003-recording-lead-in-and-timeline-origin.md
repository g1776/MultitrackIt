# 0003. Recording lead-in and Project timeline origin

## Status

Accepted

Amended by ADR 0005. Every decision below stands, and the measurements in
ADR 0005 reaffirm them. What ADR 0005 corrects is an unmeasured premise this
ADR reasoned from: that capture begins when the engine asks it to. It does
not — device acquisition costs a beat, variably — so "the timeline's zero
point is capture start" was true of the model and false of the code until
ADR 0005 was implemented.

## Context

Recording began with a fixed 3000ms Count-in (`DEFAULT_COUNT_IN_MS`),
introduced by ADR 0002 to give the shared `AudioContext` graph time to
prime before capture starts. Three problems emerged with that design.

First, a fixed duration is not how a musician thinks. A performer expects
to be counted in for a bar or two at the song's tempo, not for three
seconds. At 100bpm in 4/4 a 3000ms count-in lands five beats in — mid-bar,
and mid-bar at almost every tempo.

Second, the Count-in was consuming the Guide. The Monitor Mix schedule
placed the Guide at `offsetMs: 0` and playback began at Count-in start, so
the first three seconds of the Guide elapsed before capture began. A
generated 16-bar metronome Guide therefore offered only about 15 bars to
record against, with nothing indicating this to the user.

Third, the Count-in leaked into the Offset model. Because the Monitor Mix
started before capture did, `stopRecording` folded `countInMs` into every
new Take's Offset to compensate. That made Offset a compound of two
unrelated concerns, and required an `activeRecordingHadMonitorMix`
special-case to skip the correction when there was nothing to sync
against — a branch that produced a small negative Offset for the very
first Take of a Guide-less Project, and a corresponding shift of the whole
schedule in `computePlaybackSchedule`'s negative-offset normalization.

Expressing the Count-in in bars raises a further problem: at fast tempos a
one-bar Count-in is short (667ms at 180bpm in 2/4), possibly too short to
prime the graph. Candidate resolutions were a minimum duration floor
(musically wrong — the Count-in stops landing on beats), rounding up to
additional whole bars (musical, but the Count-in length then varies with
tempo in a way the user did not ask for), or separating priming from
counting entirely.

## Decision

Separate the two concerns that the fixed Count-in had conflated, and move
the timeline origin.

**Count-in Padding** is a fixed, silent interval before the Count-in whose
only job is priming the playback clock. It is always applied, regardless of
tempo, and surfaced as a "get ready" state. Making it unconditional was a
deliberate choice over `max(0, floor - barMs)`: a conditional padding would
appear and disappear as the tempo slider moved, changing the shape of the
recording flow at an invisible boundary. Always applying it means "start
recording, get ready, one bar of clicks, record" describes every session at
every tempo, and the interval before the first beat is constant and
learnable. It is fixed rather than adaptive (waiting until the graph
reports ready) for the same reason: a variable lead would put a variable
term into every measurement and defeat run-to-run comparison.

**Count-in** is a whole number of bars (default one) at the Project's
tempo, with its own dedicated click source. This requires tempo and time
signature to become persisted properties of the Project; previously they
existed only as transient renderer state used to synthesise the metronome
Guide, and the engine had no access to them.

**The Project timeline's zero point is capture start** — the instant the
Count-in ends. The Guide and previously recorded Takes begin at t=0, not at
Count-in start. Padding and Count-in occupy negative time.

The provisional padding duration is 1000ms. The true priming requirement is
unknown; the diagnostics harness of ADR 0004 records monitor-start and
capture-start on the `AudioContext` clock on every run, so an insufficient
value will be visible rather than silent, and the constant can be corrected
from measurement instead of guessed.

## Consequences

- A Guide of a given length yields that entire length as recordable
  timeline. Nothing is consumed by the lead-in.
- Offset reverts to meaning latency correction and nothing else. A Take
  performed perfectly on a zero-latency device has Offset 0. The
  `activeRecordingHadMonitorMix` special-case and the first-Take negative
  Offset it produced become unreachable rather than merely rare, and the
  negative-offset normalization path in `computePlaybackSchedule` is no
  longer exercised by ordinary recording.
- Tempo and time signature enter the domain model and the persisted
  Project snapshot. Existing snapshots lack them and need a default
  (100bpm, 4/4) on load.
- Every tempo pays the padding cost, including slow tempos where the
  Count-in alone would have sufficed. This is accepted in exchange for
  uniform behaviour, and is revisable: shortening the constant is the
  intended lever if the dead time proves annoying, not making it
  conditional.
- This decision is expected to simplify the code most suspected of causing
  multi-Track sync drift, but it is not a diagnosis. The cause of that
  drift remains unknown at the time of writing; see ADR 0004.
