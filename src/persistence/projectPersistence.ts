import type { MediaFile, ProjectSnapshot } from "./types";

/** Fetches the bytes and MIME type for a live mediaRef (e.g. a blob: URL) so it can be persisted. */
export type FetchMedia = (mediaRef: string) => Promise<{ bytes: ArrayBuffer; mimeType: string }>;

/** Creates a live, playable mediaRef (e.g. a blob: URL) from persisted bytes. */
export type CreateMediaRef = (bytes: ArrayBuffer, mimeType: string) => string;

function stableMediaFileName(ref: string, extension: string): string {
  return `${ref}.${extension}`;
}

function extensionForMimeType(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0];
  return subtype || "bin";
}

/**
 * Rewrites a Project snapshot's Take/Guide `mediaRef`s (live, in-memory
 * handles such as blob: URLs) to stable file names suitable for saving to
 * disk, and fetches the bytes behind each unique ref via `fetchMedia`.
 * Decoupled from any real storage/blob API so it can be unit-tested with a
 * fake `fetchMedia`, per the engine's adapter-injection testing convention.
 */
export async function prepareSnapshotForSave(
  snapshot: ProjectSnapshot,
  fetchMedia: FetchMedia
): Promise<{ snapshot: ProjectSnapshot; media: MediaFile[] }> {
  const fileNamePromiseByRef = new Map<string, Promise<string>>();
  const media: MediaFile[] = [];

  function fileNameFor(ref: string, baseName: string): Promise<string> {
    const cached = fileNamePromiseByRef.get(ref);
    if (cached) return cached;

    const promise = fetchMedia(ref).then(({ bytes, mimeType }) => {
      const fileName = stableMediaFileName(baseName, extensionForMimeType(mimeType));
      media.push({ ref: fileName, bytes, mimeType });
      return fileName;
    });
    fileNamePromiseByRef.set(ref, promise);
    return promise;
  }

  const tracks = await Promise.all(
    snapshot.tracks.map(async (track) => ({
      ...track,
      takes: await Promise.all(
        track.takes.map(async (take) => ({
          ...take,
          mediaRef: await fileNameFor(take.mediaRef, take.id),
        }))
      ),
    }))
  );

  const guide = snapshot.guide
    ? { ...snapshot.guide, mediaRef: await fileNameFor(snapshot.guide.mediaRef, "guide") }
    : null;

  return { snapshot: { ...snapshot, tracks, guide }, media };
}

/**
 * Reverses `prepareSnapshotForSave`: rewrites a loaded snapshot's Take/Guide
 * `mediaRef`s (stable file names) back to live, playable handles via
 * `createMediaRef`, using the accompanying `media` bytes.
 */
export function rehydrateSnapshot(
  saved: { snapshot: ProjectSnapshot; media: MediaFile[] },
  createMediaRef: CreateMediaRef
): ProjectSnapshot {
  const mediaByRef = new Map(saved.media.map((m) => [m.ref, m]));

  function liveRefFor(fileName: string): string {
    const file = mediaByRef.get(fileName);
    if (!file) throw new Error(`Missing media file for ref ${fileName}`);
    return createMediaRef(file.bytes, file.mimeType);
  }

  const tracks = saved.snapshot.tracks.map((track) => ({
    ...track,
    takes: track.takes.map((take) => ({ ...take, mediaRef: liveRefFor(take.mediaRef) })),
  }));

  const guide = saved.snapshot.guide
    ? { ...saved.snapshot.guide, mediaRef: liveRefFor(saved.snapshot.guide.mediaRef) }
    : null;

  return { ...saved.snapshot, tracks, guide };
}
