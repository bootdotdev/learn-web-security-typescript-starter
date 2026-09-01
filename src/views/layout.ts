export function renderPage(title: string, body: string): string {
  const documentTitle =
    title === "Bearly Secure" ? title : `${title} - Bearly Secure`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(documentTitle)}</title>
    <link rel="stylesheet" href="/reset.css">
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main>
      ${body}
    </main>
  </body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatMoney(cents: number): string {
  const amount = (Math.abs(cents) / 100).toFixed(2);
  return cents < 0 ? `-$${amount}` : `$${amount}`;
}

export function renderAccountLink(displayName: string): string {
  return `<a href="/account">Hello, ${escapeHtml(displayName)}</a>`;
}
