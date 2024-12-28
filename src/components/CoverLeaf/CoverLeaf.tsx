import type { ReadingStatus } from "../../util/comics.types";

type IssueCoverLeaf = {
  cover: string;
  id: string;
  number: number;
  status?: string;
  type: "Issue";
  read: boolean;
};

type SeriesCoverLeaf = {
  cover: string;
  id: string;
  name: string;
  type: "series";
  year: string;
  readingStatus: ReadingStatus;
};

export type CoverLeaf = IssueCoverLeaf | SeriesCoverLeaf;

export function CoverLeaf({ cover, id, ...props }: CoverLeaf) {
  let label, alt, href, readingStatus;
  if (props.type === "Issue") {
    const { number } = props;
    label = `Issue #${number}`;
    alt = `Cover for issue #${number}`;
    href = `/comic/${id}`;
    readingStatus = props.read ? "read" : "unread";
  }
  if (props.type === "series") {
    const { name, year } = props;
    label = `${name} (${year})`;
    alt = `Cover for ${name} (${year})`;
    href = `/series/${id}`;
    readingStatus = props.readingStatus === "read" ? "reading" : "unread";
  }
  return (
    <li>
      <a href={href}>
        <img
          class={"rounded-md w-full"}
          style={{ aspectRatio: "210/320" }}
          src={cover ?? "/logo.svg"}
          loading="lazy"
          height="320"
          width="210"
          alt={alt}
        />
        <span class={"flex justify-between mt-2"}>
          {label}
          <img
            class={`h-5 w-5 invert`}
            src={`/icons/${
              readingStatus === "read" ? "tick-filled" : "tick"
            }.svg`}
            alt="Previous page"
          />
        </span>
      </a>
    </li>
  );
}
