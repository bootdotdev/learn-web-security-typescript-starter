import { existsSync, readFileSync } from "node:fs";
import { initDependencies } from "../src/dependencies.ts";
import { getCurrentSession } from "../src/auth/sessions.ts";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const baseURL = process.argv[2] ?? "http://localhost:3000";
const origin = new URL(baseURL).origin;
const deps = initDependencies();
const db = deps.db;

let originalTotpSecret;
let originalReview;
let originalCartItem;
let previousMaxReviewId;
let previousMaxOrderId;
let mabelUserId;

try {
  const firstCookie = await loginAsMabel();
  const secondCookie = await loginAsMabel();
  const firstCurrent = getCurrentSession(db, firstCookie);
  const secondCurrent = getCurrentSession(db, secondCookie);
  if (!firstCurrent || !secondCurrent) {
    throw new Error("The CSRF probe requires two valid Mabel sessions");
  }

  mabelUserId = firstCurrent.user.id;
  const firstToken = firstCurrent.session.csrf_token;
  const secondToken = secondCurrent.session.csrf_token;
  originalTotpSecret = db
    .prepare("SELECT totp_secret FROM users WHERE id = ?")
    .get(mabelUserId)?.totp_secret;
  originalReview = db
    .prepare("SELECT rating, body, updated_at FROM reviews WHERE id = 1 AND user_id = ?")
    .get(mabelUserId);
  originalCartItem = db
    .prepare("SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = 1")
    .get(mabelUserId);
  previousMaxReviewId = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM reviews").get().id;
  previousMaxOrderId = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM orders").get().id;

  if (!originalReview) {
    throw new Error("The CSRF probe requires seeded review 1");
  }

  db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(
    "KXDYU6DRQPRQXLPY236SJJXPNGHQJVUF",
    mabelUserId,
  );

  const [accountHtml, productHtml, storefrontHtml, reviewHtml, totpHtml] = await Promise.all([
    getHtml("/account", firstCookie),
    getHtml("/products/1", firstCookie),
    getHtml("/", firstCookie),
    getHtml("/account/reviews/1/edit", firstCookie),
    getHtml("/account/totp", firstCookie),
  ]);

  const malformedToken = new URLSearchParams([
    ["csrfToken", "first"],
    ["csrfToken", "second"],
    ["email", "mabel@example.com"],
    ["currentPassword", "password123"],
  ]);

  const emailChangeStatus = await post("/account/email", firstCookie, malformedToken);
  const totpDisableStatus = await post("/account/totp/disable", firstCookie, {
    csrfToken: secondToken,
  });
  const reviewCreateStatus = await post("/products/1/reviews", firstCookie, {
    rating: "5",
    body: "Missing token attempt",
  });
  const reviewEditStatus = await post("/account/reviews/1", firstCookie, {
    csrfToken: "invalid-token",
    rating: "5",
    body: "Invalid edit attempt",
  });
  const reviewDeleteStatus = await post("/account/reviews/1/delete", firstCookie, {
    csrfToken: "invalid-token",
  });
  const cartAddStatus = await post("/cart/items", firstCookie, {
    csrfToken: secondToken,
    productId: "1",
    quantity: "1",
  });
  const crossOriginStatus = await post(
    "/cart/items",
    firstCookie,
    {
      csrfToken: firstToken,
      productId: "1",
      quantity: "1",
    },
    "https://bearly-evil.example",
  );

  const validCartStatus = await post("/cart/items", firstCookie, {
    csrfToken: firstToken,
    productId: "1",
    quantity: "1",
  });
  const [cartHtml, checkoutHtml] = await Promise.all([
    getHtml("/cart", firstCookie),
    getHtml("/checkout", firstCookie),
  ]);

  const cartUpdateStatus = await post("/cart/items/1", firstCookie, {
    csrfToken: "invalid-token",
    quantity: "2",
  });
  const checkoutStatus = await post("/checkout", firstCookie, {
    csrfToken: "invalid-token",
    shippingName: "Mabel Pines",
    shippingAddress: "618 Gopher Road",
    shippingCity: "Gravity Falls",
    shippingRegion: "OR",
    shippingPostalCode: "97000",
  });
  const userAfterRejected = db
    .prepare("SELECT email, totp_secret FROM users WHERE id = ?")
    .get(mabelUserId);
  const reviewAfterRejected = db
    .prepare("SELECT rating, body FROM reviews WHERE id = 1 AND user_id = ?")
    .get(mabelUserId);
  const cartAfterRejected = db
    .prepare("SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = 1")
    .get(mabelUserId);
  const maxOrderIdAfterRejected = db
    .prepare("SELECT COALESCE(MAX(id), 0) AS id FROM orders")
    .get().id;
  const validReviewStatus = await post("/account/reviews/1", firstCookie, {
    csrfToken: firstToken,
    rating: String(originalReview.rating),
    body: originalReview.body,
  });

  const forms = {
    emailChange: formHasToken(accountHtml, "/account/email", firstToken),
    totpDisable: formHasToken(totpHtml, "/account/totp/disable", firstToken),
    reviewCreate: formHasToken(productHtml, "/products/1/reviews", firstToken),
    reviewEdit: formHasToken(reviewHtml, "/account/reviews/1", firstToken),
    reviewDelete: formHasToken(reviewHtml, "/account/reviews/1/delete", firstToken),
    productCartAdd: formHasToken(productHtml, "/cart/items", firstToken),
    storefrontCartAdd: formHasToken(storefrontHtml, "/cart/items", firstToken),
    cartUpdate: formHasToken(cartHtml, "/cart/items/1", firstToken),
    checkout: formHasToken(checkoutHtml, "/checkout", firstToken),
  };
  const routes = {
    emailChange: emailChangeStatus === 403,
    totpDisable: totpDisableStatus === 403,
    reviewCreate: reviewCreateStatus === 403,
    reviewEdit: reviewEditStatus === 403,
    reviewDelete: reviewDeleteStatus === 403,
    cartAdd: cartAddStatus === 403,
    cartUpdate: cartUpdateStatus === 403,
    checkout: checkoutStatus === 403,
  };

  console.log(
    JSON.stringify({
      sessionTokensAreDistinct:
        typeof firstToken === "string" &&
        firstToken.length >= 32 &&
        typeof secondToken === "string" &&
        firstToken !== secondToken,
      forms,
      routes,
      allFormsIncludeToken: Object.values(forms).every(Boolean),
      allRoutesRejectInvalidTokens: Object.values(routes).every(Boolean),
      missingTokenRejected: reviewCreateStatus === 403,
      malformedTokenRejected: emailChangeStatus === 403,
      crossSessionTokenRejected: cartAddStatus === 403 && totpDisableStatus === 403,
      validTokensAccepted: validCartStatus === 302 && validReviewStatus === 302,
      requestSourceValidationRetained: crossOriginStatus === 403,
      rejectedRequestsLeaveStateUnchanged:
        userAfterRejected?.email === "mabel@example.com" &&
        userAfterRejected?.totp_secret === "KXDYU6DRQPRQXLPY236SJJXPNGHQJVUF" &&
        reviewAfterRejected?.rating === originalReview.rating &&
        reviewAfterRejected?.body === originalReview.body &&
        cartAfterRejected?.quantity === 1 &&
        maxOrderIdAfterRejected === previousMaxOrderId,
      timingSafeComparisonUsed:
        existsSync("src/csrf.ts") &&
        /\btimingSafeEqual\s*\(/.test(readFileSync("src/csrf.ts", "utf8")),
    }),
  );
} finally {
  try {
    if (mabelUserId !== undefined && originalTotpSecret !== undefined) {
      db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(
        originalTotpSecret,
        mabelUserId,
      );
    }
    if (originalReview && previousMaxReviewId !== undefined) {
      db.prepare("UPDATE reviews SET rating = ?, body = ?, updated_at = ? WHERE id = 1").run(
        originalReview.rating,
        originalReview.body,
        originalReview.updated_at,
      );
      db.prepare("DELETE FROM reviews WHERE id > ?").run(previousMaxReviewId);
    }
    if (mabelUserId !== undefined) {
      if (originalCartItem) {
        db.prepare("UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = 1").run(
          originalCartItem.quantity,
          mabelUserId,
        );
      } else {
        db.prepare("DELETE FROM cart_items WHERE user_id = ? AND product_id = 1").run(mabelUserId);
      }
    }
  } finally {
    db.close();
  }
}

async function loginAsMabel() {
  const response = await fetch(new URL("/login", baseURL), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
    },
    body: new URLSearchParams({
      email: "mabel@example.com",
      password: "password123",
      returnTo: "/account",
    }),
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie")?.match(/^(session_id=[^;]+)/)?.[1];
  if (response.status !== 302 || !cookie) {
    throw new Error(`Mabel login failed with status ${response.status}`);
  }
  return cookie;
}

async function getHtml(path, cookie) {
  const response = await fetch(new URL(path, baseURL), {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  if (response.status !== 200) {
    return "";
  }
  return response.text();
}

async function post(path, cookie, body, requestOrigin = origin) {
  const response = await fetch(new URL(path, baseURL), {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: requestOrigin,
    },
    body: body instanceof URLSearchParams ? body : new URLSearchParams(body),
    redirect: "manual",
  });
  return response.status;
}

function formHasToken(html, action, token) {
  if (typeof token !== "string" || !token) {
    return false;
  }
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  return forms.some((form) => {
    if (!form.includes(`action="${action}"`)) {
      return false;
    }
    const inputs = form.match(/<input\b[^>]*>/g) ?? [];
    return inputs.some(
      (input) =>
        input.includes('name="csrfToken"') &&
        input.includes('type="hidden"') &&
        input.includes(`value="${token}"`),
    );
  });
}
