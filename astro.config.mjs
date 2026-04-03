import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import node from "@astrojs/node";

import tailwindcss from "@tailwindcss/vite";

const isDev = process.env.NODE_ENV !== "production";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [ preact()],

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
      {
        // Allow optimizing our own on-demand cover route (/covers/*)
        // regardless of hostname (dev/prod) so we can request resized bytes.
        pathname: "/covers/**",
      },
    ],
  },

  ...(isDev && {
    security: { checkOrigin: false },
  }),

  vite: {
    plugins: [tailwindcss()],
  },
});
