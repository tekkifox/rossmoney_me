declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PAYLOAD_SECRET: string
      DATABASE_URL: string
      NEXT_PUBLIC_SERVER_URL: string
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: string
      TURNSTILE_SECRET_KEY: string
      VERCEL_PROJECT_PRODUCTION_URL: string
      /** `1` on the Vercel preview target; anything else leaves the gate off. */
      DEV_GATE?: string
      /** Public DNS name of the WireGuard endpoint; required when the gate is on. */
      DEV_GATE_HOST?: string
      /** Comma-separated addresses or CIDRs allowed through the dev gate. */
      DEV_GATE_ALLOW?: string
    }
  }
}

// If this file has no import/export statements (i.e. is a script)
// convert it into a module by adding an empty export statement.
export {}
