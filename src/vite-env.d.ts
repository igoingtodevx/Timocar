/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  readonly VITE_CHECKOUT_MODE?: "hosted" | "embedded" | string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
