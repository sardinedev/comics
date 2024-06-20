import { useEffect, useState } from "preact/hooks";
import { useStore } from "@nanostores/preact";
import { $sort } from "../../stores/sort.store";
import { PageNavigator } from "../PageNavigator";
import type { Sort } from "../../stores/sort.store";
import type { Issue } from "../../util/comics.types";

export type Props = {
  seriesId: string;
  issueList: Issue[];
  currentPage: number;
  totalNumberOfIssues: number;
  issuesPerPage?: number;
};

function clampIssuesPerPage({
  issuesPerPage,
  currentPage,
  issueList,
  sortDirection,
}: {
  issuesPerPage: number;
  currentPage: number;
  issueList: Issue[];
  sortDirection: Sort;
}) {
  // sort the issues by issue number
  if (sortDirection === "desc") {
    issueList.sort((a, b) => parseInt(b.number) - parseInt(a.number));
  } else {
    issueList.sort((a, b) => parseInt(a.number) - parseInt(b.number));
  }
  const trimmedList = issueList.slice(
    (currentPage - 1) * issuesPerPage,
    currentPage * issuesPerPage
  );

  return trimmedList;
}

function Issue({ id, name, imageURL, number, status }: Issue) {
  return (
    <li>
      <a href={"/comic/" + id}>
        <img
          class={`rounded-md w-full ${
            status !== "Downloaded" ? "opacity-50" : ""
          }`}
          style={{ aspectRatio: "210/320" }}
          src={imageURL ?? "/logo.svg"}
          loading="lazy"
          height="320"
          width="210"
          alt={name ?? `Cover for issue #${number}`}
        />
        <span>Issue #{number}</span>
      </a>
    </li>
  );
}

export function IssueGrid({
  seriesId,
  issueList,
  currentPage,
  totalNumberOfIssues,
  issuesPerPage = 50,
}: Props) {
  const $sortDirection = useStore($sort);
  const [issues, setIssues] = useState<Issue[] | undefined>(
    clampIssuesPerPage({
      issuesPerPage,
      currentPage,
      issueList,
      sortDirection: $sortDirection,
    })
  );

  useEffect(() => {
    setIssues(
      clampIssuesPerPage({
        issuesPerPage,
        currentPage,
        issueList,
        sortDirection: $sortDirection,
      })
    );
  }, [issueList, currentPage, issuesPerPage, $sortDirection]);

  return (
    <>
      <ul class="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-5 mt-8">
        {issues?.map((issue) => (
          <Issue key={issue.id} {...issue} />
        ))}
      </ul>
      <PageNavigator
        id={seriesId}
        numberOfPages={Math.ceil(totalNumberOfIssues / issuesPerPage)}
        currentPage={currentPage}
      />
    </>
  );
}
