// @vitest-environment jsdom
// Removing a media takes its clips off the timeline, and can take the recording off the disk,
// so the detail pane confirms first and keeps the files unless the user opts in.

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
	assetRecordings: vi.fn(),
	removeAsset: vi.fn(),
}));

vi.mock("@/native/client", () => ({ nativeBridgeClient: { aiEdition: bridge } }));

// An echoing translator: the assertions read against keys, not prose that drifts with copy edits.
vi.mock("@/contexts/I18nContext", () => ({
	useI18n: () => ({ locale: "en", setLocale: vi.fn() }),
	useScopedT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { assetSchema, createEmptyDocument } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { MediaStage } from "./MediaStage";

class StubResizeObserver {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

const emptyDocument = createEmptyDocument({ projectId: "p", title: "t" });

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", StubResizeObserver);
	// The toggle reads "Trash" or "Recycle Bin" by platform; pinned so the run does not depend
	// on what jsdom's user agent happens to say.
	vi.stubGlobal("electronAPI", { getPlatform: () => "darwin" });
	bridge.assetRecordings.mockReset().mockResolvedValue({
		success: true,
		count: 1,
		sizeBytes: 2048,
		keptFor: [],
		unreadable: 0,
	});
	bridge.removeAsset.mockReset().mockResolvedValue({ assetId: "asset-1", document: emptyDocument });
	useProjectStore.setState({
		projectId: "p",
		document: {
			...emptyDocument,
			assets: [assetSchema.parse({ id: "asset-1", label: "take", originalPath: "/rec/take.mp4" })],
		},
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	useProjectStore.setState({ document: null });
});

async function armRemove() {
	render(
		<TooltipProvider>
			<MediaStage onAddToTimeline={vi.fn(async () => undefined)} />
		</TooltipProvider>,
	);
	fireEvent.click(await screen.findByRole("button", { name: /take/ }));
	fireEvent.click(await screen.findByRole("button", { name: "mediaStage.removeFromProject" }));
}

describe("MediaStage remove", () => {
	it("removes nothing until the confirm, and then keeps the files by default", async () => {
		await armRemove();
		expect(bridge.removeAsset).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "actions.delete" }));

		await waitFor(() => expect(bridge.removeAsset).toHaveBeenCalledWith("p", "asset-1", "keep"));
		await waitFor(() => expect(useProjectStore.getState().document?.assets).toEqual([]));
	});

	it("moves the recording to the Trash when the toggle is on", async () => {
		await armRemove();
		fireEvent.click(await screen.findByRole("button", { name: "openProjectDialog.alsoTrash" }));
		fireEvent.click(screen.getByRole("button", { name: "actions.delete" }));

		await waitFor(() => expect(bridge.removeAsset).toHaveBeenCalledWith("p", "asset-1", "trash"));
	});

	it("cancelling leaves the media in the project", async () => {
		await armRemove();
		fireEvent.click(screen.getByRole("button", { name: "actions.cancel" }));

		expect(bridge.removeAsset).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "mediaStage.removeFromProject" }),
		).toBeInTheDocument();
	});

	it("keeps the media and offers a permanent delete when the Trash refuses", async () => {
		bridge.removeAsset.mockResolvedValueOnce({
			assetId: "asset-1",
			document: useProjectStore.getState().document,
			trashFailed: true,
		});
		await armRemove();
		fireEvent.click(await screen.findByRole("button", { name: "openProjectDialog.alsoTrash" }));
		fireEvent.click(screen.getByRole("button", { name: "actions.delete" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "openProjectDialog.deletePermanently" }),
		);

		await waitFor(() =>
			expect(bridge.removeAsset).toHaveBeenLastCalledWith("p", "asset-1", "permanent"),
		);
	});
});
