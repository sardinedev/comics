/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly COMICVINE_API_KEY: string;
  readonly PUBLIC_COMICVINE_URL: string;
  readonly ELASTIC_INDEX: string;
  readonly ELASTIC_URL: string;
  readonly ELASTIC_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
