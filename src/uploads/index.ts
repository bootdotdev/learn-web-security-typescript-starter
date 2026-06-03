import { getDb } from "../db/index.ts";

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
  userId: number,
  originalName: string,
  storagePath: string,
  contentType: string,
): UploadedFile {
  const result = getDb()
    .prepare(
      `
        INSERT INTO uploaded_files (user_id, original_name, storage_path, content_type)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(userId, originalName, storagePath, contentType);

  const uploadedFile = findUploadedFileById(Number(result.lastInsertRowid));
  if (!uploadedFile) {
    throw new Error("Failed to create uploaded file");
  }

  return uploadedFile;
}

export function findUploadedFileById(uploadedFileId: number): UploadedFile | undefined {
  return getDb()
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

export function listUploadedFilesForUser(userId: number): UploadedFile[] {
  return getDb()
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

export function listAllUploadedFiles(): UploadedFile[] {
  return getDb()
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
