export type MylarResponse<T> = {
  result: string;
  data: T;
};

export async function mylar<T>(
  endpoint: string,
  method = "GET",
  data?: unknown
): Promise<MylarResponse<T>> {
  const req = await fetch(
    `http://192.168.50.190:8090/api?cmd=${endpoint}&apikey=933b8cda6b3b1501b26f316b5ecb8efd`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return req.json();
}

export type MylarSeries = {
  ComicID: string;
  ComicLocation: string;
};

export function getMylarSeries() {
  try {
    // return mylar<MylarSeries[]>("seriesjsonListing");
    return {
      data: [{
        ComicID: "124821",
        ComicLocation: "C:\\Users\\Public\\Comics\\Batman"

      },
      {
        ComicID: "146734",
        ComicLocation: "C:\\Users\\Public\\Comics\\Superman"
      },
      {
        ComicID: "91273",
        ComicLocation: "C:\\Users\\Public\\Comics\\Superman"
      }]
    };
  } catch (error) {
    console.error(error);
    throw new Error("Failed to fetch series from Mylar.");
  }
}
