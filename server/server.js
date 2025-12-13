import express from "express"
import sqlite3 from "sqlite3"
import cors from "cors"
import process from "process"
import path, { dirname } from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import multer from 'multer'
import sharp from "sharp"

// ES MODULE FIX FOR __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const sqlite = sqlite3.verbose();
const app = express();
const PORT = 3001;

// ----- USER AUTHENTICATION CONFIG -----
const AUTH_USER = process.env.AUTH_USER || 'admin'; 
const AUTH_PASS = process.env.AUTH_PASS || 'password'; 

// Middleware for HTTP Basic Authentication
const basicAuth = (req, res, next) => {
    console.log('==== [AUTH] Incoming Auth Header:', req.headers.authorization || 'NONE');

    const authHeader = req.headers.authorization;

    console.log('\n======================================');
    console.log('[AUTH] Expected USER:', AUTH_USER);
    console.log('[AUTH] Expected PASS:', AUTH_PASS);
    console.log('--------------------------------------');
    
    console.log('[AUTH] Received Auth Header:', authHeader ? authHeader.substring(0, 30) + '...' : 'NONE');

    if (!authHeader) {
        console.log('[AUTH] ❌ No auth header present.');
        return res.status(401).json({ status: "error", message: "Authentication required by client." });
    }

    const [type, credentials] = authHeader.split(' ');
    if (type !== 'Basic' || !credentials) {
        console.log('[AUTH] ❌ Invalid auth scheme.');
        return res.status(401).json({ status: "error", message: "Invalid authentication scheme." });
    }

    let decoded;
    try {
        decoded = Buffer.from(credentials, 'base64').toString();
    } catch (e) {
        console.log('[AUTH] ❌ Invalid token encoding.');
        return res.status(401).json({ status: "error", message: "Invalid token encoding." });
    }
    
    const [user, pass] = decoded.split(':');

    console.log('[AUTH] Decoded Request USER:', user);
    console.log('[AUTH] Decoded Request PASS:', pass);

    if (user === AUTH_USER && pass === AUTH_PASS) {
        console.log('[AUTH] ✅ Authentication successful.');
        return next();
    } else {
        console.log('[AUTH] ❌ Invalid credentials.');
        return res.status(401).json({ status: "error", message: "Invalid credentials." });
    }
};
// ------------------------------------


// ----- DB SETUP -----
const dbDir = path.join(__dirname, "data");
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, "jewelry_orders.db");


// --- AWS CONFIGURATION ---
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});


// ---- NEW IMAGE UPLOAD CONFIG (HEIC SUPPORT) ----
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        const allowed = [
            "image/jpeg",
            "image/png",
            "image/heic",
            "image/heif"
        ];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error("Unsupported file type"), false);
    }
});
// ----------------------------------------------------


// --- CONFIGURATION ---
app.use(cors());
app.use(express.json());

// --- APPLY AUTHENTICATION TO ALL API ENDPOINTS ---
app.use('/api', basicAuth);
// --------------------------------------------------


// --- GLOBAL ERROR HANDLER ---
const handleServerError = (res, error, message = "Internal Server Error") => {
    console.error(`[ERROR] ${message}:`, error.message);
    res.status(500).json({ status: "error", message: message, details: error.message });
};


// --- DATABASE INITIALIZATION ---
const db = new sqlite.Database(dbPath, (err) => {
    if (err) {
        console.error("[FATAL] Error opening database:", err.message);
        process.exit(1); 
    } else {
        console.log('[INFO] Database connected at:', dbPath);

        db.run(`
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, address TEXT, mobile TEXT,
                advancePaid INTEGER, remainingAmount INTEGER, totalAmount INTEGER,
                orderReceivedDate TEXT, sentToWorkshopDate TEXT, returnedFromWorkshopDate TEXT, 
                collectedByCustomerDate TEXT, type TEXT, trackingNumber TEXT, 
                shippingDate TEXT, photoUrl TEXT, karigarName TEXT, 
                repairCourierCharges INTEGER, notes TEXT  
            )
        `, (err) => {
            if (err) {
                console.error("[FATAL] Error creating table:", err.message);
                process.exit(1);
            }
            console.log("[INFO] Orders table ready.");
        });
    }
});


