import type { DatabaseSync } from "node:sqlite";

export type Review = {
  id: number;
  user_id: number;
  product_id: number;
  product_name: string;
  reviewer_name: string;
  rating: number;
  body: string;
  created_at: string;
  updated_at: string;
};

export const MAX_REVIEW_BODY_LENGTH = 1_000;

export function parseReviewBody(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const bodyLength = value.length;
  if (bodyLength < 1 || bodyLength > MAX_REVIEW_BODY_LENGTH) {
    return undefined;
  }

  return value;
}

export function listReviewsForProduct(
  db: DatabaseSync,
  productId: number,
): Review[] {
  return db
    .prepare(
      `
        SELECT
          reviews.id,
          reviews.user_id,
          reviews.product_id,
          products.name AS product_name,
          users.display_name AS reviewer_name,
          reviews.rating,
          reviews.body,
          reviews.created_at,
          reviews.updated_at
        FROM reviews
        JOIN users ON users.id = reviews.user_id
        JOIN products ON products.id = reviews.product_id
        WHERE reviews.product_id = ?
        ORDER BY reviews.created_at DESC, reviews.id DESC
      `,
    )
    .all(productId) as Review[];
}

export function listReviewsForUser(db: DatabaseSync, userId: number): Review[] {
  return db
    .prepare(
      `
        SELECT
          reviews.id,
          reviews.user_id,
          reviews.product_id,
          products.name AS product_name,
          users.display_name AS reviewer_name,
          reviews.rating,
          reviews.body,
          reviews.created_at,
          reviews.updated_at
        FROM reviews
        JOIN users ON users.id = reviews.user_id
        JOIN products ON products.id = reviews.product_id
        WHERE reviews.user_id = ?
        ORDER BY reviews.created_at DESC, reviews.id DESC
      `,
    )
    .all(userId) as Review[];
}

export function findReviewById(
  db: DatabaseSync,
  reviewId: number,
): Review | undefined {
  return db
    .prepare(
      `
        SELECT
          reviews.id,
          reviews.user_id,
          reviews.product_id,
          products.name AS product_name,
          users.display_name AS reviewer_name,
          reviews.rating,
          reviews.body,
          reviews.created_at,
          reviews.updated_at
        FROM reviews
        JOIN users ON users.id = reviews.user_id
        JOIN products ON products.id = reviews.product_id
        WHERE reviews.id = ?
      `,
    )
    .get(reviewId) as Review | undefined;
}

export function createReview(
  db: DatabaseSync,
  userId: number,
  productId: number,
  rating: number,
  body: string,
): void {
  db.prepare(
    `
        INSERT INTO reviews (user_id, product_id, rating, body)
        VALUES (?, ?, ?, ?)
      `,
  ).run(userId, productId, rating, body);
}

export function updateReview(
  db: DatabaseSync,
  reviewId: number,
  rating: number,
  body: string,
): Review | undefined {
  const result = db
    .prepare(
      `
        UPDATE reviews
        SET rating = ?, body = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    )
    .run(rating, body, reviewId);

  if (result.changes === 0) {
    return undefined;
  }

  return findReviewById(db, reviewId);
}

export function deleteReview(db: DatabaseSync, reviewId: number): boolean {
  const result = db
    .prepare(
      `
        DELETE FROM reviews
        WHERE id = ?
      `,
    )
    .run(reviewId);

  return result.changes > 0;
}
