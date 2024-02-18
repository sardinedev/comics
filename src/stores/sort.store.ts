import { persistentAtom } from "@nanostores/persistent";
export type Sort = "asc" | "desc";

export const $sort = persistentAtom<Sort>("sortIssues", "asc");

export function toggleSort(sort: Sort) {
  if (sort === "asc") {
    $sort.set("desc");
  } else {
    $sort.set("asc");
  }
}
