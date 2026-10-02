import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import { configure, exists, publicIdForKey, uploadStream, verifyAsset } from "./cloudinary.js";
import {
  getByStatus,
  getByStatuses,
  markError,
  markFailed,
  markUploaded,
  markVerified,
  openDatabase,
  setUploading,
  summary,
  upsertAsset,
} from "./db.js";
import { createS3, discover, getObjectStream } from "./s3.js";

const config = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
  bucket: process.env.S3_BUCKET,
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.CLOUDINARY_API_SECRET,
};
const concurrency = Math.max(1, Number(process.env.MIGRATION_CONCURRENCY || 3));
const dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), process.env.MIGRATION_DB || "./migration.db");
const log = {
  info: (data, message) => console.log(JSON.stringify({ level: "info", message, ...data })),
  warn: (data, message) => console.warn(JSON.stringify({ level: "warn", message, ...data })),
  error: (data, message) => console.error(JSON.stringify({ level: "error", message, ...data })),
};

function requireConfig(keys) {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}
function bytes(n) {
  return `${n} bytes`;
}
function errorMessage(error) {
  if (typeof error === "string") return error;
  if (error?.message) return error.message;
  if (error?.error?.message) return error.error.message;
  if (error?.http_code) return `HTTP ${error.http_code}: ${JSON.stringify(error)}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function main(command) {
  const db = await openDatabase(dbPath);
  try {
    if (command === "discover") {
      requireConfig(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "S3_BUCKET"]);
      const s3 = createS3(config);
      const count = await discover(s3, config.bucket, config.region, (asset) => upsertAsset(db, asset), log);
      log.info({ count }, "Discovery complete");
    } else if (command === "upload" || command === "retry-failed") {
      requireConfig([
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_REGION",
        "S3_BUCKET",
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
      ]);
      await upload(db, command === "retry-failed" ? ["failed"] : ["pending", "uploading", "failed"]);
    } else if (command === "verify") {
      requireConfig(["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]);
      await verify(db);
    } else if (command === "status") await printStatus(db);
    else throw new Error("Usage: node migrate.js discover|upload|verify|status|retry-failed");
  } finally {
    await db.close();
  }
}
async function upload(db, statuses) {
  const s3 = createS3(config);
  configure(config);
  const assets = await getByStatuses(db, statuses);
  const limit = pLimit(concurrency);
  await Promise.all(assets.map((asset) =>
    limit(async () => {
      const publicId = publicIdForKey(asset.s3_key);
      try {
        const existing = await exists(publicId, asset.content_type === "application/pdf" ? "raw" : "image");
        if (!existing) {
          await setUploading(db, asset.id);
          const stream = await getObjectStream(s3, config.bucket, asset.s3_key);
          const result = await uploadStream(stream, publicId, asset.content_type);
          await markUploaded(db, asset.id, result.public_id, result.secure_url);
          log.info({ key: asset.s3_key }, "Uploaded");
        } else {
          await markUploaded(db, asset.id, existing.public_id || publicId, existing.secure_url);
          log.info({ key: asset.s3_key }, "Existing Cloudinary asset recorded");
        }
      } catch (error) {
        const message = errorMessage(error);
        await markFailed(db, asset.id, message);
        log.error({ key: asset.s3_key, error: message }, "Upload failed");
      }
    })
  ));
}
async function verify(db) {
  configure(config);
  const assets = await getByStatus(db, "uploaded");
  const limit = pLimit(concurrency);
  await Promise.all(assets.map((asset) =>
    limit(async () => {
      try {
        const resourceType = asset.content_type === "application/pdf" ? "raw" : "image";
        await verifyAsset(asset.cloudinary_public_id, asset.cloudinary_url, resourceType);
        await markVerified(db, asset.id);
        log.info({ key: asset.s3_key }, "Verified");
      } catch (error) {
        const message = `Verification failed: ${errorMessage(error)}`;
        await markError(db, asset.id, message);
        log.error({ key: asset.s3_key, error: message }, "Verification failed");
      }
    })
  ));
}
async function printStatus(db) {
  const s = await summary(db);
  console.log(
    `Total S3 objects: ${s.total.count}\nTotal pending: ${s.pending.count}\nTotal uploading: ${s.uploading.count}\nTotal uploaded: ${s.uploaded.count}\nTotal verified: ${s.verified.count}\nTotal failed: ${s.failed.count}\nTotal bytes migrated: ${
      bytes(s.verified.bytes)
    }\nTotal bytes remaining: ${bytes(s.pending.bytes + s.uploading.bytes + s.uploaded.bytes + s.failed.bytes)}`,
  );
  for (const row of await getByStatus(db, "failed")) {
    console.log(`FAILED\t${row.s3_key}\t${row.error || "unknown error"}`);
  }
}

main(process.argv[2]).catch((error) => {
  log.error({ error: error.message }, "Migration command failed");
  process.exitCode = 1;
});
