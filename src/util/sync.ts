import { getVolumeDetails } from "./comicvine";
import { getElasticClient } from "./elastic";
import { getMylarSeries } from "./mylar";

export async function syncMylarSeries() {
  try {
    const elastic = getElasticClient();
    const { data } = await getMylarSeries();

    const series = data.map((s) => ({
      id: s.ComicID,
      location: s.ComicLocation,
    }));

    const operations = series.flatMap((serie) => [
      { index: { _index: "series", _id: serie.id } },
      serie,
    ]);

    const bulkResponse = await elastic.bulk({ refresh: true, operations });

    if (bulkResponse.errors) {
      console.error(bulkResponse);
      throw new Error("Failed to sync series to Elastic.");
    }

    return bulkResponse;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to sync series to Elastic.");
  }
}

export async function syncSeriesDataFromComicVine(id: string) {
  console.log("Syncing series data from Comic Vine", id);
  const elastic = getElasticClient();
  const cvData = await getVolumeDetails(id);
  if (cvData) {
    const update = await elastic.index({
      index: "series",
      id,
      document: cvData,
    });
    console.log(update);
    return update;
  }
}
