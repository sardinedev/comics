import { useEffect, useState } from "preact/hooks";
import { PageNavigator } from "../PageNavigator";
import type {
  ComicvineImage,
  ShortIssue,
} from "../../pages/api/comicvine.types";

export type Props = {
  seriesId: number;
  issueList: ShortIssue[];
  currentPage: number;
  totalNumberOfIssues: number;
  issuesPerPage?: number;
};

function clampIssuesPerPage({
  issuesPerPage,
  currentPage,
  issueList,
}: {
  issuesPerPage: number;
  currentPage: number;
  issueList: ShortIssue[];
}) {
  // sort the issues by issue number
  issueList.sort((a, b) => parseInt(a.issue_number) - parseInt(b.issue_number));
  return issueList.slice(
    (currentPage - 1) * issuesPerPage,
    currentPage * issuesPerPage
  );
}

function Issue({ id, name, image, issue_number }: ShortIssue) {
  const [cover, setCover] = useState<ComicvineImage | undefined>(image);

  useEffect(() => {
    async function getIssue() {
      const response = await fetch(`/api/issue/${id}`);
      const issue = await response.json();
      setCover(issue.image);
    }
    if (!image) {
      getIssue();
      console.log("Issue", id, "is missing an image");
    }
  }, [image]);
  return (
    <li>
      <a href={"/comic/" + id}>
        <img
          class="rounded-md"
          style={{ aspectRatio: "210/320" }}
          src={cover?.medium_url ?? "/logo.svg"}
          loading="lazy"
          height="320"
          width="210"
          alt={name}
        />
        <span>Issue #{issue_number}</span>
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
  const [issues, setIssues] = useState<ShortIssue[] | undefined>(
    clampIssuesPerPage({ issuesPerPage, currentPage, issueList })
  );
  return (
    <>
      <ul class="grid gap-4 grid-cols-2 md:grid-cols-5 mt-8">
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
