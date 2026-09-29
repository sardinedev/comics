import { clearOfflineData } from "@lib/offline";
import {
	isOfflineStorageSupported,
	offlineComics,
} from "@lib/offline/database";
import { syncPendingProgress } from "@lib/offline/progress-sync";
import { requestPersistentStorage } from "@lib/offline/storage";
import { $offline } from "@stores/offline.store";
import { shouldActivateWaitingWorker } from "./lifecycle";

const UPDATE_PENDING_KEY = "comics-pwa:update-pending";
const MESSAGE_TIMEOUT_MS = 30_000;
let registration: ServiceWorkerRegistration | null = null;
let started = false;

interface WorkerReply {
	ok?: boolean;
	ready?: boolean;
	type: string;
	version?: string;
}

function setShellReady(ready: boolean): void {
	$offline.setKey("shellReady", ready);
}

function setOnline(): void {
	$offline.setKey("online", navigator.onLine);
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

async function refreshReadiness(): Promise<void> {
	const worker = registration ? workerFor(registration) : null;
	if (!worker) return;
	try {
		const result = await sendMessage(worker, { type: "GET_OFFLINE_STATUS" });
		setShellReady(result.type === "OFFLINE_STATUS" && result.ready === true);
	} catch {
		setShellReady(false);
	}
}

async function warmOfflineShell(): Promise<void> {
	const worker = registration ? workerFor(registration) : null;
	if (!worker || !navigator.onLine) return;

	try {
		const result = await sendMessage(worker, { type: "WARM_OFFLINE" });
		if (result.type === "WARM_RESULT" && result.ok === true) {
			setShellReady(true);
			return;
		}
	} catch {
		// Fall back to asking whether an earlier warm-up already finished.
	}
	await refreshReadiness();
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

/** Covers comics downloaded before persistence was first requested. */
async function persistExistingDownloads(): Promise<void> {
	if (!isOfflineStorageSupported()) return;
	if ((await offlineComics.count()) > 0) await requestPersistentStorage();
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

/** Logout-only purge of every downloaded comic, saved progress and cached page. */
export async function purgeOfflineContent(): Promise<void> {
	setShellReady(false);
	await clearOfflineData();
}

export async function initialisePwa(): Promise<void> {
	bindLogoutPurge();
	if (started) return;
	started = true;

	setOnline();
	window.addEventListener("offline", setOnline);
	window.addEventListener("online", () => {
		setOnline();
		void warmOfflineShell();
		void syncPendingProgress();
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") void syncPendingProgress();
	});
	document.addEventListener("astro:page-load", bindLogoutPurge);
	void syncPendingProgress();
	void persistExistingDownloads().catch((error) =>
		console.warn("[pwa] Could not request persistent storage", error),
	);

	if (!("serviceWorker" in navigator)) return;
	const updateWasPendingAtLaunch =
		localStorage.getItem(UPDATE_PENDING_KEY) === "true";

	try {
		const registered = await navigator.serviceWorker.register("/sw.js", {
			scope: "/",
			updateViaCache: "none",
		});
		registration = registered;
		observeUpdates(
			registered,
			updateWasPendingAtLaunch || Boolean(registered.waiting),
		);

		await navigator.serviceWorker.ready;
		await refreshReadiness();
		if (navigator.onLine) await warmOfflineShell();
	} catch (error) {
		console.warn("[pwa] Service worker registration failed", error);
		setShellReady(false);
	}
}