// --- NEW ENDPOINT: IMAGE UPLOAD (HEIC → JPEG CONVERSION) ---
app.post('/api/orders/upload-photo', upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: "error", message: "No file uploaded" });
        }

        let outputBuffer = req.file.buffer;
        let finalExtension = "jpg";

        // Convert HEIC → JPEG
        if (req.file.mimetype === "image/heic" || req.file.mimetype === "image/heif") {
            outputBuffer = await sharp(req.file.buffer)
                .jpeg({ quality: 90 })
                .toBuffer();
        }

        const filename = `orders/${Date.now()}.${finalExtension}`;

        await s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: filename,
            Body: outputBuffer,
            ACL: "public-read",
            ContentType: "image/jpeg"
        }));

        const publicUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;

        console.log(`[INFO] Image uploaded to S3: ${publicUrl}`);

        res.json({
            status: "success",
            photoUrl: publicUrl
        });

    } catch (err) {
        console.error("[UPLOAD ERROR]", err);
        res.status(500).json({ status: "error", message: "Upload failed" });
    }
});
// --- END IMAGE UPLOAD ---


// --- TRACKING PROXY ---
app.post('/api/track-order', async (req, res) => {
    const { awb } = req.body;
    if (!awb) return res.status(400).json({ status: 'error', message: 'AWB required' });

    try {
        console.log(`[INFO] Tracking AWB: ${awb}`);
        
        // Using headers/cookie from user's provided CURL command
        const response = await fetch('https://www.trackon.in/courier-tracking', {
            method: 'POST',
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.9',
                'cache-control': 'max-age=0',
                'content-type': 'application/x-www-form-urlencoded',
                'cookie': '__RequestVerificationToken=uKJc6P-mP8WzTYIlbDBvPe5VgSuwV-z91RU2bOVi4ZpVa-_zPMSapgcpgU-DcU6njHBLjdYwIbH8dytGUIrMPOcKfsMwyRQTc25a0B2VcPY1',
                'origin': 'https://www.trackon.in',
                'referer': 'https://www.trackon.in/courier-tracking',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            body: `awbSingleTrackingId=${awb}&submit=Submit`
        });

        const html = await response.text();
        
        // Extract strictly the table
        const tableMatch = html.match(/<table[^>]*class="[^"]*table-hightlight[^"]*"[^>]*>[\s\S]*?<\/table>/i);
        
        if (tableMatch) {
            let cleanHtml = tableMatch[0];
            // Fix relative image paths to point to trackon.in
            cleanHtml = cleanHtml.replace(/\/assets\/images\//g, 'https://www.trackon.in/assets/images/');
            // Remove onClick handlers that might cause errors
            cleanHtml = cleanHtml.replace(/onclick="[^"]*"/g, '');
            // Remove hrefs to modals
            cleanHtml = cleanHtml.replace(/href="#BModel"/g, 'href="#" style="pointer-events: none; text-decoration: none; color: inherit;"');
            
            // Hide Transaction Number (2nd col) and Image (4th col)
            const hideCss = `
                <style>
                    table.footable tr > *:nth-child(2), 
                    table.footable tr > *:nth-child(4) { 
                        display: none !important; 
                    }
                </style>
            `;
            
            res.send(hideCss + cleanHtml);
        } else {
            res.send('<div class="p-4 text-center text-gray-500">No tracking information found for this AWB.</div>');
        }

    } catch (e) {
        console.error("[TRACKING ERROR]", e);
        res.status(500).json({ status: 'error', message: 'Tracking failed' });
    }
});
// ----------------------



// ---------------- ORDERS CRUD ----------------

// GET all orders
app.get('/api/orders', (req, res) => {
    const sortBy = req.query.sortBy || 'orderReceivedDate'; 
    const sortDirection = (req.query.sortDirection || 'desc').toUpperCase();

    const validSortColumns = [
        'id', 'firstName', 'lastName', 'advancePaid', 'totalAmount', 
        'orderReceivedDate', 'sentToWorkshopDate', 'returnedFromWorkshopDate', 'type'
    ];
    if (!validSortColumns.includes(sortBy)) {
        return res.status(400).json({ status: "error", message: `Invalid sortBy column: ${sortBy}` });
    }

    const statsSql = `
        SELECT 
            COUNT(CASE WHEN collectedByCustomerDate IS NOT NULL THEN 1 END) AS delivered,
            COUNT(CASE WHEN collectedByCustomerDate IS NULL THEN 1 END) AS total,
            COUNT(CASE WHEN collectedByCustomerDate IS NULL AND returnedFromWorkshopDate IS NOT NULL THEN 1 END) AS ready,
            COUNT(CASE WHEN collectedByCustomerDate IS NULL AND returnedFromWorkshopDate IS NULL AND sentToWorkshopDate IS NOT NULL THEN 1 END) AS inWorkshop,
            COUNT(CASE WHEN collectedByCustomerDate IS NULL AND returnedFromWorkshopDate IS NULL AND sentToWorkshopDate IS NULL THEN 1 END) AS received
        FROM orders
    `;

    db.get(statsSql, [], (err, statsRow) => {
        if (err) { return handleServerError(res, err, "Failed to calculate global statistics"); }
        
        const dataSql = `
            SELECT * FROM orders 
            ORDER BY ${sortBy} ${sortDirection}
        `;

        db.all(dataSql, [], (err, rows) => { 
            if (err) { return handleServerError(res, err, "Failed to fetch all orders"); }
            
            res.json({
                status: "success",
                data: rows,
                stats: {
                    total: statsRow.total, received: statsRow.received, inWorkshop: statsRow.inWorkshop, 
                    ready: statsRow.ready, delivered: statsRow.delivered,
                },
            });
        });
    });
});


// POST new order
app.post('/api/orders', (req, res) => {
    const order = req.body;
    
    // UPDATED → totalAmount is no longer mandatory
    if (!order.firstName || !order.orderReceivedDate) {
        console.error("[ERROR] Missing required fields in POST body.");
        return res.status(400).json({
            status: "error",
            message: "Missing required fields (firstName, orderReceivedDate)."
        });
    }

    const allColumns = [
        'firstName', 'lastName', 'address', 'mobile', 'advancePaid', 'remainingAmount', 
        'totalAmount', 'orderReceivedDate', 'sentToWorkshopDate', 'returnedFromWorkshopDate', 
        'collectedByCustomerDate', 'type', 'trackingNumber', 'shippingDate', 'photoUrl', 
        'karigarName', 'repairCourierCharges', 'notes' 
    ];
    
    const keys = [];
    const placeholders = [];
    const values = [];

    allColumns.forEach(col => {
        if (Object.prototype.hasOwnProperty.call(order, col)) {
            keys.push(col);
            placeholders.push('?');
            values.push(order[col]);
        }
    });

    const sql = `INSERT INTO orders (${keys.join(', ')}) VALUES (${placeholders.join(', ')})`;

    db.run(sql, values, function(err) {
        if (err) {
            return handleServerError(res, err, "Failed to insert new order into database");
        }
        const newOrder = { id: this.lastID, ...order };
        console.log(`[INFO] Successfully created new order ID: ${newOrder.id}`);
        res.status(201).json({ status: "success", data: newOrder });
    });
});


// PUT update order
app.put('/api/orders/:id', (req, res) => {
    const id = req.params.id;
    const order = req.body;
    
    const updateFields = Object.keys(order).filter(key => key !== 'id');
    if (updateFields.length === 0) {
        return res.status(400).json({ status: "error", message: "No fields provided for update." });
    }

    const setString = updateFields.map(key => `${key} = ?`).join(', ');
    const values = updateFields.map(key => order[key]);
    values.push(id); 

    const sql = `UPDATE orders SET ${setString} WHERE id = ?`;

    db.run(sql, values, function(err) {
        if (err) {
            return handleServerError(res, err, `Failed to update order ID: ${id}`);
        }
        if (this.changes === 0) {
            console.warn(`[WARN] Attempted update on non-existent order ID: ${id}`);
            return res.status(404).json({ status: "error", message: `Order ID ${id} not found.` });
        }
        console.log(`[INFO] Successfully updated order ID: ${id}. Changes: ${this.changes}`);
        res.status(200).json({ status: "success", message: "Order updated successfully", changes: this.changes });
    });
});


// DELETE order
app.delete('/api/orders/:id', (req, res) => {
    const id = req.params.id;
    const sql = "DELETE FROM orders WHERE id = ?";

    db.run(sql, id, function(err) {
        if (err) {
            return handleServerError(res, err, `Failed to delete order ID: ${id}`);
        }
        if (this.changes === 0) {
            console.warn(`[WARN] Attempted delete on non-existent order ID: ${id}`);
            return res.status(404).json({ status: "error", message: `Order ID ${id} not found.` });
        }
        console.log(`[INFO] Successfully deleted order ID: ${id}. Changes: ${this.changes}`);
        res.status(200).json({ status: "success", message: "Order deleted successfully", changes: this.changes });
    });
});


// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`[INFO] Server running on http://localhost:${PORT}`);
    console.log(`[INFO] API available at http://localhost:${PORT}/api/orders`);
});
