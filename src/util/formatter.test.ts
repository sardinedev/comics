import { expect, test } from "vitest";
import { convertComicvineVolumeToSeries } from "./formatter";
import { comicvineVolumeMock } from "./mocks/comicvineVolume.mock";

test("convertComicvineVolumeToSeries", () => {
  const series = convertComicvineVolumeToSeries(comicvineVolumeMock);
  expect(series).toEqual({
    count_of_issues: 5,
    id: "5000",
    issues: [
      {
        id: "37946",
        issue_number: 1,
        name: "",
        metadata: { has_download: false, is_indexed: false },
      },
      {
        id: "38094",
        issue_number: 2,
        name: "",
        metadata: { has_download: false, is_indexed: false },
      },
      {
        id: "38252",
        issue_number: 3,
        name: "",
        metadata: { has_download: false, is_indexed: false },
      },
      {
        id: "38499",
        issue_number: 4,
        name: "",
        metadata: { has_download: false, is_indexed: false },
      },
      {
        id: "38648",
        issue_number: 5,
        name: "",
        metadata: { has_download: false, is_indexed: false },
      },
    ],
    name: "Daredevil: The Man Without Fear",
    publisher: {
      id: "31",
      name: "Marvel",
    },
    start_year: "1993",
  });
});
