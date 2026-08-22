import type { PwaUiStatus } from "./lifecycle";

export function renderPwaStatusElements(
	status: PwaUiStatus,
	root: ParentNode = document,
): void {
	for (const element of root.querySelectorAll<HTMLElement>(
		"[data-pwa-status]",
	)) {
		element.dataset.status = status;
		element.hidden = false;
	}
}
