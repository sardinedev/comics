import { useCallback, useState } from "preact/hooks";

export function AddToLibrary({ seriesId }: { seriesId: string }) {
  const [buttonText, setButtonText] = useState("Add series to library");
  const onClick = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}/add`, {
      method: "PUT",
    });
    if (res.ok) {
      setButtonText("Series added to library");
    } else {
      setButtonText("Failed to add series");
    }
  }, [seriesId]);
  return (
    <button
      onClick={onClick}
      type="button"
      class="rounded-full bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
    >
      {buttonText}
    </button>
  );
}
