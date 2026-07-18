## Problem Statement

Solo singers and instrumentalists who want to build a full multi-part
arrangement by themselves (e.g. an a cappella-style performance) have no
good desktop-first tool for it. Existing tools like Acapella are
mobile-only, can get expensive, and have a limited feature set. There is no
way today to record one part, then record a second part while hearing the
first, and so on, building up a full arrangement solo.

## Solution

A desktop (Electron) app where a performer creates a Project, then
records one Track at a time — each new Take can be monitored against
previously recorded Tracks (and an optional Guide) in sync — and can play
back the full layered composite at any point. This spec covers the core
record-and-layer loop only; rendering a final shareable file (Mixdown) is a
separate, later feature.

## User Stories

1. As a performer, I want to create a new Project with just a name, so that I can start recording immediately without upfront setup.
2. As a performer, I want to hit record and have it start capturing audio+video right away, so that recording feels immediate with no ceremony.
3. As a performer, I want my first recorded Take to automatically create a new Track, so that I never have to manually set up a Track before recording.
4. As a performer, I want each new Track to get an auto-generated default name (e.g. "Track 1"), so that I'm never forced to name anything.
5. As a performer, I want to rename any Track if I choose to, so that I can label parts like "Soprano" or "Guitar" for clarity.
6. As a performer, I want to record a new Take onto an existing Track, so that I can redo a part I'm not happy with.
7. As a performer, I want all previous Takes on a Track kept (not overwritten) when I record a new one, so that I can compare attempts later.
8. As a performer, I want the most recently recorded Take on a Track to become the selected Take automatically, so that my newest attempt is what plays back by default.
9. As a performer, I want to change which Take is selected on a Track, so that I can pick an earlier attempt if it was actually better.
10. As a performer, I want to hear previously recorded Tracks while recording a new Take, so that I can sing/play in time and in tune with what I've already laid down.
11. As a performer, I want to control the volume of each Track (and Guide) in my monitor mix independently from the final mix, so that I can hear what I need to while recording without it affecting the final sound.
12. As a performer, I want to import a Guide (backing track or click/metronome), so that I have a timing/pitch reference while recording, especially for my very first Track.
13. As a performer, I want the Guide to be excluded from playback of the "final" composite by default, so that it doesn't bleed into what's meant to be the performance.
14. As a performer, I want to mute or solo individual Tracks during playback, so that I can check individual parts or exclude a bad one temporarily.
15. As a performer, I want to adjust each Take's timing offset, so that I can correct for recording latency and keep everything in sync.
16. As a performer, I want to play back all my recorded Tracks together in sync (audio and video), so that I can hear/see the full arrangement building up as I go.
17. As a performer, I want video from multiple Tracks to display together in a grid during playback, so that I can see the a cappella-style composite even before any final export exists.
18. As a performer, I want Track audio and video to always be muted/shown together as one unit, so that I don't have to manage them as separate controls (for now).
19. As a performer, I want my Project (Tracks, Takes, Guide, Monitor Mix settings, Layout) to persist to disk, so that I can close the app and resume working later.

## Implementation Decisions

- **Platform**: Electron (see [ADR-0001](../docs/adr/0001-electron-over-web.md)). Web is explicitly rejected due to AV latency/sync reliability risk in the core recording loop.
- **Core seam**: a single in-process **recording engine** module owns Project/Track/Take/Guide state, the Monitor Mix, and playback sync (applying each Take's Offset). It exposes an interface along the lines of `createProject`, `recordTake(trackId | undefined)`, `stopRecording()`, `selectTake(trackId, takeId)`, `setMonitorMixLevel(trackOrGuideId, level)`, `play()`, `stop()`, `setTrackMuteSolo(trackId, {mute, solo})`, `setTakeOffset(takeId, offsetMs)`.
- Real OS-level audio/video I/O (microphone, camera, speaker output) sits behind a thin **capture/playback adapter interface** implemented for Electron's native APIs. The engine itself depends only on this adapter interface, not on Electron APIs directly, so the engine can be tested with fake adapters.
- `recordTake` with no existing Track implicitly creates a new Track (auto-named, e.g. "Track N") and records the first Take onto it in one action — there is no separate "add empty Track" step or state.
- Recording a new Take on an existing Track never overwrites or discards prior Takes; the new Take is appended and automatically becomes the Track's selected Take.
- No forced auto-playback occurs after stopping a recording. The engine simply marks the new Take selected and returns to idle; playing it back or recording again are both explicit user-initiated actions.
- **Monitor Mix** is a distinct set of playback levels (per-Track, per-Guide) used only while recording, independent of each Track's own mix settings used during regular composite playback.
- **Guide** is modeled as its own entity (not a Track): no Takes, no performance semantics, always excluded from composite playback by default.
- **Layout** for this spec is a simple, static grid (one cell per visible Track's video) — no time-varying layout logic yet.
- **Offset** is a signed per-Take time value applied during playback/sync to correct recording latency; it does not alter the underlying recorded media.
- Track audio and video remain coupled under one mute/solo state (per existing CONTEXT.md decision); independent audio/video visibility is out of scope.
- Project persistence: Project state (Tracks, Takes and their selection, Guide, Monitor Mix, Layout, Offsets) and associated media files are saved to local disk so a Project can be reopened later. Exact file format/schema is an implementation detail left to the engineering ticket, not fixed here.

## Testing Decisions

- Tests should exercise the recording engine module directly, through its public interface (`recordTake`, `stopRecording`, `selectTake`, `play`, etc.), using fake capture/playback adapters — never asserting against Electron or OS-level AV APIs.
- Good tests here assert on resulting engine state and emitted events (e.g., "after `recordTake` then `stopRecording` twice on the same Track, there are two Takes and the second is selected") rather than internal implementation details of how capture is wired up.
- Sync/offset behavior should be tested by asserting the computed playback schedule/timing given a set of Takes with different Offsets, not by measuring real wall-clock audio.
- This is a greenfield module, so there is no prior art in this repo yet; this suite establishes the pattern for future engine-level tests.

## Out of Scope

- Mixdown / export to a shareable file (a separate, later feature).
- Segment-level comping (splicing pieces of different Takes together).
- Time-varying Layout (e.g. switching to a featured-soloist arrangement at a given point in the music).
- Independent audio/video mute or visibility per Track.
- Multi-performer/collaborator support.
- Audio-only Tracks (future variant, not supported now).

## Further Notes

This is the first buildable feature for MultitrackIt and intentionally stops short of export so the core "can I layer myself singing/playing multiple parts and have it feel right" loop can be built and validated on its own. See [CONTEXT.md](../CONTEXT.md) for full domain vocabulary (Project, Track, Take, Monitor Mix, Guide, Mixdown, Layout, Offset) and [ADR-0001](../docs/adr/0001-electron-over-web.md) for the platform decision.
