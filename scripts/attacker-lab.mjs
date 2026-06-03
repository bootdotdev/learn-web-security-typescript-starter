import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const assetsDirectory = fileURLToPath(new URL("../attacker-lab/", import.meta.url));

const assets = new Map([
  ["/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/attacker-lab.css", { file: "attacker-lab.css", contentType: "text/css; charset=utf-8" }],
  [
    "/attacker-lab.js",
    {
      file: "attacker-lab.js",
      contentType: "text/javascript; charset=utf-8",
    },
  ],
]);

export function createAttackerLabServer() {
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Method not allowed\n");
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const asset = assets.get(pathname);

    if (!asset) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }

    try {
      const body = await readFile(join(assetsDirectory, asset.file));
      response.writeHead(200, {
        "Content-Length": body.byteLength,
        "Content-Type": asset.contentType,
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      console.error("Failed to serve attacker lab asset", error);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Internal server error\n");
    }
  });
}

function parsePort(value) {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid ATTACKER_LAB_PORT: ${value}`);
  }

  return port;
}

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  const port = parsePort(process.env.ATTACKER_LAB_PORT ?? "4000");
  const server = createAttackerLabServer();

  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const listeningPort = typeof address === "object" && address ? address.port : port;
    console.log(`Attacker lab running at http://localhost:${listeningPort}`);
  });
}
