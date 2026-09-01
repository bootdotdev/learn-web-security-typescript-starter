import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { strToU8, zipSync } from "fflate";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const { extractTaxDocumentArchive } = await import("../src/uploads/archive.ts");

let deps;
let extractArchive = (buffer) => extractTaxDocumentArchive(buffer);
let readArchiveDocument = (storagePath) => readFileSync(storagePath);

if (extractTaxDocumentArchive.length > 1) {
  const { initDependencies } = await import("../src/dependencies.ts");
  const { readTaxDocument } = await import("../src/uploads/taxDocuments.ts");
  const { loadOptionalKeyring } = await import("../src/storage/keyring.ts");
  const keyring = loadOptionalKeyring();
  deps = initDependencies();
  extractArchive = (buffer) => extractTaxDocumentArchive(keyring, buffer);
  readArchiveDocument = (storagePath) => readTaxDocument(storagePath, keyring);
}

const extractionDirectory = resolve("data/bulk-tax-documents");
const escapedName = `archive-escape-proof-${randomUUID()}.pdf`;
const escapedPath = resolve(extractionDirectory, escapedName);
const absoluteName = `archive-absolute-proof-${randomUUID()}.pdf`;
const absolutePath = resolve("data", absoluteName);
const entriesBefore = listImportEntries();
const generatedPaths = new Set();

try {
  const normalImport = extractArchive(
    Buffer.from(zipSync({ "office/document.pdf": strToU8("%PDF-tax") })),
  );
  generatedPaths.add(normalImport.importDirectory);
  const normalDocument = normalImport.documents[0];

  let safeDotDotName = "";
  try {
    const safeDotDotImport = extractArchive(
      Buffer.from(zipSync({ "..notes/file.pdf": strToU8("%PDF-notes") })),
    );
    generatedPaths.add(safeDotDotImport.importDirectory);
    const safeDotDotDocument = safeDotDotImport.documents.find(
      (document) => document.originalName === "..notes/file.pdf",
    );
    safeDotDotName = safeDotDotDocument
      ? readArchiveDocument(safeDotDotDocument.storagePath)
          .subarray(5)
          .toString("utf8")
      : "";
  } catch {
    safeDotDotName = "";
  }

  let absoluteRejected = false;
  try {
    const absoluteImport = extractArchive(
      Buffer.from(zipSync({ [absolutePath]: strToU8("%PDF-absolute") })),
    );
    generatedPaths.add(absoluteImport.importDirectory);
  } catch {
    absoluteRejected = true;
  }

  const entriesBeforeRejectedImport = listImportEntries();
  let rejected = false;
  try {
    extractArchive(
      Buffer.from(
        zipSync({
          "partial.pdf": strToU8("%PDF-partial"),
          [`../${escapedName}`]: strToU8("%PDF-escaped"),
        }),
      ),
    );
  } catch {
    rejected = true;
  }
  const entriesAfterRejectedImport = listImportEntries();

  for (const entry of entriesAfterRejectedImport) {
    if (!entriesBefore.includes(entry)) {
      generatedPaths.add(resolve(extractionDirectory, entry));
    }
  }

  console.log(
    JSON.stringify({
      normal: normalDocument
        ? readArchiveDocument(normalDocument.storagePath)
            .subarray(5)
            .toString("utf8")
        : "",
      safeDotDotName,
      absoluteRejected,
      rejected,
      escaped: existsSync(escapedPath),
      partial: !sameEntries(
        entriesBeforeRejectedImport,
        entriesAfterRejectedImport,
      ),
    }),
  );
} finally {
  deps?.db.close();
  for (const path of generatedPaths) {
    if (isInsideDirectory(extractionDirectory, path)) {
      rmSync(path, { force: true, recursive: true });
    }
  }
  rmSync(escapedPath, { force: true });
  rmSync(absolutePath, { force: true });
}

function listImportEntries() {
  return existsSync(extractionDirectory)
    ? readdirSync(extractionDirectory).sort()
    : [];
}

function sameEntries(left, right) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function isInsideDirectory(directory, candidatePath) {
  const relativePath = relative(directory, candidatePath);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}
