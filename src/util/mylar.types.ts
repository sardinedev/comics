export type MylarComic = {
  /** An URL to the issue page in Comicvine */
  detailsURL: string;
  /** The unique identifier for the issue */
  id: string;
  /** An URL to the cover image of the issue */
  imageURL: string;
  /** The latest issue number in the series */
  latestIssue: string;
  /** The name of the issue */
  name: string;
  /** The publisher of the issue */
  publisher: string;
  /** The status of the issue */
  status: string;
  /** The total number of issues in the series */
  totalIssues: number;
  /** The year when the issue was originally published, in the format YYYY */
  year: string;
};

export type MylarIssue = {
  /** The name of the comic */
  comicName: string;
  /** The unique identifier for the issue */
  id: string;
  /** An URL to the cover image of the issue */
  imageURL: string;
  /** The date when the issue was released, in the format YYYY-MM-DD */
  issueDate: string;
  /** The name of the issue */
  name: string | null;
  /** The issue number */
  number: string;
  /** The date when the issue was released for download, in the format YYYY-MM-DD */
  releaseDate: string;
  /** The status of the issue */
  status: string;
};

export type MylarComicWithIssues = {
  comic: MylarComic[];
  issues: MylarIssue[];
};
