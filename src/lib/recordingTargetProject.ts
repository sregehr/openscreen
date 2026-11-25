// Which project the next take belongs in.
//
// Two windows have to agree on this and never exist together: the recording bar, where the
// take is started and where the user can pick its project, and the editor, which files the
// take when it reopens. Starting a recording from the editor closes its window, so "the
// project that was open" does not survive in any store either. Storage is the one thing both
// renderers share and that outlives each of them, and it needs no IPC.
//
// The editor empties it on every import, including the one that finds no take waiting, so a
// choice made for a take that was cancelled cannot steer a later one.

const RECORDING_TARGET_KEY = "openscreen.recordingTargetProjectId";

/** The project the next take goes into, or null for a new project. */
export function readRecordingTargetProject(): string | null {
	try {
		return window.localStorage.getItem(RECORDING_TARGET_KEY);
	} catch {
		// Storage can be unavailable; the take then gets a project of its own.
		return null;
	}
}

/** Sets the project the next take goes into; null asks for a new project. */
export function rememberRecordingTargetProject(projectId: string | null): void {
	try {
		if (projectId) window.localStorage.setItem(RECORDING_TARGET_KEY, projectId);
		else window.localStorage.removeItem(RECORDING_TARGET_KEY);
	} catch {
		// As above.
	}
}

/** Reads the choice and clears it, so it applies to one take. */
export function takeRecordingTargetProject(): string | null {
	const projectId = readRecordingTargetProject();
	rememberRecordingTargetProject(null);
	return projectId;
}
