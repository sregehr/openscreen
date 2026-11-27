import { describe, expect, it, vi } from "vitest";
import { checkLatestRelease, compareVersions } from "./update-checker";

function releaseResponse(payload: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: vi.fn().mockResolvedValue(payload),
	};
}

describe("compareVersions", () => {
	it("implements semantic version ordering for stable and prerelease builds", () => {
		expect(compareVersions("v2.0.0", "1.9.9")).toBeGreaterThan(0);
		expect(compareVersions("1.9.0", "1.9.0-rc.2")).toBeGreaterThan(0);
		expect(compareVersions("1.9.0-rc.10", "1.9.0-rc.2")).toBeGreaterThan(0);
		expect(compareVersions("1.9.0+build.2", "v1.9.0+build.1")).toBe(0);
	});

	it("preserves precision for oversized core identifiers", () => {
		expect(compareVersions("9007199254740993.0.0", "9007199254740992.0.0")).toBeGreaterThan(0);
	});

	it.each([
		"01.0.0",
		"1.02.0",
		"1.0.03",
		"1.0.0-rc.01",
	])("rejects leading-zero numeric identifiers in %s", (version) => {
		expect(() => compareVersions(version, "1.0.0")).toThrow("invalid semantic version");
	});
});

describe("checkLatestRelease", () => {
	const FEED = "https://raw.githubusercontent.com/sregehr/openscreen/update-feed/latest.json";

	it("reports a newer version and links to its GitLab release page", async () => {
		const fetchLatest = vi.fn().mockResolvedValue(releaseResponse({ version: "1.10.0" }));

		await expect(checkLatestRelease({ currentVersion: "1.9.0", fetchLatest })).resolves.toEqual({
			kind: "available",
			currentVersion: "1.9.0",
			latestVersion: "1.10.0",
			releaseUrl: "https://gitlab.com/stefan.regehr/screen-recorder/-/releases/v1.10.0",
		});
		expect(fetchLatest).toHaveBeenCalledWith(
			FEED,
			expect.objectContaining({
				headers: expect.objectContaining({ Accept: "application/json" }),
			}),
		);
	});

	it("accepts a marker version written with a leading v", async () => {
		const fetchLatest = vi.fn().mockResolvedValue(releaseResponse({ version: "v2.0.0" }));

		await expect(
			checkLatestRelease({ currentVersion: "1.9.0", fetchLatest }),
		).resolves.toMatchObject({
			latestVersion: "2.0.0",
			releaseUrl: "https://gitlab.com/stefan.regehr/screen-recorder/-/releases/v2.0.0",
		});
	});

	it("reports current when the installed version is equal or newer", async () => {
		const fetchLatest = vi.fn().mockResolvedValue(releaseResponse({ version: "1.9.0" }));

		await expect(checkLatestRelease({ currentVersion: "1.9.1", fetchLatest })).resolves.toEqual({
			kind: "current",
			currentVersion: "1.9.1",
			latestVersion: "1.9.0",
		});
		await expect(checkLatestRelease({ currentVersion: "1.9.0", fetchLatest })).resolves.toEqual({
			kind: "current",
			currentVersion: "1.9.0",
			latestVersion: "1.9.0",
		});
	});

	it("forwards the cancellation signal", async () => {
		const fetchLatest = vi.fn().mockResolvedValue(releaseResponse({ version: "1.9.0" }));
		const controller = new AbortController();

		await checkLatestRelease({
			currentVersion: "1.9.0",
			fetchLatest,
			signal: controller.signal,
		});

		expect(fetchLatest).toHaveBeenCalledWith(
			FEED,
			expect.objectContaining({ signal: controller.signal }),
		);
	});

	// The page is built from the version, so nothing in the marker can name another site.
	it("ignores a URL in the marker", async () => {
		const fetchLatest = vi
			.fn()
			.mockResolvedValue(releaseResponse({ version: "9.9.9", url: "https://example.com/app.dmg" }));

		await expect(
			checkLatestRelease({ currentVersion: "1.9.0", fetchLatest }),
		).resolves.toMatchObject({
			releaseUrl: "https://gitlab.com/stefan.regehr/screen-recorder/-/releases/v9.9.9",
		});
	});

	it.each([
		"9.9.9/../../../evil",
		"9.9.9?x=1",
		"latest",
	])("rejects a marker version that is not a version: %s", async (version) => {
		const fetchLatest = vi.fn().mockResolvedValue(releaseResponse({ version }));

		await expect(checkLatestRelease({ currentVersion: "1.9.0", fetchLatest })).rejects.toThrow(
			"invalid semantic version",
		);
	});

	it("rejects unsuccessful or malformed responses", async () => {
		const unavailable = vi.fn().mockResolvedValue(releaseResponse({}, 503));
		await expect(
			checkLatestRelease({ currentVersion: "1.9.0", fetchLatest: unavailable }),
		).rejects.toThrow("Update check failed (503)");

		for (const payload of [{}, null, [], "2.0.0", { version: 2 }]) {
			const malformed = vi.fn().mockResolvedValue(releaseResponse(payload));
			await expect(
				checkLatestRelease({ currentVersion: "1.9.0", fetchLatest: malformed }),
			).rejects.toThrow("invalid update feed response");
		}
	});
});
