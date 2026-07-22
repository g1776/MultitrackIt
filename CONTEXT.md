# MultitrackIt — Domain Context

## Glossary

**Project**
The top-level container holding everything for one song/piece — its Tracks and Takes. Single-performer only: one person records all Tracks in a Project; no collaborator/contributor concept exists.

**Track**
A slot/lane within a Project that holds the chosen Take(s) for one voice/instrument part, plus its mix and visibility settings (volume, pan, mute, solo). By default a Track is audio+video, coupled as a single unit (one mute/solo state governs both). An audio-only Track is a recognized future variant, not supported today. Independent audio/video visibility control (e.g., muting audio while keeping video visible) is deferred — not in scope for the initial model.

**Take**
A single recording attempt for a Track — one continuous record pass. A Track may hold multiple Takes simultaneously, kept for comparison; exactly one Take is marked as the **selected Take**, which is the one used in playback and Mixdown. Selection is whole-Take only — segment-level comping (splicing pieces of different Takes together) is out of scope for the initial model, a possible future capability.

**Monitor Mix**
The set of playback settings (per-Track/Guide volume, mute) controlling what the performer hears in their headphones while recording a new Take. Distinct from each Track's own mix settings used in the final Project mix/export — e.g., a Guide might be audible in the Monitor Mix but muted in the final export.

**Guide**
Imported reference audio (e.g., a backing track or click/metronome) used for timing/pitch reference while recording. Has no Takes and carries no performance — it is not a Track. Excluded from a Mixdown by default.

**Mixdown**
A rendered output of a Project at a point in time — a snapshot of Layout, per-Track mix settings (volume/pan/mute), and which Take is selected per Track, baked into a single video/audio file. A Project may have multiple Mixdowns (e.g., re-rendered after muting a bad Track or changing Layout) without altering the Project itself.

**Layout**
The visual arrangement of Track video feeds in the output grid — one position/size per visible Track. A Project has a single, static Layout for v1 (one arrangement for the whole song). Time-varying Layout (e.g., switching to a featured-soloist arrangement at a given point in the music) is a known future direction, not modeled yet.

**Offset**
A signed time value stored per Take that shifts its playback position relative to the Project timeline, correcting for recording/monitoring latency so it lines up with other Tracks and the Guide.

**Count-in**
A fixed-duration, visible lead-in shown before recording actually captures audio, giving the shared playback clock time to prime so the Monitor Mix (previously recorded Tracks + Guide) starts in sync with the new Take. Distinct from Offset: Offset corrects where a Take starts once recorded; Count-in exists to let the engine reach a synced-and-ready state before recording begins.
