import { clearOfflineData } from "@lib/offline";
import {
	initialiseLibrarySync,
	replayAddToLibrary,
} from "@lib/offline/library-sync";
import {
	createOutboxReplayEngine,
	type OutboxReplayEngine,
} from "@lib/offline/outbox";
import { createProgressReplayHandler } from "@lib/offline/progress-sync";
import {
	derivePwaUiStatus,
	isConfirmedAuthInvalidResponse,
	type PwaUiStatus,
	shouldActivateWaitingWorker,
} from "./lifecycle";
import { renderPwaStatusElements } from "./status";

const UPDATE_PENDING_KEY = "comics-pwa:update-pending";
const STATUS_EVENT = "comics:pwa-status";
const MESSAGE_TIMEOUT_MS = 30_000;
let outboxReplayEngine: OutboxReplayEngine | undefined;

interface PwaStatusDetail {
	ready: boolean;
	status: PwaUiStatus;
}

interface WorkerReply {
	ok?: boolean;
	ready?: boolean;
	type: string;
	version?: string;
}

interface PwaController {
	ready: boolean;
	registration: ServiceWorkerRegistration | null;
	started: boolean;
	status: PwaUiStatus;
}

declare global {
	interface Window {
		__comicsNativeFetch?: typeof window.fetch;
		__comicsPwa?: PwaController;
	}
}

function getController(): PwaController {
	window.__comicsPwa ??= {
		ready: false,
		registration: null,
		started: false,
		status: derivePwaUiStatus({
			online: navigator.onLine,
			ready: false,
			supported: "serviceWorker" in navigator,
		}),
	};
	return window.__comicsPwa;
}

function renderStatus(controller: PwaController): void {
	controller.status = derivePwaUiStatus({
		online: navigator.onLine,
		ready: controller.ready,
		supported: "serviceWorker" in navigator,
	});

	renderPwaStatusElements(controller.status);

	window.dispatchEvent(
		new CustomEvent<PwaStatusDetail>(STATUS_EVENT, {
			detail: { ready: controller.ready, status: controller.status },
		}),
	);
}

function workerFor(
	registration: ServiceWorkerRegistration,
): ServiceWorker | null {
	return navigator.serviceWorker.controller ?? registration.active;
}

function sendMessage(
	worker: ServiceWorker,
	message: { type: string },
): Promise<WorkerReply> {
	return new Promise((resolve, reject) => {
		const channel = new MessageChannel();
		const timeout = window.setTimeout(() => {
			channel.port1.close();
			reject(new Error(`Service worker did not reply to ${message.type}`));
		}, MESSAGE_TIMEOUT_MS);

		channel.port1.onmessage = (event: MessageEvent<WorkerReply>) => {
			window.clearTimeout(timeout);
			channel.port1.close();
			resolve(event.data);
		};
		worker.postMessage(message, [channel.port2]);
	});
}

async function refreshReadiness(controller: PwaController): Promise<void> {
	const registration = controller.registration;
	const worker = registration ? workerFor(registration) : null;
	if (!worker) return;
	try {
		const result = await sendMessage(worker, { type: "GET_OFFLINE_STATUS" });
		controller.ready =
			result.type === "OFFLINE_STATUS" && result.ready === true;
	} catch {
		controller.ready = false;
	}
	renderStatus(controller);
}

async function warmOfflineShell(controller: PwaController): Promise<void> {
	const registration = controller.registration;
	const worker = registration ? workerFor(registration) : null;
	if (!worker || !navigator.onLine) return;

	try {
		const result = await sendMessage(worker, { type: "WARM_OFFLINE" });
		if (result.type === "WARM_RESULT" && result.ok === true) {
			controller.ready = true;
		} else {
			await refreshReadiness(controller);
			return;
		}
	} catch {
		await refreshReadiness(controller);
		return;
	}
	renderStatus(controller);
}

