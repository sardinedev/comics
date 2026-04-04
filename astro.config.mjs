import { defineConfig, fontProviders } from "astro/config";
import preact from "@astrojs/preact";
import node from "@astrojs/node";

import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://comics.marabyte.com",
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

  // checkOrigin is disabled because the app runs behind a reverse proxy that
  // rewrites the Host header, causing Astro's CSRF check to always fail.
  // This is safe: the only POST endpoint (/api/auth/authorize) performs no
  // mutations — it just kicks off the ATProto OAuth redirect flow, which
  // carries its own CSRF protection via the OAuth state parameter.
  security: {
    checkOrigin: false,
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
