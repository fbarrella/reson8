/**
 * Ambient declarations for browser APIs used by the screen-share audio
 * pipeline (PRD 12.7) that aren't yet in TypeScript's bundled `lib.dom.d.ts`
 * as of the TS version pinned in this repo, even though Electron's
 * Chromium implements them (Insertable Streams for MediaStreamTrack).
 * `AudioData` (WebCodecs) is already covered by `lib.dom.d.ts` and needs no
 * declaration here.
 */

interface MediaStreamTrackGeneratorInit {
    kind: "audio" | "video";
}

declare class MediaStreamTrackGenerator<T = AudioData> extends MediaStreamTrack {
    constructor(init: MediaStreamTrackGeneratorInit);
    readonly writable: WritableStream<T>;
}
