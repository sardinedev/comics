// Mylar issue status values observed in practice.
export type IssueStatus =
  | "Wanted"
  | "Skipped"
  | "Downloaded"
  | "Snatched"
  | "Archived"
  | "Ignored"
  | "Failed";

// Mylar history items have their own status domain (different from IssueStatus).
export type HistoryStatus =
  | "Snatched"
  | "Downloaded"
  | "Post-Processed"
  | "Failed";

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
  status: IssueStatus;
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
  status: IssueStatus;
};

export type MylarComicWithIssues = {
  /** The comic series information */
  comic: MylarComic[];
  /** The list of issues in the comic series */
  issues: MylarIssue[];
};

export type MylarHistoryItem = {
  /** The unique identifier for the comic */
  ComicID: string;
  /** The name of the comic */
  ComicName: string;
  /** The date when the issue was added to history, in the format YYYY-MM-DD HH:MM:SS */
  DateAdded: string;
  /** The unique identifier for the issue */
  IssueID: string;
  /** The issue number */
  Issue_Number: string;
  /** The status of the item (Snatched, Downloaded, Post-Processed, etc.) */
  Status: HistoryStatus;
  /** The provider used to download the issue */
  Provider: string;
};
