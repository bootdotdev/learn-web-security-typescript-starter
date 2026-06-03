import { Router, type Request, type Response } from "express";
import { getCurrentSession, type CurrentSession } from "../auth/sessions.ts";
import { renderPage } from "../html.ts";
import {
  createProduct,
  findAnyProductById,
  listAllProducts,
  updateProduct,
  type Product,
  type ProductInput,
} from "../products/index.ts";

export const router = Router();

router.get("/admin", (req, res) => {
  const current = requireAdminSession(req, res);
  if (!current) {
    return;
  }

  res.type("html").send(
    renderPage(
      "Admin Dashboard",
      `
      <nav class="nav-links"><a href="/">Store</a><a href="/account">Account</a></nav>
      <p class="eyebrow">Admin</p>
      <h1>Admin Dashboard</h1>
      <section class="card-grid">
        <article class="card">
          <h2>Products</h2>
          <p>Create products, update catalog status, and review internal costs.</p>
          <a href="/admin/products">View products</a>
        </article>
      </section>
    `,
    ),
  );
});

router.get("/admin/products", (req, res) => {
  const current = requireAdminSession(req, res);
  if (!current) {
    return;
  }

  const rows = listAllProducts().map(renderProductRow).join("").trimEnd();

  res.type("html").send(
    renderPage(
      "Admin Products",
      `<nav class="nav-links">
        <a href="/admin">Admin</a>
        <a href="/account">Account</a>
      </nav>
      <p class="eyebrow">Admin</p>
      <h1>Products</h1>
      <p class="page-action"><a class="button-link" href="/admin/products/new">Create product</a></p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Status</th>
              <th>Price</th>
              <th>Cost</th>
              <th>Inventory</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>`,
    ),
  );
});

router.get("/admin/products/new", (req, res) => {
  const current = requireAdminSession(req, res);
  if (!current) {
    return;
  }

  res
    .type("html")
    .send(
      renderProductFormPage(
        "Create Product",
        "Create Product",
        "/admin/products",
        emptyProductInput(),
        "Create product",
      ),
    );
});

router.post("/admin/products", (req, res) => {
  const current = requireAdminSession(req, res);
  if (!current) {
    return;
  }

  const result = parseProductInput(req.body);
  if (!result.ok) {
    res
      .status(400)
      .type("html")
      .send(
        renderProductFormPage(
          "Create Product",
          "Create Product",
          "/admin/products",
          result.input,
          "Create product",
          result.error,
        ),
      );
    return;
  }

  const product = createProduct(result.input);
  res.redirect(`/admin/products/${product.id}`);
});

router.get("/admin/products/:id/edit", (req, res) => {
  const current = requireAdminSession(req, res);
  if (!current) {
    return;
  }

  const product = requireProduct(req, res);
  if (!product) {
    return;
  }

  res
    .type("html")
    .send(
      renderProductFormPage(
        `Edit ${product.name}`,
        "Edit Product",
        `/admin/products/${product.id}`,
        product,
        "Save changes",
      ),
    );
});

router.post("/admin/products/:id", (req, res) => {
  const current = requireAdminSession(req, res);
  if (!current) {
    return;
  }

  const product = requireProduct(req, res);
  if (!product) {
    return;
  }

  const result = parseProductInput(req.body);
  if (!result.ok) {
    res
      .status(400)
      .type("html")
      .send(
        renderProductFormPage(
          `Edit ${product.name}`,
          "Edit Product",
          `/admin/products/${product.id}`,
          result.input,
          "Save changes",
          result.error,
        ),
      );
    return;
  }

  updateProduct(product.id, result.input);
  res.redirect(`/admin/products/${product.id}`);
});

router.get("/admin/products/:id", (req, res) => {
  const current = requireAdminSession(req, res);
  if (!current) {
    return;
  }

  const product = requireProduct(req, res);
  if (!product) {
    return;
  }

  const marginCents = product.price_cents - product.cost_cents;

  res.type("html").send(
    renderPage(
      `Admin Product #${product.id}`,
      `
      <nav class="nav-links"><a href="/admin/products">All products</a><a href="/account">Account</a></nav>
      <p class="eyebrow">Admin Product #${product.id}</p>
      <h1>${product.name}</h1>
      <p class="lede">${product.description}</p>
      <p class="page-action"><a class="button-link" href="/admin/products/${product.id}/edit">Edit product</a></p>
      <section class="card-grid">
        <article class="card">
          <h2>Catalog</h2>
          <dl>
            <dt>Status</dt>
            <dd>${product.is_active ? "Active" : "Inactive"}</dd>
            <dt>Inventory</dt>
            <dd>${product.inventory_count}</dd>
            <dt>Created</dt>
            <dd>${product.created_at}</dd>
          </dl>
        </article>
        <article class="card">
          <h2>Internal Pricing</h2>
          <dl>
            <dt>Price</dt>
            <dd>${formatMoney(product.price_cents)}</dd>
            <dt>Cost</dt>
            <dd>${formatMoney(product.cost_cents)}</dd>
            <dt>Margin</dt>
            <dd>${formatMoney(marginCents)}</dd>
          </dl>
        </article>
      </section>
    `,
    ),
  );
});

