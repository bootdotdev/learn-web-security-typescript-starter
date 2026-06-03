import express from "express";
import { apiCors } from "./cors.ts";
import { errorHandler } from "./errors.ts";
import { router as accountRouter } from "./routes/account.ts";
import { router as adminRouter } from "./routes/admin.ts";
import { router as apiRouter } from "./routes/api.ts";
import { router as authRouter } from "./routes/auth.ts";
import { router as cartRouter } from "./routes/cart.ts";
import { router as checkoutRouter } from "./routes/checkout.ts";
import { router as filesRouter } from "./routes/files.ts";
import { router as healthRouter } from "./routes/health.ts";
import { router as ordersRouter } from "./routes/orders.ts";
import { router as productsRouter } from "./routes/products.ts";
import { router as storefrontRouter } from "./routes/storefront.ts";
import { router as supportRouter } from "./routes/support.ts";

export function createApp(): express.Express {
  const app = express();

  app.set("view engine", "html");

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(express.static("public"));

  app.use(healthRouter);

  app.use("/api", apiCors);
  app.use(apiRouter);

  app.use(authRouter);
  app.use(accountRouter);
  app.use(cartRouter);
  app.use(checkoutRouter);
  app.use(filesRouter);
  app.use(ordersRouter);
  app.use(productsRouter);
  app.use(supportRouter);
  app.use(adminRouter);
  app.use(storefrontRouter);

  app.use(errorHandler);

  return app;
}
