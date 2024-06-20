// import { PageNavigator } from "../PageNavigator";
import "./SeriesGrid.module.css";

import { useState } from "preact/hooks";
import type { Series } from "../../util/comics.types";

export type SeriesGridProps = {
  series: Series[];
};

function Serie(props: Series) {
  const [data, setData] = useState({ ...props });

  // useEffect(() => {
  //   async function getIssue() {
  //     const response = await fetch(`/api/issue/${id}`);
  //     const issue = await response.json();
  //     setCover(issue.image);
  //   }
  //   if (!image) {
  //     getIssue();
  //   }
  // }, []);

  async function handleClick() {
    const update = await fetch(`/api/series/${data.id}`, {
      method: "PUT",
    });
    const { result } = await update.json();
    if (result === "updated") {
      const response = await fetch(`/api/series/${data.id}`);
      const newData = await response.json();
      setData(newData);
    }
  }

  return (
    <li class="relative">
      <button
        class="absolute top-2 right-2 rounded-full p-1 w-8 h-8 z-10"
        aria-label="Get data from ComicVine"
        type="button"
        onClick={handleClick}
      >
        <img class="h-5 w-5 invert" src="/icons/sync.svg" alt="Sync" />
      </button>
      <a href={"/series/" + data.id}>
        <img
          class="rounded-md w-full"
          style={{ aspectRatio: "210/320" }}
          src={data.imageURL ?? "/logo.svg"}
          loading="lazy"
          height="320"
          width="210"
          alt={data.name}
        />
        {data.name ? (
          <span>
            {data.name} ({data.year})
          </span>
        ) : (
          <span>Series #{data.id} doesn't have any metadata yet!</span>
        )}
      </a>
    </li>
  );
}

export function SeriesGrid({ series }: SeriesGridProps) {
  return (
    <>
      <ul class="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-5 mt-8">
        {series?.map((item) => (
          <Serie key={item.id} {...item} />
        ))}
      </ul>
      {/* <PageNavigator
            id={seriesId}
            numberOfPages={Math.ceil(totalNumberOfIssues / issuesPerPage)}
            currentPage={currentPage}
          /> */}
    </>
  );
}
