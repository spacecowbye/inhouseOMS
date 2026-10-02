import 'dotenv/config';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const db = await open({ filename: process.env.MIGRATION_DB || './migration.db', driver: sqlite3.Database });
const rows = await db.all('SELECT DISTINCT s3_key FROM assets WHERE instr(s3_key, \'/\') > 0');
const folders = [...new Set(rows.map(({ s3_key }) => s3_key.split('/').slice(0, -1).join('/')).filter(Boolean))].sort();

console.log(`Found ${folders.length} logical folders:`);
for (const folder of folders) console.log(folder);

if (process.argv.includes('--create')) {
  for (const folder of folders) {
    await cloudinary.api.create_folder(folder);
    console.log(`Created: ${folder}`);
  }
} else if (process.argv.includes('--delete')) {
  for (const folder of folders) {
    await cloudinary.api.delete_folder(folder);
    console.log(`Deleted: ${folder}`);
  }
} else {
  console.log('Cloudinary folders are implicit. Uploads using these public_id paths create them automatically. Use --create only if explicit empty folders are required.');
}

await db.close();