function observeUpdates(
	registration: ServiceWorkerRegistration,
	updateWasPendingAtLaunch: boolean,
): void {
	if (
		shouldActivateWaitingWorker({
			hasWaitingWorker: Boolean(registration.waiting),
			updateWasPendingAtLaunch,
		})
	) {
		let reloading = false;
		navigator.serviceWorker.addEventListener("controllerchange", () => {
			if (reloading) return;
			reloading = true;
			window.location.reload();
		});
		registration.waiting?.postMessage({ type: "ACTIVATE_UPDATE" });
		localStorage.removeItem(UPDATE_PENDING_KEY);
	}

	registration.addEventListener("updatefound", () => {
		const installing = registration.installing;
		if (!installing) return;
		installing.addEventListener("statechange", () => {
			if (
				installing.state === "installed" &&
				navigator.serviceWorker.controller
			) {
				// Activation is intentionally deferred. A future app launch sees this
				// marker and promotes the already-waiting worker.
				localStorage.setItem(UPDATE_PENDING_KEY, "true");
			}
		});
	});
}

function installAuthInvalidationFetchHook(): void {
	if (window.__comicsNativeFetch) return;
	const nativeFetch = window.fetch.bind(window);
	window.__comicsNativeFetch = nativeFetch;
	window.fetch = async (...args: Parameters<typeof fetch>) => {
		const response = await nativeFetch(...args);
		if (isConfirmedAuthInvalidResponse(response, window.location.origin)) {
			await purgeOfflineContent().catch((error) =>
				console.warn("[pwa] Could not clear invalidated offline data", error),
			);
		}
		return response;
	};
}

function replayOutboxWhenOnline(): void {
	if (!navigator.onLine) return;
	if (!outboxReplayEngine) {
		outboxReplayEngine = createOutboxReplayEngine({
			handlers: {
				progress: createProgressReplayHandler({
					fetcher: (...args) =>
						(window.__comicsNativeFetch ?? window.fetch)(...args),
				}),
				"add-to-library": replayAddToLibrary,
			},
			onAuthInvalid: purgeOfflineContent,
		});
		initialiseLibrarySync(outboxReplayEngine);
	}
	void outboxReplayEngine
		.replay()
		.catch((error) =>
			console.warn("[pwa] Could not replay queued offline actions", error),
		);
}

function bindLogoutPurge(): void {
	for (const form of document.querySelectorAll<HTMLFormElement>(
		"form[data-purge-offline-on-submit]",
	)) {
		if (form.dataset.purgeBound === "true") continue;
		form.dataset.purgeBound = "true";
		form.addEventListener("submit", async (event) => {
			event.preventDefault();
			const submitter = (event as SubmitEvent).submitter;
			if (submitter instanceof HTMLButtonElement) submitter.disabled = true;
			try {
				await purgeOfflineContent();
			} finally {
				HTMLFormElement.prototype.submit.call(form);
			}
		});
	}
}

export async function purgeOfflineContent(): Promise<void> {
	const controller = getController();
	controller.ready = false;
	renderStatus(controller);

	const registration = controller.registration;
	const worker = registration ? workerFor(registration) : null;
	const workerPurge = worker
		? sendMessage(worker, { type: "PURGE_OFFLINE" }).catch(() => undefined)
		: Promise.resolve(undefined);

	await Promise.all([clearOfflineData(), workerPurge]);
}

export async function initialisePwa(): Promise<void> {
	const controller = getController();
	bindLogoutPurge();
	renderStatus(controller);
	if (controller.started) return;
	controller.started = true;

	installAuthInvalidationFetchHook();
	window.addEventListener("offline", () => renderStatus(controller));
	window.addEventListener("online", () => {
		void warmOfflineShell(controller);
		replayOutboxWhenOnline();
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") replayOutboxWhenOnline();
	});
	document.addEventListener("astro:page-load", () => {
		bindLogoutPurge();
		renderStatus(controller);
	});
	replayOutboxWhenOnline();

	if (!("serviceWorker" in navigator)) return;
	const updateWasPendingAtLaunch =
		localStorage.getItem(UPDATE_PENDING_KEY) === "true";

	try {
		const registration = await navigator.serviceWorker.register("/sw.js", {
			scope: "/",
			updateViaCache: "none",
		});
		controller.registration = registration;
		observeUpdates(
			registration,
			updateWasPendingAtLaunch || Boolean(registration.waiting),
		);

		navigator.serviceWorker.addEventListener("message", (event) => {
			if (event.data?.type === "AUTH_INVALIDATED") {
				void purgeOfflineContent();
			}
		});

		await navigator.serviceWorker.ready;
		await refreshReadiness(controller);
		if (navigator.onLine) await warmOfflineShell(controller);
	} catch (error) {
		console.warn("[pwa] Service worker registration failed", error);
		controller.ready = false;
		renderStatus(controller);
	}
}
