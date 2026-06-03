# Bearly Secure

Bearly Secure is the intentionally vulnerable starter app for "Learn Web Security in TypeScript."

The app is a tiny plushie shop built with:

- TypeScript
- Node.js 24+
- Express
- SQLite through Node's built-in `node:sqlite` module
- Multer for local file uploads
- Server-rendered HTML and JSON endpoints
- Small reset stylesheet plus custom CSS

## Commands

Install dependencies:

```sh
npm install
```

Seed the local database:

```sh
npm run seed -- --reset
```

Run the app locally:

```sh
npm run dev
```

Type-check the app:

```sh
npm run typecheck
```

Check formatting, linting, and CSS:

```sh
npm run lint
```

Format files:

```sh
npm run format
```

Run the app without file-watching:

```sh
npm start
```

## Current Features

- Public storefront with product listing, product detail pages, and product search
- Account creation, login, logout, and password reset with session cookies
- Redirect-after-login behavior using a `returnTo` parameter
- Account profile page with email changes and "Your Reviews" section
- Account order history and order detail pages
- Tax exemption document upload/download with support review
- JSON endpoints for account orders, order details, and products
- Origin-reflecting CORS headers on API routes
- Authenticated shopping cart
- Simulated PawPal checkout flow that creates orders without collecting card data
- Support order lookup and tax exemption document review for support and admin users
- Admin product catalog views and create/edit flows with internal pricing and inventory data
- Product reviews with logged-in review posting and account review editing/deletion
- Deterministic seed data for users, products, orders, order items, reviews, and one uploaded tax exemption document
- Centralized error handling that exposes diagnostics in the browser
- Local JSON-lines app logging in `data/bearly-secure.log`
- Small HTML page rendering helper
- Shared reset and app stylesheets in `public/`

## Intentional Starter Weaknesses

Bearly Secure is intentionally vulnerable. Current starter weaknesses include:

- Fast unsalted SHA-256 password hashes
- Weak/default session cookie options
- Account creation does not verify email ownership
- Email changes do not verify ownership of the new address or require recent authentication
- Logout clears the browser cookie but does not revoke the server-side session
- Session lookup does not reject revoked sessions yet
- Password reset reveals whether an email address has an account
- Password reset links are shown in the browser instead of sent out-of-band
- Password reset tokens are predictable and can be reused
- Password reset accepts tokens without checking expiration
- Login accepts unvalidated `returnTo` redirects
- Product search uses string-built SQL
- User-controlled HTML is rendered without escaping
- API routes reflect any request origin and allow credentialed CORS requests
- State-changing account, cart, checkout, review posting/editing/deletion, and file upload flows have no CSRF protection
- Order detail pages and API routes require login but do not enforce order ownership
- Review edit and delete routes require login but do not enforce review ownership
- File downloads require login but do not enforce file ownership
- Tax exemption uploads trust client-provided file metadata
- Order APIs expose internal order notes
- The products API exposes internal product costs and inactive products
- Support users can see all customer orders, internal order notes, and uploaded tax exemption metadata
- Admin users can see internal product costs and margins
- Checkout does not require recent authentication
- Checkout does not reserve inventory or re-check stock during order creation
- Checkout stores shipping and fake payment details in internal order notes
- Error responses expose error names, messages, stack traces, SQL details, and file paths
- Logs include emails, session IDs, password reset tokens, reset links, shipping addresses, internal order notes, uploaded filenames, and local storage paths

## Current Structure

- `src/server.ts`: starts the HTTP server
- `src/app.ts`: configures Express middleware and routes
- `src/cors.ts`: contains the intentionally permissive API CORS middleware
- `src/errors.ts`: contains the intentionally leaky global error handler
- `src/html.ts`: renders the shared HTML page shell
- `src/logger.ts`: writes intentionally over-detailed structured app logs
- `src/auth/`: contains password, password reset, user, and session helpers
- `src/cart/`: contains shopping cart helpers
- `src/db/`: owns SQLite setup, schema creation, and deterministic seed data
- `src/orders/`, `src/products/`, and `src/reviews/`: contain domain data helpers
- `src/uploads/`: contains upload metadata helpers and Multer middleware
- `src/routes/`: contains centralized Express route modules, including API, auth, cart, checkout, support, and admin areas
- `data/uploads/`: contains local uploaded files, including the seeded sample tax exemption PDF
- `public/`: contains static assets

## Near-Term Next Steps

1. Add lesson check scripts once the first project-backed assignment is ready.
