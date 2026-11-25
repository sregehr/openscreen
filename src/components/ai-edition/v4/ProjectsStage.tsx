// ProjectsStage — the "Projects" mode of the editor: every saved project as a card, with a
// frame of its footage, searchable, one click from being open in the editor.

import { Film, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toFileUrl } from "@/components/video-editor/projectPersistence";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import type { AiEditionProjectSummary } from "@/native/contracts";
import styles from "./EditorShellV4.module.css";

const THUMB_GRADIENTS = [
	"linear-gradient(135deg, #3b6cff 0%, #7a4dff 100%)",
	"linear-gradient(135deg, #0ea5a4 0%, #2563eb 100%)",
	"linear-gradient(135deg, #f97316 0%, #db2777 100%)",
	"linear-gradient(135deg, #16a34a 0%, #0d9488 100%)",
	"linear-gradient(135deg, #9333ea 0%, #e11d48 100%)",
];

/** `m:ss`, or `h:mm:ss` past an hour — a card has no room for tenths. */
export function formatProjectDuration(seconds: number): string {
	const total = Math.max(0, Math.round(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = String(total % 60).padStart(2, "0");
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/** Title matches first; a blank query keeps everything, in the order given. */
export function filterProjects<T extends { title: string }>(projects: T[], query: string): T[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return projects;
	return projects.filter((project) => project.title.toLowerCase().includes(needle));
}

interface ProjectThumbProps {
	path: string | null | undefined;
	gradient: string;
}

/** A frame of the project's footage, or a gradient when there is none or it will not load. */
function ProjectThumb({ path, gradient }: ProjectThumbProps) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [visible, setVisible] = useState(false);
	const [failed, setFailed] = useState(false);

	// Only cards scrolled into view open their video: a long library must not start a
	// decoder per project.
	useEffect(() => {
		const node = ref.current;
		if (!node || visible) return;
		if (typeof IntersectionObserver === "undefined") {
			setVisible(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
			},
			{ rootMargin: "200px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [visible]);

	const showVideo = Boolean(path) && visible && !failed;
	return (
		<div ref={ref} className={styles.projectThumb} style={{ background: gradient }}>
			{showVideo && path ? (
				<video
					// The media fragment seeks past the first frame, which is often blank.
					src={`${toFileUrl(path)}#t=0.5`}
					muted
					playsInline
					preload="metadata"
					tabIndex={-1}
					aria-hidden
					onError={() => setFailed(true)}
				/>
			) : (
				<Film size={30} strokeWidth={1.8} />
			)}
		</div>
	);
}

export interface ProjectsStageProps {
	projects: AiEditionProjectSummary[];
	activeProjectId: string | null;
	onOpen: (id: string) => void;
	onNew: () => void;
	/** Deletes the project and keeps its recordings. */
	onDelete: (id: string) => Promise<void> | void;
}

export function ProjectsStage({
	projects,
	activeProjectId,
	onOpen,
	onNew,
	onDelete,
}: ProjectsStageProps) {
	const t = useScopedT("editor");
	const tc = useScopedT("common");
	const { locale } = useI18n();
	const [query, setQuery] = useState("");
	// Deleting cannot be undone, so the trash arms a confirm on its own card first.
	const [confirmId, setConfirmId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);

	const filtered = filterProjects(projects, query);
	const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
	const formatDate = (iso: string) => {
		const date = new Date(iso);
		return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
	};

	const confirmDelete = async (id: string) => {
		setDeleting(true);
		try {
			await onDelete(id);
			setConfirmId(null);
		} finally {
			setDeleting(false);
		}
	};

	return (
		<div className={styles.mediaStage}>
			<div className={styles.mediaInner} style={{ maxWidth: 1120 }}>
				<div className={styles.mediaSearchRow}>
					<Search size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("openProjectDialog.searchPlaceholder")}
						aria-label={t("openProjectDialog.searchPlaceholder")}
					/>
					<button type="button" className={styles.projectsNewBtn} onClick={onNew}>
						<Plus size={14} />
						{t("topbar.newProject")}
					</button>
				</div>
				{projects.length === 0 ? (
					<div className={styles.mediaHint}>{t("projectsStage.empty")}</div>
				) : filtered.length === 0 ? (
					<div className={styles.mediaHint}>{t("openProjectDialog.noMatches", { query })}</div>
				) : (
					<div className={styles.projectsGrid}>
						{filtered.map((project, i) => {
							const isActive = project.id === activeProjectId;
							const confirming = project.id === confirmId;
							return (
								<div
									key={project.id}
									className={`${styles.projectCard}${isActive ? ` ${styles.selected}` : ""}`}
								>
									<button
										type="button"
										className={styles.projectOpenBtn}
										aria-current={isActive ? "true" : undefined}
										onClick={() => onOpen(project.id)}
									>
										<ProjectThumb
											path={project.thumbnailPath}
											gradient={THUMB_GRADIENTS[i % THUMB_GRADIENTS.length]}
										/>
										<span className={styles.projectBadges}>
											{project.durationSec ? (
												<span className={styles.projectDuration}>
													{formatProjectDuration(project.durationSec)}
												</span>
											) : null}
											{isActive ? (
												<span className={styles.projectBadge}>{t("projectsStage.current")}</span>
											) : null}
										</span>
										<div className={styles.projectMeta}>
											<div className={styles.mediaCardName}>{project.title}</div>
											<div className={styles.projectDate}>{formatDate(project.updatedAt)}</div>
										</div>
									</button>
									{confirming ? (
										<div className={styles.projectConfirm} role="alertdialog">
											<span>{t("openProjectDialog.confirmDelete")}</span>
											<div className={styles.projectConfirmActions}>
												<button
													type="button"
													onClick={() => setConfirmId(null)}
													disabled={deleting}
												>
													{tc("actions.cancel")}
												</button>
												<button
													type="button"
													data-danger
													onClick={() => void confirmDelete(project.id)}
													disabled={deleting}
												>
													{tc("actions.delete")}
												</button>
											</div>
										</div>
									) : (
										<button
											type="button"
											className={styles.projectDeleteBtn}
											aria-label={`${t("openProjectDialog.deleteProject")}: ${project.title}`}
											title={t("openProjectDialog.deleteProject")}
											onClick={() => setConfirmId(project.id)}
										>
											<Trash2 size={14} />
										</button>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
