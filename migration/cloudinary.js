import { v2 as cloudinary } from 'cloudinary';
import path from 'node:path';

export function configure(config) { cloudinary.config({ cloud_name: config.cloudName, api_key: config.apiKey, api_secret: config.apiSecret, secure: true }); return cloudinary; }
export function publicIdForKey(key) { return key.replace(/\\/g, '/').replace(/\.[^/.]+$/, ''); }
export async function exists(publicId, resourceType) { try { return await cloudinary.api.resource(publicId, { resource_type: resourceType }); } catch (error) { const message = String(error?.message || error?.error?.message || ''); if (error?.http_code === 404 || /resource not found/i.test(message)) return null; throw error; } }
export function uploadStream(stream, publicId, contentType) {
  const resourceType = contentType === 'application/pdf' || path.extname(publicId).toLowerCase() === '.pdf' ? 'raw' : 'image';
  return new Promise((resolve, reject) => { const upload = cloudinary.uploader.upload_stream({ public_id: publicId, resource_type: resourceType, overwrite: false, unique_filename: false, use_filename: false }, (error, result) => error ? reject(error) : resolve({ ...result, resourceType })); stream.on?.('error', reject); upload.on?.('error', reject); stream.pipe(upload); });
}
export async function verifyAsset(publicId, url, resourceType) { await exists(publicId, resourceType); const response = await fetch(url, { method: 'HEAD' }); if (!response.ok) throw new Error(`Cloudinary URL returned HTTP ${response.status}`); }
