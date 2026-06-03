export function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} - Bearly Secure</title>
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
