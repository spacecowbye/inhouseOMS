# S3 → Cloudinary migration

Architecture: `migrate.js` orchestrates the phases, `s3.js` only reads S3, `cloudinary.js` handles deterministic uploads and checks, and `db.js` owns the SQLite ledger. The ledger is the resumability boundary; S3 is never written to.

## Install

```sh
cd migration
npm install
cp .env.example .env
# fill in .env; never commit it
```

Schema is created automatically in `migration.db`: `assets` has a unique `s3_key`, source metadata, Cloudinary mapping, status, errors, and timestamps. The database is temporary; retain it until verification is complete.

## Run

```sh
node migrate.js discover
node migrate.js status
node migrate.js upload
node migrate.js verify
node migrate.js status
node migrate.js retry-failed

# After verification, update existing application database URLs:
APP_DB=../server/data/jewelry_orders.db node apply-cloudinary-urls.js

# Inspect logical Cloudinary folders (folders are created automatically by public_id paths):
node create-cloudinary-folders.js
```

Discovery paginates with `ListObjectsV2`, performs no downloads, and uses an upsert so reruns do not duplicate rows. Uploads are limited by `MIGRATION_CONCURRENCY` (default 3), stream S3 objects, and skip already-verified/uploaded records. The public ID is the normalized S3 key without its extension. Before uploading, the script checks that ID in Cloudinary; this also handles a successful upload followed by a process crash before SQLite is updated. Existing assets are recorded rather than overwritten (`overwrite: false`). PDFs use Cloudinary `raw` resources; supported images use `image`.

Verification checks both Cloudinary API existence and an HTTP `HEAD` against the stored URL. Only successful checks become `verified`; failures remain `uploaded` with an error message so a later `verify` retries verification without re-uploading. `status` reports counts, bytes, and failed keys.

Before deleting anything from S3, run `discover`, then `upload`, `verify`, and `status`; investigate every failed or non-verified row, spot-check URLs and application references, and keep an independent backup/export of the ledger. This tool has no S3 delete or write operation.
