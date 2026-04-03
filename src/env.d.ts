/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly COMICVINE_API_KEY: string;
  readonly PUBLIC_COMICVINE_URL: string;
  readonly ELASTIC_INDEX: string;
  readonly ELASTIC_URL: string;
  readonly ELASTIC_API_KEY: string;
  readonly MYLAR_URL: string;
  readonly MYLAR_API_KEY: string;
  readonly COVERS_DIR: string;
  readonly PUBLIC_URL: string;
  readonly ATPROTO_PRIVATE_KEY_JWK: string;
  readonly AUTH_ALLOWED_DID: string;
  readonly AUTH_SESSION_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    did: string;
  }
}
