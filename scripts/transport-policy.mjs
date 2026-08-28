import { existsSync, readFileSync } from "node:fs";

const caddyfile = existsSync("Caddyfile") ? readFileSync("Caddyfile", "utf8") : "";
const uncommentedCaddyfile = caddyfile.replace(/(^|\s)#.*$/gm, "$1");
const siteBlock =
  uncommentedCaddyfile.match(/(?:^|\n)\s*bearly-secure\.example\s*\{([\s\S]*?)^\s*\}/m)?.[1] ?? "";

const siteAddressConfigured = siteBlock.length > 0;
const automaticHttpsEnabled =
  siteAddressConfigured &&
  !/\bauto_https\s+(?:off|disable_redirects)\b/i.test(uncommentedCaddyfile);
const reverseProxyConfigured = /^\s*reverse_proxy\s+127\.0\.0\.1:3000\s*$/m.test(siteBlock);
const hstsConfigured =
  /^\s*header\s+Strict-Transport-Security\s+"max-age=31536000; includeSubDomains"\s*$/im.test(
    siteBlock,
  );

const environmentExample = readFileSync(".env.example", "utf8");
const proxyEnvironmentDocumented = environmentExample.split(/\r?\n/).includes("TRUST_PROXY_HOPS=0");

process.env.PAWPAL_API_KEY ??= "local-transport-policy-key";
process.env.DOWNLOAD_SIGNING_KEY ??= "20".repeat(32);

const { createApp } = await import("../src/app.ts");
const { applySchema } = await import("../src/db/schema.ts");
const { initDependencies } = await import("../src/dependencies.ts");

function createDependencies(trustedProxyHops) {
  return initDependencies({
    ...process.env,
    APP_ORIGIN: "https://bearly-secure.example",
    DATABASE_URL: ":memory:",
    TRUST_PROXY_HOPS: trustedProxyHops,
  });
}

const negativeProxyHopCountRejected = (() => {
  try {
    const invalidDependencies = createDependencies("-1");
    invalidDependencies.db.close();
    return false;
  } catch {
    return true;
  }
})();

const localDependencies = createDependencies("0");
applySchema(localDependencies.db);
const localApp = createApp(localDependencies);
const localDirectConnectionUntrusted = localApp.get("trust proxy") === 0;
localDependencies.db.close();

const proxyDependencies = createDependencies("1");
applySchema(proxyDependencies.db);
const proxyApp = createApp(proxyDependencies);
const proxyHopCountConfigured = proxyApp.get("trust proxy") === 1;
proxyDependencies.db.close();

console.log(
  JSON.stringify({
    automaticHttpsEnabled,
    hstsConfigured,
    localDirectConnectionUntrusted,
    negativeProxyHopCountRejected,
    proxyEnvironmentDocumented,
    proxyHopCountConfigured,
    reverseProxyConfigured,
    siteAddressConfigured,
  }),
);
