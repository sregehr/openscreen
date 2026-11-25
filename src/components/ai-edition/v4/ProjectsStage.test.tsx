// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import type { AiEditionProjectSummary } from "@/native/contracts";
import { filterProjects, formatProjectDuration, ProjectsStage } from "./ProjectsStage";

function renderWithI18n(ui: ReactElement) {
	return render(<I18nProvider>{ui}</I18nProvider>);
}

const PROJECTS: AiEditionProjectSummary[] = [
	{
		id: "proj_a",
		title: "Launch demo",
		updatedAt: "2026-11-20T10:00:00.000Z",
		assetCount: 1,
		durationSec: 83,
		thumbnailPath: null,
	},
	{
		id: "proj_b",
		title: "Onboarding walkthrough",
		updatedAt: "2026-11-18T10:00:00.000Z",
		assetCount: 0,
		durationSec: 0,
		thumbnailPath: null,
	},
];

function renderStage(overrides: Partial<Parameters<typeof ProjectsStage>[0]> = {}) {
	const props = {
		projects: PROJECTS,
		activeProjectId: "proj_a",
		onOpen: vi.fn(),
		onNew: vi.fn(),
		onDelete: vi.fn(async () => undefined),
		loadRecordings: vi.fn(async () => ({
			success: true,
			count: 0,
			sizeBytes: 0,
			keptFor: [],
			unreadable: 0,
		})),
		...overrides,
	};
	renderWithI18n(<ProjectsStage {...props} />);
	return props;
}

describe("formatProjectDuration", () => {
	it("formats minutes and hours without tenths", () => {
		expect(formatProjectDuration(0)).toBe("0:00");
		expect(formatProjectDuration(83.4)).toBe("1:23");
		expect(formatProjectDuration(3725)).toBe("1:02:05");
	});
});

describe("filterProjects", () => {
	it("matches titles case-insensitively and keeps everything for a blank query", () => {
		expect(filterProjects(PROJECTS, "  ")).toEqual(PROJECTS);
		expect(filterProjects(PROJECTS, "ONBOARD").map((p) => p.id)).toEqual(["proj_b"]);
	});
});

describe("ProjectsStage", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("lists every project and marks the open one", () => {
		renderStage();
		expect(screen.getByText("Launch demo")).toBeInTheDocument();
		expect(screen.getByText("Onboarding walkthrough")).toBeInTheDocument();
		expect(screen.getByText("1:23")).toBeInTheDocument();
		expect(screen.getByRole("button", { current: true })).toHaveTextContent("Launch demo");
	});

	it("opens the clicked project", () => {
		const { onOpen } = renderStage();
		fireEvent.click(screen.getByText("Onboarding walkthrough"));
		expect(onOpen).toHaveBeenCalledWith("proj_b");
	});

	it("narrows the grid as the user searches", () => {
		renderStage();
		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "launch" } });
		expect(screen.getByText("Launch demo")).toBeInTheDocument();
		expect(screen.queryByText("Onboarding walkthrough")).not.toBeInTheDocument();

		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
		expect(screen.getByText(/no projects match "zzz"/i)).toBeInTheDocument();
	});

	it("deletes only after the card's confirm", async () => {
		const { onDelete } = renderStage();
		fireEvent.click(screen.getByRole("button", { name: /delete project: onboarding/i }));
		expect(onDelete).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => expect(onDelete).toHaveBeenCalledWith("proj_b", "keep"));
	});

	it("moves a project's recordings to the Trash only when the toggle is on", async () => {
		const { onDelete } = renderStage({
			loadRecordings: vi.fn(async () => ({
				success: true,
				count: 1,
				sizeBytes: 2048,
				keptFor: [],
				unreadable: 0,
			})),
		});
		fireEvent.click(screen.getByRole("button", { name: /delete project: onboarding/i }));
		fireEvent.click(await screen.findByRole("button", { name: /also move its recordings/i }));
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => expect(onDelete).toHaveBeenCalledWith("proj_b", "trash"));
	});

	it("never offers to remove the open project's recordings", () => {
		const { loadRecordings } = renderStage();
		fireEvent.click(screen.getByRole("button", { name: /delete project: launch/i }));
		expect(loadRecordings).not.toHaveBeenCalled();
	});

	it("offers a permanent delete when the Trash refuses", async () => {
		const onDelete = vi.fn(async () => ({ trashFailed: true }));
		renderStage({ onDelete });
		fireEvent.click(screen.getByRole("button", { name: /delete project: onboarding/i }));
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		fireEvent.click(await screen.findByRole("button", { name: /delete permanently/i }));

		await waitFor(() => expect(onDelete).toHaveBeenLastCalledWith("proj_b", "permanent"));
	});

	it("cancelling the confirm deletes nothing", () => {
		const { onDelete } = renderStage();
		fireEvent.click(screen.getByRole("button", { name: /delete project: launch/i }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onDelete).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: /delete project: launch/i })).toBeInTheDocument();
	});

	it("shows the empty state and still offers a new project", () => {
		const { onNew } = renderStage({ projects: [], activeProjectId: null });
		expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /new project/i }));
		expect(onNew).toHaveBeenCalledTimes(1);
	});
});
