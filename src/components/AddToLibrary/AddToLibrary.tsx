import { Icon } from "@components/Icon/Icon";
import { useStore } from "@nanostores/preact";
import { $isOffline } from "@stores/offline.store";
import { useCallback, useId, useState } from "preact/hooks";
import { addSeriesToLibrary } from "./addToLibrary.utils";

type AddState = "idle" | "submitting" | "added" | "failed" | "auth-required";

const LABELS: Record<AddState, string> = {
	idle: "Add to library",
	submitting: "Adding…",
	added: "Added to library",
	failed: "Retry add",
	"auth-required": "Add to library",
};

const MESSAGES: Partial<Record<AddState, string>> = {
	submitting: "Adding this series…",
	added: "Series added to your library.",
	failed: "Couldn’t add this series. Try again.",
	"auth-required": "Sign in again to add this series.",
};

export function AddToLibrary({ seriesId }: { seriesId: string }) {
	const [state, setState] = useState<AddState>("idle");
	const offline = useStore($isOffline);
	const statusId = useId();

	const onClick = useCallback(async () => {
		setState("submitting");
		setState(await addSeriesToLibrary(seriesId));
	}, [seriesId]);

	// Adding needs Mylar, so offline the action waits rather than queueing.
	const unavailable = offline && state !== "added";
	const statusMessage = unavailable ? null : MESSAGES[state];
	const isDisabled = unavailable || state === "submitting" || state === "added";

	return (
		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				onClick={onClick}
				disabled={isDisabled}
				aria-describedby={statusMessage ? statusId : undefined}
				data-add-to-library-state={state}
				class="group flex min-h-11 items-center gap-2 bg-amber-500 px-5 py-2.5 text-sm font-bold uppercase tracking-widest text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
			>
				<Icon name={state === "added" ? "tick" : "add"} />
				{unavailable ? "Available when online" : LABELS[state]}
			</button>
			{statusMessage && (
				<p
					id={statusId}
					role={state === "failed" ? "alert" : "status"}
					aria-live="polite"
					class={`text-xs font-bold uppercase tracking-widest ${
						state === "failed" ? "text-red-400" : "text-amber-500"
					}`}
				>
					{statusMessage}
				</p>
			)}
		</div>
	);
}
