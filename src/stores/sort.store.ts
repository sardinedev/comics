import { atom } from "nanostores";
export type Sort = "asc" | "desc";

function getSortfromURL() {
  if (typeof document === "undefined") {
    return "desc";
  }
  const url = new URL(document.location.href);
  const sort = url.searchParams.get("sort");

  if (sort === "asc") {
    return "asc";
  }
  return "desc";
}

function setSortInURL(sort: Sort) {
  const url = new URL(document.location.href);
  url.searchParams.set("sort", sort);
  history.pushState({}, "", url.href);
}

export const $sort = atom<Sort>(getSortfromURL());

export function toggleSort(sort: Sort) {
  if (sort === "asc") {
    $sort.set("desc");
  } else {
    $sort.set("asc");
  }
  setSortInURL($sort.get());
}
