import Foundation

/// Converts one source's interleaved-stereo audio to the mix rate, across buffers.
///
/// A microphone delivers in its device's own format, and that is not always 48 kHz: an Apple
/// Studio Display's runs at 44.1 kHz. The mixer used to convert by repeating the nearest
/// source sample, buffer by buffer. That has no filter in it at all, so every component of a
/// voice came back with an image folded into the audible band roughly 33 dB below it — heard
/// as static riding on speech, and absent from the same take on a 48 kHz microphone.
///
/// Three things make this one clean, and each is load-bearing:
///
/// - **A windowed-sinc kernel**, widened when the source is faster than the mix so that
///   downsampling is low-passed below the new Nyquist instead of aliasing.
/// - **State carried between buffers.** The read position and the last few source frames
///   survive from one buffer to the next, so a buffer boundary is not a discontinuity. The
///   kernel needs frames on both sides of each output, so output lags input by `span` source
///   frames (0.4 ms at 44.1 kHz).
/// - **Placement by continuity, not by timestamp.** A buffer of 512 frames at 44.1 kHz is
///   557.28 frames at 48 kHz: no whole number of output frames matches its timestamps, and
///   placing each buffer at its own rounded timestamp left a one-frame hole or overlap at
///   most boundaries. Contiguous buffers are therefore butted against each other, and the
///   difference between that and the timestamps trims the ratio by a fraction of a percent,
///   which is how a device clock that runs a few ppm off its nominal rate is followed.
struct StereoResampler {
	/// Kernel half-width in source frames at unity cutoff. 16 puts the first image of a
	/// 44.1 kHz source more than 80 dB down across the voice band.
	private static let halfTaps = 16
	/// A buffer this far from where the previous one ended is a new run, not a continuation.
	private static let contiguityFrames: Int64 = 64
	/// How far the timestamps may pull the ratio: 8 frames of error is the full 0.2 %.
	private static let maxTrimFrames = 8.0
	private static let trimDivisor = 4_096.0
	/// Sub-frame positions the kernel is tabulated at. Reading the nearest one is a timing
	/// error of at most 1/2048 of a frame: more than 60 dB below a 10 kHz component.
	private static let phaseCount = 1_024

	private let targetRate: Double
	private var sourceRate = 0.0
	private var span = 0
	/// `phaseCount` kernels of `2 * span` weights each, one per sub-frame position. Tabulated
	/// once per run: computing a sine and a cosine per tap, per channel, per output frame cost
	/// a third of a core in a debug build.
	private var kernels: [Float] = []
	/// Source frames not yet fully consumed, left context included. Interleaved stereo.
	private var pending: [Float] = []
	/// Where the next output frame reads, in frames from the start of `pending`.
	private var position = 0.0
	/// The mix frame the next output lands on, while the run is unbroken.
	private var nextFrame: Int64?

	init(targetRate: Double) {
		self.targetRate = targetRate
	}

	/// Forgets the run in progress: the next buffer starts a new one at its own timestamp.
	mutating func reset() {
		pending.removeAll(keepingCapacity: true)
		nextFrame = nil
	}

