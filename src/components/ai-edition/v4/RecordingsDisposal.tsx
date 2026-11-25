import { useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import type {
	AiEditionProjectRecordingsResult,
	AiEditionRecordingsDisposal,
} from "@/native/contracts";
import { formatBytes } from "@/utils/formatBytes";
import { getPlatform } from "@/utils/platformUtils";
import { Toggle } from "../RightPanes";

/**
 * The "also remove the recording files" half of a delete confirm: which files the delete
 * could take with it, whether the user asked for that, and whether the Trash refused.
 *
 * Recordings are kept unless the user opts in, and a refused Trash offers a permanent delete
 * instead of failing silently — the same contract as the Open project dialog.
 */
export function useRecordingsDisposal() {
	const [recordings, setRecordings] = useState<AiEditionProjectRecordingsResult | null>(null);
	const [trash, setTrash] = useState(false);
	const [trashFailed, setTrashFailed] = useState(false);
	// A slow answer for a confirm that has since been closed or re-armed must not land.
	const armed = useRef(0);

	const arm = (load: (() => Promise<AiEditionProjectRecordingsResult>) | null) => {
		armed.current += 1;
		const token = armed.current;
		setRecordings(null);
		setTrash(false);
		setTrashFailed(false);
		if (!load) return;
		void load()
			.then((result) => {
				if (armed.current === token && result.success) setRecordings(result);
			})
			// Without the answer there is no toggle, and the delete keeps the recordings.
			.catch(() => undefined);
	};

	const disposal: AiEditionRecordingsDisposal = trashFailed
		? "permanent"
		: trash && recordings && recordings.count > 0
			? "trash"
			: "keep";

	return { recordings, trash, setTrash, trashFailed, setTrashFailed, arm, disposal };
}

export type RecordingsDisposalState = ReturnType<typeof useRecordingsDisposal>;

/** The toggle and the notes about recordings that are kept. Renders nothing when there are none. */
export function RecordingsDisposalOptions({ state }: { state: RecordingsDisposalState }) {
	const t = useScopedT("editor");
	const { recordings, trash, setTrash, trashFailed } = state;
	if (trashFailed || !recordings) return null;
	const alsoKey =
		getPlatform() === "win32" ? "openProjectDialog.alsoRecycle" : "openProjectDialog.alsoTrash";
	const alsoLabel = t(alsoKey, { size: formatBytes(recordings.sizeBytes) });
	return (
		<>
			{recordings.count > 0 ? (
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<Toggle checked={trash} onChange={setTrash} ariaLabel={alsoLabel} />
					<span>{alsoLabel}</span>
				</div>
			) : null}
			{recordings.keptFor.length > 0 ? (
				<span style={{ color: "var(--muted)" }}>
					{t("openProjectDialog.recordingsKeptFor", { projects: recordings.keptFor.join(", ") })}
				</span>
			) : null}
			{recordings.unreadable > 0 ? (
				<span style={{ color: "var(--muted)" }}>
					{t("openProjectDialog.recordingsKeptUnreadable")}
				</span>
			) : null}
		</>
	);
}

/** The confirm's question, which becomes the offer to delete permanently once the Trash refused. */
export function useTrashFailedText() {
	const t = useScopedT("editor");
	return t(
		getPlatform() === "win32" ? "openProjectDialog.recycleFailed" : "openProjectDialog.trashFailed",
	);
}
