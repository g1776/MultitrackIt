import type { CreateMediaRef, FetchMedia } from "../persistence/projectPersistence";

/** Reads the bytes/MIME type behind a live blob: URL, for `prepareSnapshotForSave`. */
export const fetchBlobUrlMedia: FetchMedia = async (mediaRef) => {
  const response = await fetch(mediaRef);
  const blob = await response.blob();
  return { bytes: await blob.arrayBuffer(), mimeType: blob.type || "application/octet-stream" };
};

/** Creates a fresh blob: URL from persisted bytes, for `rehydrateSnapshot`. */
export const createBlobUrlMediaRef: CreateMediaRef = (bytes, mimeType) =>
  URL.createObjectURL(new Blob([bytes], { type: mimeType }));
