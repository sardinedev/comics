import { useStore } from "@nanostores/preact";
import { $sort, toggleSort } from "../stores/sort.store";
import type { Sort } from "../stores/sort.store";

export function SortButton() {
  const $sortDirection = useStore($sort);

  return (
    <button
      type="button"
      class="flex items-center"
      onClick={() => toggleSort($sortDirection)}
    >
      <img
        class={`h-5 w-5 invert transition-all ${
          $sortDirection === "desc" ? "rotate-180" : "rotate-0"
        }`}
        src="/icons/sort.svg"
        alt="Previous page"
      />
      {$sortDirection === "asc" ? "Sort: Oldest first" : "Sort: Newest first"}
    </button>
  );
}
