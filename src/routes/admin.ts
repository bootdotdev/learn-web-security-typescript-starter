import { Router, type Request, type Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import type { Dependencies } from "../dependencies.ts";
import { getCurrentSession, type CurrentSession } from "../auth/sessions.ts";
import { sendErrorPage } from "../errors.ts";
import {
  renderAdminDashboard,
  renderAdminProductPage,
  renderAdminProductsPage,
  renderProductFormPage,
} from "../views/admin.ts";
import {
  createProduct,
  findAnyProductById,
  listAllProducts,
  updateProduct,
  type Product,
  type ProductInput,
} from "../products.ts";

export function createAdminRouter(deps: Dependencies): Router {
  const { db } = deps;
  const router = Router();

  router.get("/admin", (req, res) => {
    const current = requireRole(db, req, res, "admin");
    if (!current) {
      return;
    }

    res.type("html").send(renderAdminDashboard(current.user.display_name));
  });

  router.get("/admin/products", (req, res) => {
    const current = requireRole(db, req, res, "admin");
    if (!current) {
      return;
    }

    res
      .type("html")
      .send(
        renderAdminProductsPage(listAllProducts(db), current.user.display_name),
      );
  });

  router.get("/admin/products/new", (req, res) => {
    const current = requireRole(db, req, res, "admin");
    if (!current) {
      return;
    }

    res.type("html").send(
      renderProductFormPage(
        "Create Product",
        "Create Product",
        "/admin/products",
        {
          name: "",
          description: "",
          image_path: "/product-photos/placeholder.png",
          price_cents: 0,
          cost_cents: 0,
          inventory_count: 0,
          is_active: 1,
        },
        "Create product",
        current.user.display_name,
      ),
    );
  });

  router.post("/admin/products", (req, res) => {
    const current = requireRole(db, req, res, "admin");
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
            current.user.display_name,
            result.error,
          ),
        );
      return;
    }

    const product = createProduct(db, result.input);
    res.redirect(`/admin/products/${product.id}`);
  });

  router.get("/admin/products/:id/edit", (req, res) => {
    const current = requireRole(db, req, res, "support", "admin");
    if (!current) {
      return;
    }

    const product = requireProduct(db, req, res);
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
          current.user.display_name,
        ),
      );
  });

  router.post("/admin/products/:id", (req, res) => {
    const current = requireRole(db, req, res, "support", "admin");
    if (!current) {
      return;
    }

    const product = requireProduct(db, req, res);
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
            current.user.display_name,
            result.error,
          ),
        );
      return;
    }

    updateProduct(db, product.id, result.input);
    res.redirect(`/admin/products/${product.id}`);
  });

  router.get("/admin/products/:id", (req, res) => {
    const current = requireRole(db, req, res, "admin");
    if (!current) {
      return;
    }

    const product = requireProduct(db, req, res);
    if (!product) {
      return;
    }

    res
      .type("html")
      .send(renderAdminProductPage(product, current.user.display_name));
  });

  return router;
}

function requireRole(
  db: DatabaseSync,
  req: Request,
  res: Response,
  ...allowedRoles: CurrentSession["user"]["role"][]
): CurrentSession | undefined {
  const current = getCurrentSession(db, req.header("cookie"));
  if (!current) {
    res.redirect("/login");
    return undefined;
  }
  const staffRoles = ["support", "admin"];
  if (
    staffRoles.includes(current.user.role) &&
    !allowedRoles.includes(current.user.role)
  ) {
    res.status(403).send("Forbidden");
    return undefined;
  }
  return current;
}

function requireProduct(
  db: DatabaseSync,
  req: Request,
  res: Response,
): Product | undefined {
  const productId = Number(req.params.id);
  if (!Number.isSafeInteger(productId)) {
    sendErrorPage(
      res,
      404,
      "Product Not Found",
      "We couldn't find that product.",
    );
    return undefined;
  }

  const product = findAnyProductById(db, productId);
  if (!product) {
    sendErrorPage(
      res,
      404,
      "Product Not Found",
      "We couldn't find that product.",
    );
    return undefined;
  }

  return product;
}

function parseProductInput(
  body: unknown,
):
  | { ok: true; input: ProductInput }
  | { ok: false; input: ProductInput; error: string } {
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

  if (
    input.name.length === 0 ||
    input.description.length === 0 ||
    input.image_path.length === 0
  ) {
    return {
      ok: false,
      input,
      error: "Name, description, and image path are required.",
    };
  }

  if (!isWholeNumber(input.price_cents) || !isWholeNumber(input.cost_cents)) {
    return { ok: false, input, error: "Price and cost must be whole cents." };
  }

  if (!isWholeNumber(input.inventory_count)) {
    return {
      ok: false,
      input,
      error: "Inventory count must be a whole number.",
    };
  }

  return { ok: true, input };
}

function isWholeNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
