import { defineConfig, fontProviders } from "astro/config";
import preact from "@astrojs/preact";
import node from "@astrojs/node";

import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Newsreader",
      cssVariable: "--font-newsreader",
      weights: [700],
      styles: ["normal"],
    },
    {
      provider: fontProviders.google(),
      name: "Inter",
      cssVariable: "--font-inter",
      weights: [400, 700],
      styles: ["normal"],
    },
  ],

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

  // this is never accidentally disabled in a non-dev deployment.
  security: {
    checkOrigin: process.env.NODE_ENV !== "development",
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
