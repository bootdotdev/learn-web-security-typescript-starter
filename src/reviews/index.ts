import { getDb } from "../db/index.ts";

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

export function listReviewsForProduct(productId: number): Review[] {
  return getDb()
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

export function listReviewsForUser(userId: number): Review[] {
  return getDb()
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

export function findReviewById(reviewId: number): Review | undefined {
  return getDb()
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
  userId: number,
  productId: number,
  rating: number,
  body: string,
): void {
  getDb()
    .prepare(
      `
        INSERT INTO reviews (user_id, product_id, rating, body)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(userId, productId, rating, body);
}

export function updateReview(reviewId: number, rating: number, body: string): Review | undefined {
  const result = getDb()
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

  return findReviewById(reviewId);
}

export function deleteReview(reviewId: number): boolean {
  const result = getDb()
    .prepare(
      `
        DELETE FROM reviews
        WHERE id = ?
      `,
    )
    .run(reviewId);

  return result.changes > 0;
}
