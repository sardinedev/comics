import type { APIRoute } from "astro";
import fs from "node:fs/promises";
import path from "node:path";

export const GET: APIRoute = async () => {
  const specPath = path.join(
    import.meta.dirname,
    "openapi.yaml",
  );
  const spec = await fs.readFile(specPath, "utf-8");

  return new Response(spec, {
    status: 200,
    headers: {
      "Content-Type": "application/x-yaml",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
