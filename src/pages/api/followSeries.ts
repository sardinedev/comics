import type { APIRoute, APIContext } from "astro";
import { kvAddFollowSeries, kvGetFollowSeries } from "../../util/kv";

export const GET: APIRoute = async ({ locals }: APIContext) => {
  const kv = locals.runtime.env.COMICS;

  try {
    const data = await kvGetFollowSeries(kv);

    return new Response(JSON.stringify(data));
  } catch (error) {
    console.error(error);
    return new Response(null, {
      status: 500,
      statusText: "Failed to fetch series to follow.",
    });
  }
};

export const POST: APIRoute = async ({ request, locals }: APIContext) => {
  const kv = locals.runtime.env.COMICS;
  try {
    const body = await request.json();
    await kvAddFollowSeries(body.id, kv);
    return new Response("OK");
  } catch (error) {
    console.error(error);
    return new Response(null, {
      status: 500,
      statusText: "Failed to add series to follow.",
    });
  }
};

export const DELETE: APIRoute = ({ request, locals }: APIContext) => {
  const kv = locals.runtime.env.COMICS;

  return new Response(
    JSON.stringify({
      message: "This was a DELETE!",
    })
  );
};
