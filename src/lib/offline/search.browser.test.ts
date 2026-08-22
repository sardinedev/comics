import { describe, expect, test, vi } from "vitest";
import { createOfflineStatusSource } from "./search";

describe("createOfflineStatusSource", () => {
	test("tracks browser and PWA lifecycle connectivity events", () => {
		const events = new EventTarget();
		const navigatorObject = { onLine: true };
		const source = createOfflineStatusSource(navigatorObject, events);
		const listener = vi.fn();
		const unsubscribe = source.subscribe(listener);

		expect(source.isOffline()).toBe(false);
		events.dispatchEvent(
			new CustomEvent("comics:pwa-status", {
				detail: { status: "offline" },
			}),
		);
		expect(source.isOffline()).toBe(true);
		expect(listener).toHaveBeenLastCalledWith(true);

		events.dispatchEvent(new Event("online"));
		expect(source.isOffline()).toBe(false);
		expect(listener).toHaveBeenLastCalledWith(false);

		unsubscribe();
		events.dispatchEvent(new Event("offline"));
		expect(listener).toHaveBeenCalledTimes(2);
	});
});
