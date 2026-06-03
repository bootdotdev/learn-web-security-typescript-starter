import type { CurrentSession } from "../auth/sessions.ts";
import { escapeHtml, renderAccountLink, renderPage } from "./layout.ts";

export function renderArchivePage(
  current: CurrentSession,
  importedCount?: number,
  error: string = "",
): string {
  const errorMessage = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const result =
    importedCount !== undefined
      ? `<section class="card-grid"><article class="card"><h2>Import Complete</h2><p>Imported ${importedCount} file${importedCount === 1 ? "" : "s"}.</p><a href="/support/tax-exemptions">View imported documents</a></article></section>`
      : "";

  return renderPage(
    "Import Tax Documents",
    `<nav class="page-nav" aria-label="Primary"><a class="brand-link" href="/">Bearly Secure</a>${renderAccountLink(current.user.display_name)}<a href="/support">Support</a>${current.user.role === "admin" ? `<a href="/admin">Admin</a>` : ""}<a href="/support/tax-exemptions">Tax exemptions</a></nav>
      <p class="eyebrow">Support</p>
      <h1>Import Tax Documents</h1>
      <p class="subtitle">Upload a ZIP archive containing PDF, JPEG, PNG, or WebP tax exemption documents for bulk review.</p>
      ${errorMessage}
      <form method="post" action="/support/tax-exemptions/import" enctype="multipart/form-data" class="upload-form">
        <label>
          ZIP archive
          <input name="archive" type="file" accept=".zip,application/zip" required>
        </label>
        <button type="submit">Import documents</button>
      </form>
      ${result}`,
  );
}
