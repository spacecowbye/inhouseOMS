import 'dotenv/config';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const migrationDb = await open({ filename: process.env.MIGRATION_DB || './migration.db', driver: sqlite3.Database });
const appDb = await open({ filename: process.env.APP_DB || '../server/data/jewelry_orders.db', driver: sqlite3.Database });
const mappings = await migrationDb.all("SELECT s3_url, cloudinary_url FROM assets WHERE status='verified' AND cloudinary_url IS NOT NULL");
const tables = [['orders', 'photoUrl'], ['polki_inventory', 'photo_url'], ['karigar_repairs', 'photo_urls']];
let updated = 0;

await appDb.exec('BEGIN');
try {
  for (const { s3_url: source, cloudinary_url: target } of mappings) {
    for (const [table, column] of tables) {
      const result = await appDb.run(`UPDATE ${table} SET ${column}=replace(${column}, ?, ?) WHERE ${column} LIKE ?`, source, target, `%${source}%`);
      updated += result.changes || 0;
    }
  }
  await appDb.exec('COMMIT');
  console.log(`Updated ${updated} application database rows using ${mappings.length} verified mappings.`);
} catch (error) {
  await appDb.exec('ROLLBACK');
  throw error;
} finally {
  await migrationDb.close();
  await appDb.close();
}
