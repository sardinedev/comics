/**
 * Represents the response from Comicvine API for a list of issues.
 */
export type ComicvineResponse<T> = {
  /** A text string representing the status_code */
  error: string;
  /** The number of total results matching the filter conditions specified */
  number_of_total_results: number;
  /** The number of results on this page */
  number_of_page_results: number;
  /** The value of the limit filter specified, or 100 if not specified */
  limit: number;
  /** The value of the offset filter specified, or 0 if not specified */
  offset: number;
  /** Zero or more items that match the filters specified */
  results: T;
  /**
   * An integer indicating the result of the request. Acceptable values are:
   *
   * 1:OK
   *
   * 100:Invalid API Key
   *
   * 101:Object Not Found
   *
   * 102:Error in URL Format
   *
   * 103:'jsonp' format requires a 'json_callback' argument
   *
   * 104:Filter Error
   *
   * 105:Subscriber only video is for subscribers only
   */
  status_code: number;
};

/**
 * Represents the response from Comicvine API for issues in search.
 */
export type ComicvineIssuesResponse = {
  /** List of aliases the issue is known by. A \n (newline) seperates each alias. */
  aliases: string;
  /** URL pointing to the issue detail resource. */
  api_detail_url: string;
  /** The publish date printed on the cover of an issue. */
  cover_date: string;
  /** Date the issue was added to Comic Vine. */
  date_added: string;
  /** Date the issue was last updated on Comic Vine. */
  date_last_updated: string;
  /** Brief summary of the issue. */
  deck: string;
  /** Description of the issue. */
  description: string;
  has_staff_review: boolean;
  /** Unique ID of the issue. */
  id: number;
  /** URL pointing to the issue image resource. */
  image: {
    icon_url: string;
    medium_url: string;
    screen_url: string;
    screen_large_url: string;
    small_url: string;
    super_url: string;
    thumb_url: string;
    tiny_url: string;
    original_url: string;
    image_tags: string;
  };
  /** The number assigned to the issue within the volume set. */
  issue_number: string;
  /** Name of the issue. */
  name: string;
  /** URL pointing to the issue on Comic Vine. */
  site_detail_url: string;
  /** Date the issue was released. */
  store_date: string;
  /** The volume this issue is a part of. */
  volume: {
    /** URL pointing to the volume detail resource. */
    api_detail_url: string;
    /** Unique ID of the volume. */
    id: number;
    /** Name of the volume. */
    name: string;
    /** URL pointing to the volume on Comic Vine. */
    site_detail_url: string;
  };
};

/**
 * Represents the response from Comicvine API for issues in search.
 */
export type ComicvineSingleIssueResponse = {
  /** List of aliases the issue is known by. A \n (newline) seperates each alias. */
  aliases: string;
  /** URL pointing to the issue detail resource. */
  api_detail_url: string;
  /** List of characters that appear in the issue. */
  character_credits: Record<string, unknown>[];
  /** List of characters that died in the issue. */
  characters_died_in: Record<string, unknown>[];
  /** List of concepts that appear in the issue. */
  concept_credits: Record<string, unknown>[];
  /** The publish date printed on the cover of an issue. */
  cover_date: string;
  /** Date the issue was added to Comic Vine. */
  date_added: string;
  /** Date the issue was last updated on Comic Vine. */
  date_last_updated: string;
  /** Brief summary of the issue. */
  deck: string;
  /** Description of the issue. */
  description: string;
  /** A list of teams that disbanded in this issue. */
  disbanded_teams: Record<string, unknown>[];
  /** A list of characters in which this issue is the first appearance of the character. */
  first_appearance_characters: Record<string, unknown>[];
  /** A list of concepts in which this issue is the first appearance of the concept. */
  first_appearance_concepts: Record<string, unknown>[];
  /** A list of locations in which this issue is the first appearance of the location. */
  first_appearance_locations: Record<string, unknown>[];
  /** A list of objects in which this issue is the first appearance of the object. */
  first_appearance_objects: Record<string, unknown>[];
  /** A list of storyarcs in which this issue is the first appearance of the story arc. */
  first_appearance_storyarcs: Record<string, unknown>[];
  /** A list of teams in which this issue is the first appearance of the team. */
  first_appearance_teams: Record<string, unknown>[];
  has_staff_review: boolean;
  /** Unique ID of the issue. */
  id: number;
  /** URL pointing to the issue image resource. */
  image: {
    icon_url: string;
    medium_url: string;
    screen_url: string;
    screen_large_url: string;
    small_url: string;
    super_url: string;
    thumb_url: string;
    tiny_url: string;
    original_url: string;
    image_tags: string;
  };
  /** The number assigned to the issue within the volume set. */
  issue_number: string;
  /** List of locations that appear in the issue. */
  location_credits: Record<string, unknown>[];
  /** Name of the issue. */
  name: string;
  /** List of objects that appear in the issue. */
  object_credits: Record<string, unknown>[];
  /** List of people that appear in the issue. */
  person_credits: Record<string, unknown>[];
  /** URL pointing to the issue on Comic Vine. */
  site_detail_url: string;
  /** Date the issue was released. */
  store_date: string;
  /** List of story arcs this issue appears in. */
  story_arc_credits: Record<string, unknown>[];
  /** List of teams that appear in the issue. */
  team_credits: Record<string, unknown>[];
  /** List of teams that were disbanded in this issue. */
  teams_disbanded_in: Record<string, unknown>[];
  /** The volume this issue is a part of. */
  volume: {
    /** URL pointing to the volume detail resource. */
    api_detail_url: string;
    /** Unique ID of the volume. */
    id: number;
    /** Name of the volume. */
    name: string;
    /** URL pointing to the volume on Comic Vine. */
    site_detail_url: string;
  };
};