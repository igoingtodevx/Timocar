/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  readonly VITE_CHECKOUT_MODE?: "hosted" | "embedded" | string;
  readonly VITE_PAYPAL_CLIENT_ID?: string;
  readonly VITE_PAYPAL_ENVIRONMENT?: "sandbox" | "production" | string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