	/// Resamples one buffer. `frames` is interleaved stereo at `rate`; `timestampFrame` is where
	/// its timestamp puts it on the mix timeline. Returns the converted frames and the mix
	/// frame they start at — possibly none yet, while the kernel waits for its right context.
	mutating func process(
		_ frames: [Float],
		rate: Double,
		timestampFrame: Int64
	) -> (frames: [Float], startFrame: Int64) {
		let frameCount = frames.count / 2
		guard frameCount > 0, rate > 0 else {
			return ([], timestampFrame)
		}

		var trim = 0.0
		if rate == sourceRate, let expected = nextFrame {
			// Where the source data already held ends on the mix timeline: what has been
			// emitted, plus the frames still waiting for their right context.
			let held = (Double(pending.count / 2) - position) / (sourceRate / targetRate)
			let error = Double(timestampFrame) - (Double(expected) + held)
			if abs(error) <= Double(Self.contiguityFrames) {
				// A timestamp is rounded to a mix frame, so an error of a frame is noise, not
				// drift. Past that, positive means the timestamps run ahead of what has been
				// emitted: emit a little more per source frame until they agree again.
				let drift = abs(error) <= 1 ? 0 : error
				trim = min(max(drift, -Self.maxTrimFrames), Self.maxTrimFrames) / Self.trimDivisor
			} else {
				start(rate: rate, firstLeft: frames[0], firstRight: frames[1], at: timestampFrame)
			}
		} else {
			start(rate: rate, firstLeft: frames[0], firstRight: frames[1], at: timestampFrame)
		}

		pending.append(contentsOf: frames)
		let available = pending.count / 2
		let step = sourceRate / targetRate * (1 - trim)
		let startFrame = nextFrame ?? timestampFrame

		var output: [Float] = []
		output.reserveCapacity(Int(Double(frameCount) / step) * 2 + 4)
		while Int(position.rounded(.down)) + span < available {
			let (left, right) = interpolate(at: position)
			output.append(left)
			output.append(right)
			position += step
		}

		// Keep only what the next output still reads: `span` frames to the left of it.
		let consumed = max(0, Int(position.rounded(.down)) - span)
		if consumed > 0 {
			pending.removeFirst(consumed * 2)
			position -= Double(consumed)
		}
		nextFrame = startFrame + Int64(output.count / 2)
		return (output, startFrame)
	}

	private mutating func start(rate: Double, firstLeft: Float, firstRight: Float, at frame: Int64) {
		// Below unity when the source is faster than the mix: the kernel then low-passes at
		// the mix's Nyquist, and stretches by the same factor to keep its shape.
		let cutoff = min(1, targetRate / rate)
		let newSpan = Int((Double(Self.halfTaps) / cutoff).rounded(.up))
		if rate != sourceRate || kernels.isEmpty {
			kernels = Self.makeKernels(span: newSpan, cutoff: cutoff)
		}
		span = newSpan
		sourceRate = rate
		// The run's left context is the first frame held, not silence: a step up from zero
		// would ring through the kernel as a click at the start of every run.
		pending.removeAll(keepingCapacity: true)
		pending.reserveCapacity(span * 2)
		for _ in 0..<span {
			pending.append(firstLeft)
			pending.append(firstRight)
		}
		position = Double(span)
		nextFrame = frame
	}

	/// Hann-windowed sinc, one kernel per sub-frame position, each normalised so a constant
	/// input stays constant. Tap `t` of a kernel weighs the source frame `t + 1 - span` frames
	/// from the one the output sits on or just after.
	private static func makeKernels(span: Int, cutoff: Double) -> [Float] {
		let taps = span * 2
		var table = [Float](repeating: 0, count: phaseCount * taps)
		for phase in 0..<phaseCount {
			let fraction = Double(phase) / Double(phaseCount)
			var weights = [Double](repeating: 0, count: taps)
			var sum = 0.0
			for tap in 0..<taps {
				let distance = Double(tap + 1 - span) - fraction
				let windowPhase = distance / Double(span)
				guard abs(windowPhase) < 1 else {
					continue
				}
				let x = distance * cutoff
				let sinc = abs(x) < 1e-9 ? 1 : sin(.pi * x) / (.pi * x)
				weights[tap] = sinc * (0.5 + 0.5 * cos(.pi * windowPhase))
				sum += weights[tap]
			}
			for tap in 0..<taps {
				table[phase * taps + tap] = Float(weights[tap] / sum)
			}
		}
		return table
	}

	private func interpolate(at centre: Double) -> (Float, Float) {
		let middle = Int(centre.rounded(.down))
		let taps = span * 2
		let phase = min(Self.phaseCount - 1, Int((centre - Double(middle)) * Double(Self.phaseCount)))
		var left: Float = 0
		var right: Float = 0
		kernels.withUnsafeBufferPointer { kernel in
			pending.withUnsafeBufferPointer { source in
				let weights = phase * taps
				let first = (middle + 1 - span) * 2
				for tap in 0..<taps {
					let weight = kernel[weights + tap]
					left += weight * source[first + tap * 2]
					right += weight * source[first + tap * 2 + 1]
				}
			}
		}
		return (left, right)
	}
}
