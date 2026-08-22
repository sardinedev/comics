import { Icon } from "@components/Icon/Icon";
import {
	getQueuedAddToLibrary,
	OUTBOX_STATUS_EVENT,
	requestAddToLibrary,
} from "@lib/offline/library-sync";
import { useCallback, useEffect, useId, useRef, useState } from "preact/hooks";

type AddState = "idle" | "submitting" | "pending" | "added" | "failed";

const LABELS: Record<AddState, string> = {
	idle: "Add to library",
	submitting: "Adding…",
	pending: "Pending sync",
	added: "Added to library",
	failed: "Retry add",
};

export function AddToLibrary({ seriesId }: { seriesId: string }) {
	const [state, setState] = useState<AddState>("idle");
	const [message, setMessage] = useState<string | null>(null);
	const statusId = useId();
	const hasQueuedAction = useRef(false);

	const refreshQueuedState = useCallback(async () => {
		try {
			const queued = await getQueuedAddToLibrary(seriesId);
			if (queued?.status === "failed") {
				hasQueuedAction.current = true;
				setState("failed");
				setMessage("Couldn’t add this series. Try again.");
			} else if (queued) {
				hasQueuedAction.current = true;
				setState("pending");
				setMessage("Will add when you’re back online.");
			} else if (hasQueuedAction.current) {
				setState("added");
				setMessage("Series added to your library.");
			}
		} catch {
			// The click path surfaces storage failures; initial inspection is optional.
		}
	}, [seriesId]);

	useEffect(() => {
		void refreshQueuedState();
		const onOutboxStatus = () => void refreshQueuedState();
		window.addEventListener(OUTBOX_STATUS_EVENT, onOutboxStatus);
		return () =>
			window.removeEventListener(OUTBOX_STATUS_EVENT, onOutboxStatus);
	}, [refreshQueuedState]);

	const onClick = useCallback(async () => {
		hasQueuedAction.current = true;
		const offline = !navigator.onLine;
		setState(offline ? "pending" : "submitting");
		setMessage(
			offline ? "Will add when you’re back online." : "Adding this series…",
		);
		try {
			const result = await requestAddToLibrary(seriesId);
			setState(result.status);
			setMessage(
				result.message ??
					(result.status === "added"
						? "Series added to your library."
						: result.status === "pending"
							? "Will add when you’re back online."
							: "Couldn’t add this series. Try again."),
			);
		} catch {
			setState("failed");
			setMessage("Couldn’t save this action. Try again.");
		}
	}, [seriesId]);

	const isDisabled =
		state === "submitting" || state === "pending" || state === "added";

	return (
		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				onClick={onClick}
				disabled={isDisabled}
				aria-describedby={message ? statusId : undefined}
				data-add-to-library-state={state}
				class="group flex min-h-11 items-center gap-2 bg-amber-500 px-5 py-2.5 text-sm font-bold uppercase tracking-widest text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
			>
				<Icon name={state === "added" ? "tick" : "add"} />
				{LABELS[state]}
			</button>
			{message && (
				<p
					id={statusId}
					role={state === "failed" ? "alert" : "status"}
					aria-live="polite"
					class={`text-xs font-bold uppercase tracking-widest ${
						state === "failed" ? "text-red-400" : "text-amber-500"
					}`}
				>
					{message}
				</p>
			)}
		</div>
	);
}
