# Bearly Secure

Bearly Secure is the intentionally vulnerable starter app for "Learn Web Security in TypeScript." It's a tiny plushie shop built with TypeScript, Express, and SQLite.

> [!IMPORTANT] This README describes the freshly cloned starter project from lesson 1.2. Course assignments will change the app's behavior, but this file remains a reference for the initial baseline.

## Requirements

- Node.js 24 or newer
- npm

## Run the Starter

Install the dependencies:

```sh
npm install
```

Seed the local database:

```sh
npm run db:reset
```

Start the app at <http://localhost:3000>:

```sh
npm start
```

For automatic restarts while editing, use `npm run dev` instead.

## Attacker Lab

The repository includes a small browser-based attacker lab for cross-origin exercises. Run it in another terminal:

```sh
npm run attacker-lab
```

Then open <http://localhost:4000>.

## Project Checks

Type-check the app:

```sh
npm run typecheck
```

Check formatting and lint source files:

```sh
npm run lint
```

Format files:

```sh
npm run format
```

You can restore the deterministic starter data at any time with `npm run db:reset`.

## Baseline Features

- Public storefront with product listing, search, detail pages, and reviews
- Account creation, login, logout, password reset, and session cookies
- Account profiles, order history, review management, and tax-document uploads
- Authenticated shopping cart and checkout with simulated PawPal and Acorn integrations
- Support and admin areas for order, tax-document, and product workflows
- JSON product and order APIs
- Browser attacker lab and embedded shipping widget
- Deterministic local order-assistant simulation
- SQLite seed data, local file storage, and JSON-lines application logs
- Single-stage Node 24 Dockerfile that runs TypeScript directly

## Security Warning

Bearly Secure is deliberately unsafe. It contains exploitable authentication, authorization, injection, browser-security, data-exposure, infrastructure, and operational weaknesses for course exercises.

Do not deploy it or use its security patterns in a real application. Its credentials, integrations, payments, and third-party services are local simulations that use fake data only.

## Baseline Structure

- `src/main.ts`: starts the HTTP server
- `src/app.ts`: configures Express middleware and routes
- `src/dependencies.ts`: loads runtime configuration and shared dependencies
- `src/auth/`: contains authentication, session, TOTP, passkey, and access-control helpers
- `src/integrations/`: contains simulated external-service integrations
- `src/orders/` and the `src/cart.ts`, `src/products.ts`, and `src/reviews.ts` modules: contain domain data helpers
- `src/uploads/`: contains upload metadata, middleware, and archive extraction
- `src/routes/`: contains the app's Express route modules
- `src/views/`: renders server-side HTML
- `src/assistant.ts`: builds and runs the local order-assistant simulation
- `scripts/`: contains local validation and support scripts
- `attacker-lab/`: contains the browser attacker lab
- `public/`: contains static assets
- `data/uploads/`: contains local uploads and the seeded sample tax exemption PDF
- `data/bulk-tax-documents/`: receives documents extracted from support ZIP imports
- `Dockerfile`: defines the initial single-stage container build
