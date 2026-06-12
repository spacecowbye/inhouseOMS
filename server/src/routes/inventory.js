import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { extractPriceFromImage } from '../utils/ocrUtils.js';
import { generateSkuId } from '../utils/skuUtils.js';

export default function createInventoryRouter(db, s3, bucket, region) {
    const router = express.Router();
    
    // Set up multer memory storage for multipart/form-data uploads
    const upload = multer({
        storage: multer.memoryStorage(),
        fileFilter: (req, file, cb) => {
            const allowed = [
                "image/jpeg",
                "image/png",
                "image/heic",
                "image/heif"
            ];
            if (allowed.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error("Unsupported file type"), false);
            }
        }
    });

    // POST /api/inventory
    router.post('/', upload.single('photo'), async (req, res) => {
        try {
            const { category, quantity, price: manualPrice, description, tags: rawTags, can_sell_separately } = req.body;

            // 1. Validation of required fields
            if (!req.file) {
                return res.status(400).json({ error: "photo is required" });
            }
            if (!category || !['set', 'neckpiece', 'earrings'].includes(category)) {
                return res.status(400).json({ error: "category is required and must be 'set', 'neckpiece', or 'earrings'" });
            }
            const qty = parseInt(quantity);
            if (isNaN(qty) || qty < 1) {
                return res.status(400).json({ error: "quantity is required and must be an integer >= 1" });
            }

            // 2. OCR price from raw buffer (run this BEFORE Sharp processing)
            let price = null;
            if (manualPrice) {
                const parsedManualPrice = parseInt(manualPrice);
                if (!isNaN(parsedManualPrice) && parsedManualPrice > 0) {
                    price = parsedManualPrice;
                }
            }
            
            if (!price) {
                price = await extractPriceFromImage(req.file.buffer);
            }

            if (!price) {
                return res.status(400).json({ error: "price field is required or must be readable from photo" });
            }

            // 3. Process image with Sharp (convert to JPEG, compress quality 80)
            let processedBuffer;
            try {
                processedBuffer = await sharp(req.file.buffer).jpeg({ quality: 80 }).toBuffer();
            } catch (sharpErr) {
                console.error('[SHARP] Processing error:', sharpErr);
                return res.status(500).json({ error: "Failed to process image file" });
            }

            // 4. Upload to S3
            const filename = `polki/manual_${Date.now()}.jpg`;
            const uploadParams = {
                Bucket: bucket,
                Key: filename,
                Body: processedBuffer,
                ACL: 'public-read',
                ContentType: 'image/jpeg'
            };

            await s3.send(new PutObjectCommand(uploadParams));
            const photoUrl = `https://${bucket}.s3.${region}.amazonaws.com/${filename}`;

            // 5. Format parameters
            const canSellSeparately = (can_sell_separately === 'true' || can_sell_separately === true || can_sell_separately === '1' || can_sell_separately === 1) ? 1 : 0;
            
            let tagsJson = '[]';
            if (rawTags) {
                const parsedTags = rawTags.split(',').map(t => t.trim()).filter(t => t.length > 0);
                tagsJson = JSON.stringify(parsedTags);
            }

            // 6. Generate SKU ID and Insert
            generateSkuId(db, (skuId) => {
                const sql = `
                    INSERT INTO polki_inventory (
                        sku_id, category, can_sell_separately, photo_url, price, quantity, description, tags, source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')
                `;
                const values = [skuId, category, canSellSeparately, photoUrl, price, qty, description || '', tagsJson];

                db.run(sql, values, function (insertErr) {
                    if (insertErr) {
                        console.error('[DATABASE] Insert error:', insertErr);
                        return res.status(500).json({ error: "Database error during insertion" });
                    }

                    const lastId = this.lastID;
                    db.get("SELECT * FROM polki_inventory WHERE id = ?", [lastId], (fetchErr, row) => {
                        if (fetchErr || !row) {
                            return res.status(500).json({ error: "Failed to retrieve the created entry" });
                        }

                        if (row.tags) {
                            try {
                                row.tags = JSON.parse(row.tags);
                            } catch (e) {
                                row.tags = [];
                            }
                        } else {
                            row.tags = [];
                        }

                        return res.status(201).json(row);
                    });
                });
            });

        } catch (err) {
            console.error('[API INVENTORY POST ERROR]', err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    // GET /api/inventory
    router.get('/', (req, res) => {
        const { category, search } = req.query;
        let sql = `SELECT * FROM polki_inventory WHERE deleted_at IS NULL`;
        const values = [];

        if (category) {
            sql += ` AND category = ?`;
            values.push(category);
        }

        if (search) {
            sql += ` AND (description LIKE ? OR tags LIKE ?)`;
            const searchVal = `%${search}%`;
            values.push(searchVal, searchVal);
        }

        sql += ` ORDER BY created_at DESC`;

        db.all(sql, values, (err, rows) => {
            if (err) {
                console.error('[DATABASE] Select error:', err);
                return res.status(500).json({ error: "Database error" });
            }

            const formattedRows = rows.map(row => {
                const formatted = { ...row };
                if (formatted.tags) {
                    try {
                        formatted.tags = JSON.parse(formatted.tags);
                    } catch (e) {
                        formatted.tags = [];
                    }
                } else {
                    formatted.tags = [];
                }
                return formatted;
            });

            return res.status(200).json(formattedRows);
        });
    });

    // GET /api/inventory/:sku_id
    router.get('/:sku_id', (req, res) => {
        const skuId = req.params.sku_id;
        const sql = `SELECT * FROM polki_inventory WHERE sku_id = ? AND deleted_at IS NULL`;

        db.get(sql, [skuId], (err, row) => {
            if (err) {
                console.error('[DATABASE] Select one error:', err);
                return res.status(500).json({ error: "Database error" });
            }
            if (!row) {
                return res.status(404).json({ error: 'Not found' });
            }

            if (row.tags) {
                try {
                    row.tags = JSON.parse(row.tags);
                } catch (e) {
                    row.tags = [];
                }
            } else {
                row.tags = [];
            }

            return res.status(200).json(row);
        });
    });

    // PATCH /api/inventory/:sku_id
    router.patch('/:sku_id', (req, res) => {
        const skuId = req.params.sku_id;
        
        // Allowed update fields
        const allowedFields = ['price', 'quantity', 'description', 'tags', 'can_sell_separately'];
        const updates = [];
        const values = [];

        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                
                if (field === 'tags') {
                    // Handle tags array or comma-separated string conversion
                    let tagsJson = '[]';
                    if (Array.isArray(req.body.tags)) {
                        tagsJson = JSON.stringify(req.body.tags);
                    } else if (typeof req.body.tags === 'string') {
                        tagsJson = JSON.stringify(req.body.tags.split(',').map(t => t.trim()).filter(t => t.length > 0));
                    }
                    values.push(tagsJson);
                } else if (field === 'can_sell_separately') {
                    const val = (req.body.can_sell_separately === 'true' || req.body.can_sell_separately === true || req.body.can_sell_separately === '1' || req.body.can_sell_separately === 1) ? 1 : 0;
                    values.push(val);
                } else if (field === 'price' || field === 'quantity') {
                    values.push(parseInt(req.body[field]));
                } else {
                    values.push(req.body[field]);
                }
            }
        });

        if (updates.length === 0) {
            return res.status(400).json({ error: "No valid fields provided for update" });
        }

        updates.push(`updated_at = datetime('now')`);
        values.push(skuId);

        const sql = `UPDATE polki_inventory SET ${updates.join(', ')} WHERE sku_id = ? AND deleted_at IS NULL`;

        db.run(sql, values, function(err) {
            if (err) {
                console.error('[DATABASE] Update error:', err);
                return res.status(500).json({ error: "Database error" });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: "Not found or already deleted" });
            }

            // Re-fetch the updated row
            db.get("SELECT * FROM polki_inventory WHERE sku_id = ?", [skuId], (fetchErr, row) => {
                if (fetchErr || !row) {
                    return res.status(500).json({ error: "Failed to retrieve the updated entry" });
                }

                if (row.tags) {
                    try {
                        row.tags = JSON.parse(row.tags);
                    } catch (e) {
                        row.tags = [];
                    }
                } else {
                    row.tags = [];
                }

                return res.status(200).json(row);
            });
        });
    });

    // DELETE /api/inventory/:sku_id
    router.delete('/:sku_id', (req, res) => {
        const skuId = req.params.sku_id;
        const sql = `UPDATE polki_inventory SET deleted_at = datetime('now') WHERE sku_id = ? AND deleted_at IS NULL`;

        db.run(sql, [skuId], function(err) {
            if (err) {
                console.error('[DATABASE] Soft delete error:', err);
                return res.status(500).json({ error: "Database error" });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: "Not found or already deleted" });
            }

            return res.status(200).json({ message: 'Deleted' });
        });
    });

    return router;
}
