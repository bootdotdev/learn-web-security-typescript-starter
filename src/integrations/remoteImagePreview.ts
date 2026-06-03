export type RemoteImagePreviewResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  byteLength: number;
  imageDataUrl: string;
};

export class RemoteImagePreviewError extends Error {}

export async function fetchRemoteImagePreview(
  imageUrl: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<RemoteImagePreviewResult> {
  let response: Response;
  try {
    response = await fetchImpl(imageUrl, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new RemoteImagePreviewError("The image host did not respond in time.");
    }
    throw new RemoteImagePreviewError("The image host could not be reached.");
  }

  if (!response.ok) {
    throw new RemoteImagePreviewError(`The image host returned HTTP ${response.status}.`);
  }

  const declaredContentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!declaredContentType?.startsWith("image/")) {
    throw new RemoteImagePreviewError("The URL did not return an image.");
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RemoteImagePreviewError("The image is larger than 1 MiB.");
  }

  const imageBytes = await readImageBytes(response, maxBytes);
  const detectedContentType = detectImageContentType(imageBytes);
  if (!detectedContentType || detectedContentType !== declaredContentType) {
    throw new RemoteImagePreviewError("The response is not a valid PNG, JPEG, or WebP image.");
  }

  return {
    requestedUrl: imageUrl,
    finalUrl: response.url,
    status: response.status,
    contentType: detectedContentType,
    byteLength: imageBytes.byteLength,
    imageDataUrl: `data:${detectedContentType};base64,${imageBytes.toString("base64")}`,
  };
}

async function readImageBytes(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    throw new RemoteImagePreviewError("The image response was empty.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value.byteLength > maxBytes - bytesRead) {
        await reader.cancel();
        throw new RemoteImagePreviewError("The image is larger than 1 MiB.");
      }

      chunks.push(value);
      bytesRead += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (bytesRead === 0) {
    throw new RemoteImagePreviewError("The image response was empty.");
  }

  return Buffer.concat(chunks, bytesRead);
}

function detectImageContentType(imageBytes: Buffer): string | undefined {
  if (
    imageBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }

  if (imageBytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }

  if (
    imageBytes.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    imageBytes.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) {
    return "image/webp";
  }

  return undefined;
}