function requireAdminSession(req: Request, res: Response): CurrentSession | undefined {
  const current = getCurrentSession(req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return undefined;
  }

  if (current.user.role !== "admin") {
    res.status(403).send("Forbidden");
    return undefined;
  }

  return current;
}

function requireProduct(req: Request, res: Response): Product | undefined {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId)) {
    res.status(404).send("Product not found");
    return undefined;
  }

  const product = findAnyProductById(productId);
  if (!product) {
    res.status(404).send("Product not found");
    return undefined;
  }

  return product;
}

function renderProductRow(product: Product): string {
  return `<tr>
              <td><a href="/admin/products/${product.id}">${product.name}</a></td>
              <td>${product.is_active ? "Active" : "Inactive"}</td>
              <td>${formatMoney(product.price_cents)}</td>
              <td>${formatMoney(product.cost_cents)}</td>
              <td>${product.inventory_count}</td>
              <td><a href="/admin/products/${product.id}/edit">Edit</a></td>
            </tr>
            `;
}

function renderProductFormPage(
  title: string,
  heading: string,
  action: string,
  product: ProductInput,
  submitLabel: string,
  error: string = "",
): string {
  const errorMessage = error ? `<p class="error">${error}</p>` : "";

  return renderPage(
    title,
    `
      <nav class="nav-links"><a href="/admin/products">All products</a><a href="/account">Account</a></nav>
      <p class="eyebrow">Admin</p>
      <h1>${heading}</h1>
      ${errorMessage}
      <form method="post" action="${action}" class="product-form">
        <label>
          Name
          <input name="name" value="${product.name}" required>
        </label>
        <label>
          Description
          <textarea name="description" rows="5" required>${product.description}</textarea>
        </label>
        <label>
          Image path
          <input name="imagePath" value="${product.image_path}" required>
        </label>
        <label>
          Price cents
          <input name="priceCents" type="number" min="0" step="1" value="${product.price_cents}" required>
        </label>
        <label>
          Cost cents
          <input name="costCents" type="number" min="0" step="1" value="${product.cost_cents}" required>
        </label>
        <label>
          Inventory count
          <input name="inventoryCount" type="number" min="0" step="1" value="${product.inventory_count}" required>
        </label>
        <label class="checkbox-label">
          <input name="isActive" type="checkbox" value="1" ${product.is_active ? "checked" : ""}>
          Active in storefront
        </label>
        <button type="submit">${submitLabel}</button>
      </form>
    `,
  );
}

function parseProductInput(
  body: unknown,
): { ok: true; input: ProductInput } | { ok: false; input: ProductInput; error: string } {
  const form = body as Record<string, unknown>;
  const input: ProductInput = {
    name: String(form.name ?? "").trim(),
    description: String(form.description ?? "").trim(),
    image_path: String(form.imagePath ?? "").trim(),
    price_cents: Number(form.priceCents),
    cost_cents: Number(form.costCents),
    inventory_count: Number(form.inventoryCount),
    is_active: form.isActive === "1" ? 1 : 0,
  };

  if (input.name.length === 0 || input.description.length === 0 || input.image_path.length === 0) {
    return { ok: false, input, error: "Name, description, and image path are required." };
  }

  if (!isWholeNumber(input.price_cents) || !isWholeNumber(input.cost_cents)) {
    return { ok: false, input, error: "Price and cost must be whole cents." };
  }

  if (!isWholeNumber(input.inventory_count)) {
    return { ok: false, input, error: "Inventory count must be a whole number." };
  }

  return { ok: true, input };
}

function emptyProductInput(): ProductInput {
  return {
    name: "",
    description: "",
    image_path: "/product-photos/placeholder.png",
    price_cents: 0,
    cost_cents: 0,
    inventory_count: 0,
    is_active: 1,
  };
}

function isWholeNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
