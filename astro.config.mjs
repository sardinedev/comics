import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import preact from "@astrojs/preact";
import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [tailwind(), preact()],
  adapter: node({
    mode: "standalone",
  }),
  build: {
    inlineStylesheets: "always",
  },
  image: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "comicvine.gamespot.com",
      },
    ],
  },
});
