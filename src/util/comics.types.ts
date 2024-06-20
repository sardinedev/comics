import type { MylarComic, MylarIssue } from "./mylar.types";

export type Series = Omit<MylarComic, "detailsURL"> & {
  cover?: string;
  issues: Issue[];
};

export type Issue = Omit<MylarIssue, "comicName"> & {
  cover?: string;
};
