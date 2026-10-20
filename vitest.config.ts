import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            HMAC_KEY: "test-hmac-key",
            ORGANIZERS: "org@example.org",
            ORCID_CLIENT_ID: "orcid-client",
            ORCID_CLIENT_SECRET: "orcid-secret",
            CERTILIA_CLIENT_ID: "certilia-client",
            CERTILIA_CLIENT_SECRET: "certilia-secret",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
