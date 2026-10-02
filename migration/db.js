import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function openDatabase(filename) {
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      s3_key TEXT NOT NULL UNIQUE,
      s3_url TEXT NOT NULL,
      content_type TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      etag TEXT,
      cloudinary_public_id TEXT,
      cloudinary_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','uploading','uploaded','verified','failed')),
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      uploaded_at TEXT,
      verified_at TEXT
    );
  `);
  return db;
}

export async function upsertAsset(db, asset) {
  await db.run(`INSERT INTO assets (s3_key,s3_url,content_type,file_size,etag,status)
    VALUES (?,?,?,?,?,'pending') ON CONFLICT(s3_key) DO UPDATE SET
      s3_url=excluded.s3_url, content_type=COALESCE(excluded.content_type,assets.content_type),
      file_size=excluded.file_size, etag=COALESCE(excluded.etag,assets.etag)`,
    asset.s3Key, asset.s3Url, asset.contentType, asset.fileSize, asset.etag);
}

export const getByStatuses = (db, statuses) => db.all(`SELECT * FROM assets WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY id`, statuses);
export const getByStatus = (db, status) => db.all('SELECT * FROM assets WHERE status = ? ORDER BY id', status);
export const setUploading = (db, id) => db.run("UPDATE assets SET status='uploading', error=NULL WHERE id=? AND status IN ('pending','failed')", id);
export const markUploaded = (db, id, publicId, url) => db.run("UPDATE assets SET status='uploaded', cloudinary_public_id=?, cloudinary_url=?, uploaded_at=datetime('now'), error=NULL WHERE id=?", publicId, url, id);
export const markVerified = (db, id) => db.run("UPDATE assets SET status='verified', verified_at=datetime('now'), error=NULL WHERE id=?", id);
export const markFailed = (db, id, error) => db.run("UPDATE assets SET status='failed', error=? WHERE id=?", String(error).slice(0, 4000), id);
export const markError = (db, id, error) => db.run("UPDATE assets SET error=? WHERE id=?", String(error).slice(0, 4000), id);

export async function summary(db) {
  const rows = await db.all('SELECT status, COUNT(*) count, COALESCE(SUM(file_size),0) bytes FROM assets GROUP BY status');
  const result = Object.fromEntries(['pending','uploading','uploaded','verified','failed'].map((s) => [s, { count: 0, bytes: 0 }]));
  for (const row of rows) result[row.status] = { count: row.count, bytes: row.bytes };
  const total = await db.get('SELECT COUNT(*) count, COALESCE(SUM(file_size),0) bytes FROM assets');
  return { total, ...result };
}
