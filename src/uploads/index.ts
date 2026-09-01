import type { DatabaseSync } from "node:sqlite";

export type UploadedFile = {
  id: number;
  user_id: number;
  customer_name: string;
  customer_email: string;
  original_name: string;
  storage_path: string;
  content_type: string;
  created_at: string;
};

export function createUploadedFile(
  db: DatabaseSync,
  userId: number,
  originalName: string,
  storagePath: string,
  contentType: string,
): UploadedFile {
  const result = db
    .prepare(
      `
        INSERT INTO uploaded_files (user_id, original_name, storage_path, content_type)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(userId, originalName, storagePath, contentType);

  const uploadedFile = findUploadedFileById(db, Number(result.lastInsertRowid));
  if (!uploadedFile) {
    throw new Error("Failed to create uploaded file");
  }

  return uploadedFile;
}

export function findUploadedFileById(
  db: DatabaseSync,
  uploadedFileId: number,
): UploadedFile | undefined {
  return db
    .prepare(
      `
        SELECT
          uploaded_files.id,
          uploaded_files.user_id,
          users.display_name AS customer_name,
          users.email AS customer_email,
          uploaded_files.original_name,
          uploaded_files.storage_path,
          uploaded_files.content_type,
          uploaded_files.created_at
        FROM uploaded_files
        JOIN users ON users.id = uploaded_files.user_id
        WHERE uploaded_files.id = ?
      `,
    )
    .get(uploadedFileId) as UploadedFile | undefined;
}

export function listUploadedFilesForUser(
  db: DatabaseSync,
  userId: number,
): UploadedFile[] {
  return db
    .prepare(
      `
        SELECT
          uploaded_files.id,
          uploaded_files.user_id,
          users.display_name AS customer_name,
          users.email AS customer_email,
          uploaded_files.original_name,
          uploaded_files.storage_path,
          uploaded_files.content_type,
          uploaded_files.created_at
        FROM uploaded_files
        JOIN users ON users.id = uploaded_files.user_id
        WHERE uploaded_files.user_id = ?
        ORDER BY uploaded_files.created_at DESC, uploaded_files.id DESC
      `,
    )
    .all(userId) as UploadedFile[];
}

export function listAllUploadedFiles(db: DatabaseSync): UploadedFile[] {
  return db
    .prepare(
      `
        SELECT
          uploaded_files.id,
          uploaded_files.user_id,
          users.display_name AS customer_name,
          users.email AS customer_email,
          uploaded_files.original_name,
          uploaded_files.storage_path,
          uploaded_files.content_type,
          uploaded_files.created_at
        FROM uploaded_files
        JOIN users ON users.id = uploaded_files.user_id
        ORDER BY uploaded_files.created_at DESC, uploaded_files.id DESC
      `,
    )
    .all() as UploadedFile[];
}
