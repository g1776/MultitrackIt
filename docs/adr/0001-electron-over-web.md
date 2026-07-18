# 0001. Electron over a web app

## Status

Accepted

## Context

MultitrackIt's core loop is recording a new Take while monitoring previously
recorded Tracks (and a Guide) in sync, low-latency playback — often for
several minutes at a stretch, with no drift between audio and video. The
product's differentiation from existing tools (e.g. Acapella) is explicitly
*not* being mobile-only.

Web was the first-choice platform for reach and familiar tooling, but the
Web Audio API / MediaRecorder stack does not reliably guarantee the low,
consistent input-to-monitor latency or long-take AV sync this core loop
depends on — behavior varies across browsers and OS audio stacks. Local
storage of large media files (OPFS) is workable, but is secondary to the
latency/sync risk. A shaky recording loop undermines the product's reason
to exist in a way that's hard to diagnose or fix incrementally once shipped.

## Decision

Build MultitrackIt as an **Electron** desktop app rather than a web app.
This keeps web-familiar UI tooling (HTML/CSS/JS) while giving native-ish
audio/video capture and direct filesystem access for storing Takes/Projects
and exporting to share (e.g. to Instagram).

## Consequences

- Cross-platform (Mac/Windows) without maintaining separate native apps.
- Local filesystem access for Take/Project storage and export is
  straightforward, no browser storage quota concerns.
- Distribution requires installers/updates instead of a URL — no
  zero-install web reach.
- A future web-based *viewer/sharing* companion remains possible once the
  recording engine is proven; this ADR only concerns the primary recording
  app.
