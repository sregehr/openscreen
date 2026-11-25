import { webcamBitrateForStream } from "./webcamCaptureTarget";

/**
 * VP8 holds 30 fps up to this frame on Apple Silicon; at 2160p it drops ~40 % of frames.
 *
 * 1088 lines, not 1080: the cap is a 1080p-class frame, and cameras deliver that class in
 * other shapes. An Apple Studio Display Camera asked for 2160p answers 1664x1248 -- 0.15 %
 * more pixels than 1920x1080 -- which sent it to the H.264 encoder this exists to avoid, and
 * a 20 s take held 23 frames with one 13.7 s freeze. 1920x1088 is the frame a 1080p encoder
 * works on anyway (macroblocks are 16 px), so the VP8 measurement covers it.
 */
const MAX_VP8_PIXELS = 1920 * 1088;

/** Keep webcam encoding independent of the screen recorder's codec preference. */
export function webcamRecorderOptions(
	stream: MediaStream | null,
	platform: string,
	isTypeSupported: (mimeType: string) => boolean = (type) => MediaRecorder.isTypeSupported(type),
): MediaRecorderOptions {
	// Chromium's macOS H.264 camera encoder can stop delivering frames while the
	// stream remains live. VP8 avoids that path, but its software encoder cannot
	// keep up above 1080p, so larger (or unknown, i.e. default 2160p) frames stay on H.264.
	const settings = stream?.getVideoTracks()[0]?.getSettings();
	const pixels = (settings?.width ?? 0) * (settings?.height ?? 0);
	const preferVp8 = platform === "darwin" && pixels > 0 && pixels <= MAX_VP8_PIXELS;
	const codecs = preferVp8 ? ["vp8", "vp9", "h264"] : ["h264", "vp8", "vp9"];
	const mimeType = codecs.map((codec) => `video/webm;codecs=${codec}`).find(isTypeSupported);
	return {
		...(mimeType ? { mimeType } : {}),
		videoBitsPerSecond: webcamBitrateForStream(stream),
	};
}
