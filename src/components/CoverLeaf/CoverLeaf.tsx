type IssueCoverLeaf = {
  cover: string;
  id: string;
  number: number;
  status?: string;
  type: "Issue";
};

type SeriesCoverLeaf = {
  cover: string;
  id: string;
  name: string;
  type: "series";
  year: string;
};

export type CoverLeaf = IssueCoverLeaf | SeriesCoverLeaf;

export function CoverLeaf({ cover, id, ...props }: CoverLeaf) {
  let label, alt, href;
  if (props.type === "Issue") {
    const { number } = props;
    label = `Issue #${number}`;
    alt = `Cover for issue #${number}`;
    href = `/comic/${id}`;
  }
  if (props.type === "series") {
    const { name, year } = props;
    label = `${name} (${year})`;
    alt = `Cover for ${name} (${year})`;
    href = `/series/${id}`;
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
        <span>{label}</span>
      </a>
    </li>
  );
}
