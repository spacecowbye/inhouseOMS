import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { generateKarigarSerialNumber } from '../utils/karigarUtils.js';

export default function createKarigarRouter(db, s3, bucket, region) {
    const router = express.Router();

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

    const getTodayIST = () => {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    };

    // GET /api/karigar-repairs - list with filtering & stats
    router.get('/', (req, res) => {
        const { status, karigar, search, sortBy } = req.query;

        let query = "SELECT * FROM karigar_repairs WHERE 1=1";
        const params = [];

        if (status && status !== 'all') {
            query += " AND status = ?";
            params.push(status);
        }

        if (karigar && karigar !== 'all') {
            query += " AND LOWER(karigar_name) = LOWER(?)";
            params.push(karigar);
        }

        if (search) {
            query += " AND (LOWER(serial_number) LIKE ? OR LOWER(karigar_name) LIKE ? OR LOWER(order_id) LIKE ? OR LOWER(notes) LIKE ?)";
            const s = `%${search.toLowerCase().trim()}%`;
            params.push(s, s, s, s);
        }

        if (sortBy === 'oldest') {
            query += " ORDER BY sent_date ASC, id ASC";
        } else if (sortBy === 'karigar') {
            query += " ORDER BY karigar_name ASC, id DESC";
        } else if (sortBy === 'pieces') {
            query += " ORDER BY photo_count DESC, id DESC";
        } else {
            // default 'newest'
            query += " ORDER BY sent_date DESC, id DESC";
        }

        db.all(query, params, (err, rows) => {
            if (err) {
                console.error("[KARIGAR] DB Query error:", err);
                return res.status(500).json({ status: "error", message: err.message });
            }

            // Also compute overall stats and unique karigar list across all records
            db.all("SELECT * FROM karigar_repairs", [], (statErr, allRows) => {
                if (statErr) {
                    return res.status(500).json({ status: "error", message: statErr.message });
                }

                const today = getTodayIST();
                const currentMonth = today.slice(0, 7); // YYYY-MM

                let totalActivePieces = 0;
                let activeJobs = 0;
                const activeKarigarsSet = new Set();
                let returnedThisMonth = 0;

                const karigarMap = new Map();

                allRows.forEach(item => {
                    const kName = item.karigar_name ? item.karigar_name.trim() : 'Unknown';
                    const isWithKarigar = item.status === 'with_karigar';

                    if (!karigarMap.has(kName)) {
                        karigarMap.set(kName, { name: kName, activePieces: 0, activeJobs: 0, totalJobs: 0 });
                    }
                    const kStats = karigarMap.get(kName);
                    kStats.totalJobs += 1;

                    if (isWithKarigar) {
                        const count = parseInt(item.photo_count, 10) || 1;
                        totalActivePieces += count;
                        activeJobs += 1;
                        activeKarigarsSet.add(kName);
                        kStats.activePieces += count;
                        kStats.activeJobs += 1;
                    }

                    if (item.status === 'returned' && item.returned_date && item.returned_date.startsWith(currentMonth)) {
                        returnedThisMonth += (parseInt(item.photo_count, 10) || 1);
                    }
                });

                res.json({
                    status: "success",
                    data: rows.map(r => ({
                        ...r,
                        photos: r.photo_urls ? r.photo_urls.split(',').map(s => s.trim()).filter(Boolean) : []
                    })),
                    stats: {
                        totalActivePieces,
                        activeJobs,
                        activeKarigars: activeKarigarsSet.size,
                        returnedThisMonth
                    },
                    karigars: Array.from(karigarMap.values()).sort((a, b) => b.activePieces - a.activePieces)
                });
            });
        });
    });

    // POST /api/karigar-repairs - Manual create from dashboard UI
    router.post('/', upload.array('photos', 10), async (req, res) => {
        try {
            const { karigar_name, order_id, notes, sent_date } = req.body;

            if (!karigar_name || !karigar_name.trim()) {
                return res.status(400).json({ status: "error", message: "Karigar name is required" });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ status: "error", message: "At least one photo is required" });
            }

            const cleanKarigar = karigar_name.trim();
            const serialNumber = await generateKarigarSerialNumber(db, cleanKarigar);
            const photoUrls = [];

            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                let outputBuffer = file.buffer;
                let contentType = "image/jpeg";

                // Convert HEIC or process to high-quality JPEG
                if (file.mimetype === "image/heic" || file.mimetype === "image/heif") {
                    outputBuffer = await sharp(file.buffer).jpeg({ quality: 90 }).toBuffer();
                } else if (file.mimetype === "image/png") {
                    contentType = "image/png";
                }

                const filename = `karigar_repairs/${Date.now()}_${i}.jpg`;
                await s3.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: filename,
                    Body: outputBuffer,
                    ACL: "public-read",
                    ContentType: contentType
                }));

                const url = `https://${bucket}.s3.${region}.amazonaws.com/${filename}`;
                photoUrls.push(url);
            }

            const today = sent_date || getTodayIST();
            const sql = `
                INSERT INTO karigar_repairs (
                    serial_number, karigar_name, photo_urls, photo_count,
                    status, order_id, notes, sent_date, sender_number
                ) VALUES (?, ?, ?, ?, 'with_karigar', ?, ?, ?, 'dashboard')
            `;

            const values = [
                serialNumber,
                cleanKarigar,
                photoUrls.join(','),
                photoUrls.length,
                (order_id || '').trim(),
                (notes || '').trim(),
                today
            ];

            db.run(sql, values, function(err) {
                if (err) {
                    console.error("[KARIGAR] DB insert error:", err);
                    return res.status(500).json({ status: "error", message: "Failed to save karigar repair" });
                }

                const newId = this.lastID;
                db.get("SELECT * FROM karigar_repairs WHERE id = ?", [newId], (fetchErr, row) => {
                    if (fetchErr || !row) {
                        return res.status(201).json({ status: "success", id: newId, serialNumber });
                    }
                    res.status(201).json({
                        status: "success",
                        data: {
                            ...row,
                            photos: photoUrls
                        }
                    });
                });
            });

        } catch (err) {
            console.error("[KARIGAR] Upload error:", err);
            res.status(500).json({ status: "error", message: err.message || "Failed to create repair" });
        }
    });

    // PUT /api/karigar-repairs/:id/return - Mark as returned back at showroom
    router.put('/:id/return', (req, res) => {
        const id = req.params.id;
        const today = getTodayIST();

        const sql = `
            UPDATE karigar_repairs 
            SET status = 'returned', returned_date = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;

        db.run(sql, [today, id], function(err) {
            if (err) {
                console.error("[KARIGAR] Return update error:", err);
                return res.status(500).json({ status: "error", message: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ status: "error", message: "Repair record not found" });
            }

            db.get("SELECT * FROM karigar_repairs WHERE id = ?", [id], (fetchErr, row) => {
                if (fetchErr || !row) return res.json({ status: "success", message: "Marked returned" });
                res.json({
                    status: "success",
                    message: `Item ${row.serial_number} marked as returned to showroom.`,
                    data: {
                        ...row,
                        photos: row.photo_urls ? row.photo_urls.split(',') : []
                    }
                });
            });
        });
    });

    // PUT /api/karigar-repairs/:id/reopen - Reopen / move back to with_karigar
    router.put('/:id/reopen', (req, res) => {
        const id = req.params.id;

        const sql = `
            UPDATE karigar_repairs 
            SET status = 'with_karigar', returned_date = NULL, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;

        db.run(sql, [id], function(err) {
            if (err) {
                console.error("[KARIGAR] Reopen error:", err);
                return res.status(500).json({ status: "error", message: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ status: "error", message: "Repair record not found" });
            }

            db.get("SELECT * FROM karigar_repairs WHERE id = ?", [id], (fetchErr, row) => {
                if (fetchErr || !row) return res.json({ status: "success", message: "Reopened" });
                res.json({
                    status: "success",
                    message: `Item ${row.serial_number} moved back to with karigar.`,
                    data: {
                        ...row,
                        photos: row.photo_urls ? row.photo_urls.split(',') : []
                    }
                });
            });
        });
    });

    // PUT /api/karigar-repairs/:id - Edit details (karigar name, order ref, notes)
    router.put('/:id', (req, res) => {
        const id = req.params.id;
        const { karigar_name, order_id, notes, sent_date } = req.body;

        const sql = `
            UPDATE karigar_repairs
            SET karigar_name = COALESCE(?, karigar_name),
                order_id = COALESCE(?, order_id),
                notes = COALESCE(?, notes),
                sent_date = COALESCE(?, sent_date),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;

        db.run(sql, [karigar_name, order_id, notes, sent_date, id], function(err) {
            if (err) {
                return res.status(500).json({ status: "error", message: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ status: "error", message: "Record not found" });
            }
            res.json({ status: "success", message: "Repair updated successfully" });
        });
    });

    // DELETE /api/karigar-repairs/:id
    router.delete('/:id', (req, res) => {
        const id = req.params.id;
        db.run("DELETE FROM karigar_repairs WHERE id = ?", [id], function(err) {
            if (err) {
                return res.status(500).json({ status: "error", message: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ status: "error", message: "Record not found" });
            }
            res.json({ status: "success", message: "Repair record deleted successfully" });
        });
    });

    return router;
}
