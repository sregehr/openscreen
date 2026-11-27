// Releases live on a private GitLab project, which the app cannot read without a login. So the
// newest version is published as a small public marker file, and an update is offered as a link
// to that version's GitLab release page, where a signed-in team member downloads it.
//
// The marker is `latest.json` on the `update-feed` branch of the public fork: `{"version":"2.4.1"}`.
// It names a version and nothing else. The page it leads to is built here, from the version, so a
// tampered marker cannot send anyone to another site.
export const UPDATE_FEED_URL =
	"https://raw.githubusercontent.com/sregehr/openscreen/update-feed/latest.json";
const RELEASE_PAGE_PREFIX = "https://gitlab.com/stefan.regehr/screen-recorder/-/releases/";

interface ReleaseResponse {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}

type FetchLatestRelease = (
	url: string,
	init: {
		headers: Record<string, string>;
		signal?: AbortSignal;
	},
) => Promise<ReleaseResponse>;

interface ParsedVersion {
	major: bigint;
	minor: bigint;
	patch: bigint;
	prerelease: string[];
	normalized: string;
}

function parseVersion(value: string): ParsedVersion {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
		value.trim(),
	);
	if (!match) throw new Error(`invalid semantic version: ${value}`);
	const prerelease = match[4]?.split(".") ?? [];
	const coreIdentifiers = [match[1], match[2], match[3]];
	if (
		[...coreIdentifiers, ...prerelease].some(
			(identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier[0] === "0",
		)
	) {
		throw new Error(`invalid semantic version: ${value}`);
	}
	const major = BigInt(match[1]);
	const minor = BigInt(match[2]);
	const patch = BigInt(match[3]);
	const core = `${major}.${minor}.${patch}`;
	return {
		major,
		minor,
		patch,
		prerelease,
		normalized: prerelease.length > 0 ? `${core}-${prerelease.join(".")}` : core,
	};
}

function comparePrerelease(left: string[], right: string[]): number {
	if (left.length === 0 || right.length === 0) {
		return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
	}
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const a = left[i];
		const b = right[i];
		if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
		if (a === b) continue;
		const aNumeric = /^\d+$/.test(a);
		const bNumeric = /^\d+$/.test(b);
		if (aNumeric && bNumeric) return BigInt(a) > BigInt(b) ? 1 : -1;
		if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
		return a > b ? 1 : -1;
	}
	return 0;
}

export function compareVersions(left: string, right: string): number {
	const a = parseVersion(left);
	const b = parseVersion(right);
	for (const key of ["major", "minor", "patch"] as const) {
		if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
	}
	return comparePrerelease(a.prerelease, b.prerelease);
}

export function releasePageUrl(version: string): string {
	return `${RELEASE_PAGE_PREFIX}${encodeURIComponent(`v${parseVersion(version).normalized}`)}`;
}

export type UpdateCheckResult =
	| {
			kind: "available";
			currentVersion: string;
			latestVersion: string;
			releaseUrl: string;
	  }
	| {
			kind: "current";
			currentVersion: string;
			latestVersion: string;
	  };

function feedVersion(payload: unknown): ParsedVersion {
	const version = (payload as { version?: unknown } | null)?.version;
	if (typeof payload !== "object" || payload === null || typeof version !== "string") {
		throw new Error("invalid update feed response");
	}
	return parseVersion(version);
}

export async function checkLatestRelease(options: {
	currentVersion: string;
	fetchLatest: FetchLatestRelease;
	signal?: AbortSignal;
}): Promise<UpdateCheckResult> {
	const current = parseVersion(options.currentVersion);
	const response = await options.fetchLatest(UPDATE_FEED_URL, {
		headers: { Accept: "application/json" },
		...(options.signal ? { signal: options.signal } : {}),
	});
	if (!response.ok) throw new Error(`Update check failed (${response.status})`);

	const latest = feedVersion(await response.json());
	if (compareVersions(latest.normalized, current.normalized) <= 0) {
		return {
			kind: "current",
			currentVersion: current.normalized,
			latestVersion: latest.normalized,
		};
	}

	return {
		kind: "available",
		currentVersion: current.normalized,
		latestVersion: latest.normalized,
		releaseUrl: releasePageUrl(latest.normalized),
	};
}
