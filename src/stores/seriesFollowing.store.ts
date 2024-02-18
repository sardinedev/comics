import { atom } from "nanostores";

/** List of Series ID */
export type Following = number[];

export const $seriesFollowing = atom<Following>([]);
