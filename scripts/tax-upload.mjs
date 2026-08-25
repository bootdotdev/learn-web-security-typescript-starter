import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { initDependencies } from "../src/dependencies.ts";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const sessionCookie = process.argv[2];
const baseURL = process.argv[3] ?? "http://localhost:3000";

if (!sessionCookie) {
  console.error("Usage: node scripts/tax-upload.mjs <session-cookie> [base-url]");
  process.exit(1);
}

const uploadURL = new URL("/account/tax-exemption/files", baseURL);
const uploadDirectory = resolve("data/uploads");
const uploadEntriesBefore = new Set(readdirSync(uploadDirectory));
const fixtureName = "mystery-shack-tax-exemption.pdf";
const fixturePath = [
  resolve("data/fixtures", fixtureName),
  resolve("data/uploads", fixtureName),
].find((candidate) => existsSync(candidate));
if (!fixturePath) {
  throw new Error(`Missing tax-document fixture: ${fixtureName}`);
}
const fixture = readFileSync(fixturePath);
const requestOrigin = new URL(baseURL).origin;
const deps = initDependencies();
const db = deps.db;
const previousMaxId = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM uploaded_files").get().id;
const createdFilesQuery = db.prepare(`
  SELECT id, original_name, storage_path, content_type
  FROM uploaded_files
  WHERE id > ?
  ORDER BY id DESC
`);
let spoofedPaths = [];

try {
  const spoofedForm = new FormData();
  spoofedForm.append(
    "document",
    new Blob(["not really a pdf"], { type: "application/pdf" }),
    "spoofed.pdf",
  );
  const spoofedResponse = await fetch(uploadURL, {
    method: "POST",
    headers: { Cookie: sessionCookie, Origin: requestOrigin },
    body: spoofedForm,
    redirect: "manual",
  });
  const spoofedRows = createdFilesQuery.all(previousMaxId);
  spoofedPaths = readdirSync(uploadDirectory)
    .filter((entry) => !uploadEntriesBefore.has(entry))
    .map((entry) => resolve(uploadDirectory, entry));

  const validForm = new FormData();
  validForm.append("document", new Blob([fixture], { type: "text/plain" }), fixtureName);
  const validResponse = await fetch(uploadURL, {
    method: "POST",
    headers: { Cookie: sessionCookie, Origin: requestOrigin },
    body: validForm,
    redirect: "manual",
  });

  const formatProbes = [
    {
      originalName: "detected-jpeg.bin",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      contentType: "image/jpeg",
      extension: "jpg",
    },
    {
      originalName: "detected-png.bin",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      contentType: "image/png",
      extension: "png",
    },
    {
      originalName: "detected-webp.bin",
      buffer: Buffer.from("RIFF0000WEBP"),
      contentType: "image/webp",
      extension: "webp",
    },
  ];
  const formatResponses = new Map();
  for (const probe of formatProbes) {
    const form = new FormData();
    form.append(
      "document",
      new Blob([probe.buffer], { type: "application/octet-stream" }),
      probe.originalName,
    );
    formatResponses.set(
      probe.originalName,
      await fetch(uploadURL, {
        method: "POST",
        headers: { Cookie: sessionCookie, Origin: requestOrigin },
        body: form,
        redirect: "manual",
      }),
    );
  }

  const createdFiles = createdFilesQuery.all(previousMaxId);
  const uploadedFile = createdFiles.find((file) => file.original_name === fixtureName);
  const formatFiles = Object.fromEntries(
    formatProbes.map((probe) => [
      probe.contentType,
      createdFiles.find((file) => file.original_name === probe.originalName),
    ]),
  );
  const formatAccepted = Object.fromEntries(
    formatProbes.map((probe) => {
      const uploadedProbe = formatFiles[probe.contentType];
      return [
        probe.contentType,
        formatResponses.get(probe.originalName)?.status === 302 &&
          uploadedProbe?.content_type === probe.contentType &&
          storedNameIsUuid(basename(uploadedProbe?.storage_path ?? ""), probe.extension) &&
          existsSync(uploadedProbe?.storage_path ?? ""),
      ];
    }),
  );

  const storedName = basename(uploadedFile?.storage_path ?? "");

  console.log(
    JSON.stringify({
      spoofedStatus: spoofedResponse.status,
      spoofedRowCreated: spoofedRows.length > 0,
      spoofedFileCreated: spoofedPaths.length > 0,
      validStatus: validResponse.status,
      contentType: uploadedFile?.content_type,
      storedNameIsUuid:
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:pdf|enc)$/i.test(
          storedName,
        ),
      storedExtensions: {
        pdf: extname(uploadedFile?.storage_path ?? ""),
        jpeg: extname(formatFiles["image/jpeg"]?.storage_path ?? ""),
        png: extname(formatFiles["image/png"]?.storage_path ?? ""),
        webp: extname(formatFiles["image/webp"]?.storage_path ?? ""),
      },
      storedFileExists: existsSync(uploadedFile?.storage_path ?? ""),
      jpegAccepted: formatAccepted["image/jpeg"],
      pngAccepted: formatAccepted["image/png"],
      webpAccepted: formatAccepted["image/webp"],
    }),
  );
} finally {
  try {
    for (const file of createdFilesQuery.all(previousMaxId)) {
      const storagePath = resolve(file.storage_path);
      const uploadDirectory = resolve("data/uploads");

      if (dirname(storagePath) === uploadDirectory) {
        if (storagePath === fixturePath) {
          writeFileSync(fixturePath, fixture);
        } else if (existsSync(storagePath)) {
          unlinkSync(storagePath);
        }
      }

      db.prepare("DELETE FROM uploaded_files WHERE id = ?").run(file.id);
    }
    for (const storagePath of spoofedPaths) {
      if (dirname(storagePath) === uploadDirectory && existsSync(storagePath)) {
        unlinkSync(storagePath);
      }
    }
  } finally {
    db.close();
  }
}

function storedNameIsUuid(storedName, extension) {
  return new RegExp(
    `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:${extension}|enc)$`,
    "i",
  ).test(storedName);
}
