# MultitrackIt — Domain Context

## Glossary

**Project**
The top-level container holding everything for one song/piece — its Tracks and Takes. Single-performer only: one person records all Tracks in a Project; no collaborator/contributor concept exists. A Project owns the **tempo** and **time signature** of the piece: every Track is performed against the same tempo, so it belongs to the song rather than to any one artifact within it (notably, it is not a property of the Guide — an imported Guide has no knowable tempo, but the Project still has one). Both are chosen when the Project is created and read-only thereafter, so nothing recorded or generated against them can be invalidated by a later change; re-tempoing an existing Project is a separate problem, not yet modelled.

**Project timeline**
The single time axis all Tracks and the Guide are positioned on. Its zero point is the instant recording capture begins — that is, the moment the Count-in ends. The Guide's first beat sits at t=0, so a Guide of a given length offers that entire length as recordable timeline; none of it is consumed by getting ready to record. Count-in and Count-in Padding occupy negative time: they precede the timeline rather than occupying its beginning.

**Track**
A slot/lane within a Project that holds the chosen Take(s) for one voice/instrument part, plus its mix and visibility settings (volume, pan, mute, solo). By default a Track is audio+video, coupled as a single unit (one mute/solo state governs both). An audio-only Track is a recognized future variant, not supported today. Independent audio/video visibility control (e.g., muting audio while keeping video visible) is deferred — not in scope for the initial model.

**Take**
A single recording attempt for a Track — one continuous record pass. A Track may hold multiple Takes simultaneously, kept for comparison; exactly one Take is marked as the **selected Take**, which is the one used in playback and Mixdown. Selection is whole-Take only — segment-level comping (splicing pieces of different Takes together) is out of scope for the initial model, a possible future capability.

**Monitor Mix**
The set of playback settings (per-Track/Guide volume, mute) controlling what the performer hears in their headphones while recording a new Take. Distinct from each Track's own mix settings used in the final Project mix/export — e.g., a Guide might be audible in the Monitor Mix but muted in the final export.

**Unprocessed capture**
Recording a Take with the platform's voice-call audio processing — echo cancellation, automatic gain control, noise suppression — turned off. All three are wrong for music, and echo cancellation is actively harmful here: a Monitor Mix sounds during every recording pass by design, so AEC would spend each Take treating the performer's own signal as echo of the Guide. Whether a device honoured the request varies by platform, so what actually applied is read back from the granted capture device and stated in a diagnostics report rather than assumed — a Take's provenance is part of what a measurement of it means. Re-enabling any of them for a performer monitoring on speakers rather than headphones would be a deliberate trade-off, not the default.

**Guide**
Imported reference audio (e.g., a backing track or click/metronome) used for timing/pitch reference while recording. Has no Takes and carries no performance — it is not a Track. Excluded from a Mixdown by default.

**Mixdown**
A rendered output of a Project at a point in time — a snapshot of Layout, per-Track mix settings (volume/pan/mute), and which Take is selected per Track, baked into a single video/audio file. A Project may have multiple Mixdowns (e.g., re-rendered after muting a bad Track or changing Layout) without altering the Project itself.

**Layout**
The visual arrangement of Track video feeds in the output grid — one position/size per visible Track. A Project has a single, static Layout for v1 (one arrangement for the whole song). Time-varying Layout (e.g., switching to a featured-soloist arrangement at a given point in the music) is a known future direction, not modeled yet.

**Offset**
A signed time value stored per Take that shifts its playback position relative to the Project timeline, correcting for recording/monitoring latency so it lines up with other Tracks and the Guide. Latency correction is its *only* meaning: because the Project timeline's zero point is capture start, a Take performed perfectly on a device with no latency has an Offset of zero. Nothing about the lead-in before recording is folded into it.

**Count-in**
A whole number of bars at the Project's tempo and time signature, counted audibly and visibly before recording captures audio, so the performer knows when to come in. Expressed in bars (default one) rather than a fixed duration, because that is how a musician thinks about it. Its clicks come from a dedicated count-in source, never from the Guide — the Guide begins at t=0, when the Count-in ends. The Count-in is purely musical; getting the playback clock ready is the separate job of Count-in Padding. Distinct from Offset: Offset corrects where a Take sits once recorded; the Count-in is what the performer counts along to before that.

**Count-in Padding**
A fixed, silent interval preceding the Count-in, existing solely to give the shared playback clock time to prime so the Count-in's first beat — the performer's primary timing reference — is accurate. It carries no beats and no musical meaning, and is surfaced to the performer as a "get ready" state. Fixed rather than tempo-derived or adaptive, and always applied, so the interval between starting a recording and the first counted beat is the same every time and can be learned.
