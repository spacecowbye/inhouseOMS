import { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import path from 'node:path';

export function createS3(config) { return new S3Client({ region: config.region, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }); }
export function publicS3Url(bucket, region, key) { return `https://${bucket}.s3.${region}.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`; }
export function contentTypeForKey(key) { const ext = path.extname(key).toLowerCase(); return ({ '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf' })[ext] || null; }

export async function discover(s3, bucket, region, onObject, logger) {
  let count = 0;
  for await (const page of paginate(s3, bucket)) {
    for (const object of page.Contents ?? []) {
      let contentType = contentTypeForKey(object.Key);
      try { contentType = (await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: object.Key }))).ContentType || contentType; }
      catch (error) { logger.warn({ key: object.Key, error: error.message }, 'HeadObject failed; using extension fallback'); }
      await onObject({ s3Key: object.Key, s3Url: publicS3Url(bucket, region, object.Key), contentType, fileSize: object.Size ?? 0, etag: object.ETag?.replaceAll('"', '') });
      count++;
    }
  }
  return count;
}
async function* paginate(s3, bucket) {
  let token;
  do { const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token })); yield page; token = page.IsTruncated ? page.NextContinuationToken : undefined; } while (token);
}
export async function getObjectStream(s3, bucket, key) { return (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body; }
