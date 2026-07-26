export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Decodes a Take's media (a blob: URL) to mono PCM samples via the given
 * `AudioContext`, for the onset/error analysis to run against. A thin
 * wrapper over `decodeAudioData`, the one place besides signal synthesis
 * that touches a browser audio API directly (ADR 0004) — the analysis
 * itself stays pure and takes decoded samples, not a media ref.
 */
export async function decodeMediaRef(
  mediaRef: string,
  audioContext: AudioContext
): Promise<DecodedAudio> {
  const response = await fetch(mediaRef);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  return { samples: audioBuffer.getChannelData(0), sampleRate: audioBuffer.sampleRate };
}
