# 0002. Web Audio API graph for multi-Take audio sync

## Status

Accepted

## Context

Playback (composite mix) and Monitor Mix (recording) both play multiple
Takes plus the Guide simultaneously. Today each Take plays through its own
`<video>` element (Track audio+video is a coupled unit — see `CONTEXT.md`),
started independently via `setTimeout(() => video.play(), startAtMs)`
(`browserAdapters.ts`). Each media element runs its own internal clock and
`.play()` has non-deterministic startup latency, so elements drift apart
from each other during a session even though their intended start times
were computed correctly. This is distinct from `Offset`, which only
corrects where a Take starts, not whether multiple Takes' clocks stay
aligned once started (see `CONTEXT.md`).

Two candidate fixes existed:

1. Keep `<video>` elements as the source of truth and periodically measure
   drift, correcting via `playbackRate` nudges or seeks.
2. Route every Take's audio through a single `AudioContext` graph, using
   its sample-accurate scheduling (`AudioBufferSourceNode.start(when)` /
   graph timing) instead of independent element timers, since Web Audio is
   the standard tool built for exactly this multi-source sync problem.

Because Track audio+video is coupled in one `<video>` element, going with
Web Audio for audio raises a further choice: split audio out of the
existing video element (`MediaElementAudioSourceNode`), or decode each
Take's audio into a separate `AudioBuffer` pipeline entirely, decoupled
from the video file.

## Decision

Rewrite multi-Take audio scheduling (both Monitor Mix during recording and
composite mix during playback) onto a single shared `AudioContext` graph,
using `MediaElementAudioSourceNode` per Take/Guide to pull audio out of the
existing `<video>` elements rather than introducing a second, separately
decoded audio pipeline. Video elements remain the source of truth for
picture and are started from a shared anchor timestamp derived from the
same `AudioContext` clock (folding in the video-anchor fix originally
scoped in #11), rather than each maintaining its own independent
`setTimeout`.

Drift-correction-only (option 1) was rejected: it bounds drift rather than
eliminating it, and doesn't address the root cause (no shared clock).

## Consequences

- Audio-to-audio sync (Take-to-Take, Take-to-Guide) becomes sample-accurate
  in both recording and playback; video-to-audio sync within a single Take
  remains bounded by `HTMLMediaElement` accuracy, which is far less
  perceptible than audio-to-audio drift.
- Recording gains a fixed-duration, visible **Count-in** (see `CONTEXT.md`)
  before capture starts, giving the `AudioContext` graph time to prime;
  playback has no equivalent delay and should feel instant, buffering
  in the background.
- Single source of truth for each Take's audio (the video file) — no
  separate decode/caching pipeline to keep in sync with edits to the
  original media.
- Supersedes #11: the shared-anchor video fix it scoped is folded into this
  broader audio-graph rewrite rather than being built as a standalone
  timestamp-passing mechanism.
