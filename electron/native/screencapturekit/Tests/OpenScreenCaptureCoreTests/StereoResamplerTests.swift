import Foundation
import XCTest

@testable import OpenScreenCaptureCore

/// Does a source at another rate come out clean, whole and in step with its timestamps?
///
/// The conversion this replaced repeated the nearest source sample. That passes any test of
/// length or level, because the defect is spectral: a 1 kHz tone at 44.1 kHz came back with an
/// image at 4.9 kHz about 33 dB below it. So the first test here measures the image, not the
/// tone.
final class StereoResamplerTests: XCTestCase {
	private let mixRate = 48_000.0

	/// Feeds `seconds` of a tone in buffers of `bufferFrames`, timestamped as a device whose
	/// clock runs `clockError` off nominal would timestamp them.
	private func run(
		sourceRate: Double,
		frequency: Double,
		seconds: Double,
		bufferFrames: Int,
		clockError: Double = 0
	) -> (frames: [Float], starts: [Int64], counts: [Int]) {
		var resampler = StereoResampler(targetRate: mixRate)
		var output: [Float] = []
		var starts: [Int64] = []
		var counts: [Int] = []
		let total = Int(seconds * sourceRate)
		var offset = 0
		while offset < total {
			let count = min(bufferFrames, total - offset)
			var buffer = [Float](repeating: 0, count: count * 2)
			for frame in 0..<count {
				let value = Float(0.5 * sin(2 * .pi * frequency * Double(offset + frame) / sourceRate))
				buffer[frame * 2] = value
				buffer[frame * 2 + 1] = value
			}
			// A fast device delivers its nominal frame count in less real time.
			let realSeconds = Double(offset) / (sourceRate * (1 + clockError))
			let result = resampler.process(
				buffer,
				rate: sourceRate,
				timestampFrame: Int64((realSeconds * mixRate).rounded())
			)
			output.append(contentsOf: result.frames)
			starts.append(result.startFrame)
			counts.append(result.frames.count / 2)
			offset += count
		}
		return (output, starts, counts)
	}

	/// Level of one frequency in the left channel, as a peak amplitude.
	private func amplitude(of frequency: Double, in frames: [Float]) -> Double {
		let count = frames.count / 2
		var real = 0.0
		var imaginary = 0.0
		for frame in 0..<count {
			let phase = 2 * .pi * frequency * Double(frame) / mixRate
			// Hann, so the tone's own skirt does not read as energy at the image.
			let window = 0.5 - 0.5 * cos(2 * .pi * Double(frame) / Double(count))
			let sample = Double(frames[frame * 2]) * window
			real += sample * cos(phase)
			imaginary += sample * sin(phase)
		}
		return 4 * (real * real + imaginary * imaginary).squareRoot() / Double(count)
	}

	func testA441ToneKeepsItsLevelAndLeavesNoAudibleImage() {
		let result = run(sourceRate: 44_100, frequency: 1_000, seconds: 1, bufferFrames: 512)

		let tone = amplitude(of: 1_000, in: result.frames)
		XCTAssertEqual(tone, 0.5, accuracy: 0.005)
		// 44.1 kHz - 1 kHz, folded at the 24 kHz Nyquist: where sample repetition put it.
		let image = amplitude(of: 4_900, in: result.frames)
		XCTAssertLessThan(20 * log10(image / tone), -70)
	}

	func testAFasterSourceIsLowPassedRatherThanAliased() {
		// 30 kHz exists at 96 kHz and cannot exist at 48 kHz: unfiltered, it lands on 18 kHz.
		let result = run(sourceRate: 96_000, frequency: 30_000, seconds: 0.5, bufferFrames: 960)

		XCTAssertLessThan(20 * log10(amplitude(of: 18_000, in: result.frames) / 0.5), -50)
	}

	func testBuffersOfARunButtAgainstEachOther() {
		let result = run(sourceRate: 44_100, frequency: 440, seconds: 2, bufferFrames: 512)

		for index in 1..<result.starts.count {
			XCTAssertEqual(
				result.starts[index],
				result.starts[index - 1] + Int64(result.counts[index - 1]),
				"buffer \(index)"
			)
		}
		// Everything but the kernel's right context has come out.
		let expected = 2 * mixRate
		XCTAssertEqual(Double(result.frames.count / 2), expected, accuracy: 20)
	}

	func testADeviceClockThatRunsFastIsFollowedWithoutBreakingTheRun() {
		// 200 ppm is far outside a real crystal; 20 s of it is 192 frames of disagreement.
		let seconds = 20.0
		let result = run(
			sourceRate: 44_100, frequency: 440, seconds: seconds, bufferFrames: 512, clockError: 200e-6
		)

		for index in 1..<result.starts.count {
			XCTAssertEqual(
				result.starts[index],
				result.starts[index - 1] + Int64(result.counts[index - 1]),
				"buffer \(index) restarted the run"
			)
		}
		// The track is as long as the real time the device took, not its nominal frame count.
		let realFrames = seconds / (1 + 200e-6) * mixRate
		XCTAssertEqual(Double(result.frames.count / 2), realFrames, accuracy: 32)
	}

	func testABufferFarFromThePreviousOneStartsANewRunAtItsOwnTimestamp() {
		var resampler = StereoResampler(targetRate: mixRate)
		let buffer = [Float](repeating: 0.25, count: 512 * 2)
		_ = resampler.process(buffer, rate: 44_100, timestampFrame: 0)

		let later = resampler.process(buffer, rate: 44_100, timestampFrame: 96_000)

		XCTAssertEqual(later.startFrame, 96_000)
	}
}
