import { v2 as cloudinary } from 'cloudinary';
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

function resourceType(contentType = '') {
    if (contentType === 'application/pdf') return 'raw';
    if (contentType.startsWith('video/')) return 'video';
    return 'image';
}

function publicIdForKey(key, type) {
    return type === 'raw' ? key : key.replace(/\\/g, '/').replace(/\.[^/.]+$/, '');
}

export function uploadToCloudinary({ key, body, contentType }) {
    const type = resourceType(contentType);
    const publicId = publicIdForKey(key, type);

    return new Promise((resolve, reject) => {
        const upload = cloudinary.uploader.upload_stream({
            public_id: publicId,
            resource_type: type,
            type: 'upload',
            access_mode: 'public',
            overwrite: false,
            unique_filename: false,
            use_filename: false
        }, (error, result) => error ? reject(error) : resolve(result));

        upload.on('error', reject);
        upload.end(body);
    });
}

export function cloudinaryUrlForKey(key, contentType) {
    const type = resourceType(contentType);
    const publicId = publicIdForKey(key, type);
    const extension = '';
    return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/${type}/upload/${publicId}${extension}`;
}

export function createCloudinaryStore() {
    return {
        async send(command) {
            const input = command.input || command;
            const result = await uploadToCloudinary({ key: input.Key, body: input.Body, contentType: input.ContentType });
            return { ...result, secure_url: result.secure_url };
        }
    };
}

export class CloudinaryPutObjectCommand {
    constructor(input) { this.input = input; }
}

export { resourceType, publicIdForKey };
