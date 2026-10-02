import sqlite3 from 'sqlite3';
import { promisify } from 'node:util';

const source = new sqlite3.Database(process.argv[2] || '/tmp/migration.db');
const target = new sqlite3.Database(process.argv[3] || '/usr/src/app/data/jewelry_orders.db');
const all = promisify(source.all.bind(source));
const run = (sql, params = []) => new Promise((resolve, reject) => target.run(sql, params, function (error) { error ? reject(error) : resolve(this); }));
const exec = promisify(target.exec.bind(target));

const mappings = await all("SELECT s3_url, cloudinary_url FROM assets WHERE status='verified' AND cloudinary_url IS NOT NULL");
let updated = 0;
await exec('BEGIN');
try {
  for (const { s3_url: sourceUrl, cloudinary_url: cloudinaryUrl } of mappings) {
    for (const [table, column] of [['orders', 'photoUrl'], ['polki_inventory', 'photo_url'], ['karigar_repairs', 'photo_urls']]) {
      const result = await run(`UPDATE ${table} SET ${column}=replace(${column}, ?, ?) WHERE ${column} LIKE ?`, [sourceUrl, cloudinaryUrl, `%${sourceUrl}%`]);
      updated += result.changes || 0;
    }
  }
  await exec('COMMIT');
  console.log(`Updated ${updated} production rows using ${mappings.length} verified mappings.`);
} catch (error) {
  await exec('ROLLBACK');
  throw error;
} finally {
  source.close();
  target.close();
}
