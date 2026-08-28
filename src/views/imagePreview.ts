import type { RemoteImagePreviewResult } from "../integrations/remoteImagePreview.ts";
import { escapeHtml, renderAccountLink, renderPage } from "./layout.ts";

export function renderImagePreviewPage(
  displayName: string,
  error?: string,
  result?: RemoteImagePreviewResult,
): string {
  const errorMessage = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const resultCard = result
    ? `<section class="card-grid">
        <article class="card">
          <h2>Fetched Response</h2>
          <dl>
            <dt>Requested URL</dt>
            <dd><code>${escapeHtml(result.requestedUrl)}</code></dd>
            <dt>Final URL</dt>
            <dd><code>${escapeHtml(result.finalUrl)}</code></dd>
            <dt>Status</dt>
            <dd>${result.status}</dd>
            <dt>Content type</dt>
            <dd><code>${escapeHtml(result.contentType)}</code></dd>
            <dt>File size</dt>
            <dd>${new Intl.NumberFormat("en-US").format(result.byteLength)} bytes</dd>
          </dl>
          <h3>Image preview</h3>
          <div class="product-image-frame product-detail-image-frame">
            <img class="product-detail-image" src="${escapeHtml(result.imageDataUrl)}" alt="Preview of the remote product">
          </div>
        </article>
      </section>`
    : "";

  return renderPage(
    "Remote Image Preview",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(displayName)}<a href="/support">Support</a><a href="/admin">Admin</a><a href="/admin/products">Products</a></nav>
      <p class="eyebrow">Admin Tool</p>
      <h1>Preview Product Image</h1>
      <p class="subtitle">Fetch a remote image to inspect its response before adding it to the catalog.</p>
      <form method="post" action="/admin/image-preview" class="product-form">
        <label>
          Image URL
          <input name="imageUrl" type="url" placeholder="https://storage.googleapis.com/qvault-webapp-dynamic-assets/course_assets/zBWqBYp-540x720.jpg" required>
        </label>
        <button type="submit">Fetch preview</button>
        <div class="form-message" aria-live="polite">${errorMessage}</div>
      </form>
      ${resultCard}`,
  );
}
