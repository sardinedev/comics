import type { Sort } from "../stores/sort.store";
import type { ShortIssue } from "./comicvine.types";

export function clampIssuesPerPage({
  issuesPerPage,
  currentPage,
  issueList,
  sortDirection,
}: {
  issuesPerPage: number;
  currentPage: number;
  issueList: ShortIssue[];
  sortDirection: Sort;
}) {
  // sort the issues by issue number
  if (sortDirection === "desc") {
    issueList.sort(
      (a, b) => parseInt(b.issue_number) - parseInt(a.issue_number)
    );
  } else {
    issueList.sort(
      (a, b) => parseInt(a.issue_number) - parseInt(b.issue_number)
    );
  }
  const trimmedList = issueList.slice(
    (currentPage - 1) * issuesPerPage,
    currentPage * issuesPerPage
  );

  return trimmedList;
}
