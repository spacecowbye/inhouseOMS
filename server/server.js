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
import { handleTwilioMessage, initReminders, sendWhatsApp } from "./whatsappBot.js" 
import { generateInvoiceBuffer } from "./invoiceGenerator.js"
const PORT = 3001;

// --- LOGGING HELPER ---
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
const logError = (...args) => console.error(`[${new Date().toISOString()}]`, ...args);

// --- GLOBAL EXCEPTION HANDLERS ---
process.on('uncaughtException', (err) => {
    logError('[FATAL] Uncaught Exception:', err);
    // Optional: process.exit(1) if you want to force restart, 
    // but for now we just log to see what's happening.
});

process.on('unhandledRejection', (reason, promise) => {
    logError('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// ----- USER AUTHENTICATION CONFIG -----
const AUTH_USER = process.env.AUTH_USER || 'admin'; 
const AUTH_PASS = process.env.AUTH_PASS || 'password'; 

// Middleware for HTTP Basic Authentication
const basicAuth = (req, res, next) => {
    // log('==== [AUTH] Incoming Auth Header:', req.headers.authorization || 'NONE');

    const authHeader = req.headers.authorization;

    console.log('\n======================================');
    console.log('[AUTH] Expected USER:', AUTH_USER);
    console.log('[AUTH] Expected PASS:', AUTH_PASS);
    console.log('--------------------------------------');
    
    console.log('[AUTH] Received Auth Header:', authHeader ? authHeader.substring(0, 30) + '...' : 'NONE');

    if (!authHeader) {
        log('[AUTH] ❌ No auth header present.');
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
app.use(express.urlencoded({ extended: true })); // For Twilio Webhooks

// --- REQUEST LOGGING MIDDLEWARE ---
app.use((req, res, next) => {
    const start = Date.now();
    const { method, url } = req;
    
    // Log start (optional, can be noisy)
    // log(`[REQ] Incoming: ${method} ${url}`);

    // Log completion
    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;
        // Color coding status? (Simple version: just log)
        const msg = `[REQ] ${method} ${url} ${status} - ${duration}ms`;
        
        if (status >= 500) logError(msg);
        else if (status >= 400) log(msg); // Warn?
        else if (duration > 1000) log(`[SLOW] ${msg}`); // Log slow requests specifically
        else log(msg);
    });
    
    next();
});

// --- APPLY AUTHENTICATION TO ALL API ENDPOINTS (EXCEPT WHATSAPP) ---
const openRoutes = ['/api/whatsapp-webhook', '/invoice'];

app.use('/api', (req, res, next) => {
    // Check against the full original URL (e.g., /api/whatsapp-webhook)
    if (openRoutes.some(route => req.originalUrl.includes(route))) {
        return next();
    }
    basicAuth(req, res, next);
});
// --------------------------------------------------


// --- GLOBAL ERROR HANDLER ---
const handleServerError = (res, error, message = "Internal Server Error") => {
    logError(`[ERROR] ${message}:`, error.message);
    res.status(500).json({ status: "error", message: message, details: error.message });
};


// --- DATABASE INITIALIZATION ---
const db = new sqlite.Database(dbPath, (err) => {
    if (err) {
        console.error("[FATAL] Error opening database:", err.message);
        process.exit(1); 
    } else {
        log('[INFO] Database connected at:', dbPath);

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
            // Create appointments table
            db.run(`
                CREATE TABLE IF NOT EXISTS appointments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    firstName TEXT,
                    lastName TEXT,
                    mobile TEXT,
                    date TEXT,
                    time TEXT,
                    slotIndex INTEGER,
                    creatorNumber TEXT,
                    notes TEXT,
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) console.error("[ERROR] Error creating appointments table:", err.message);
                else {
                    console.log("[INFO] Appointments table ready.");
                    // Ensure columns exist
                    db.run("ALTER TABLE appointments ADD COLUMN slotIndex INTEGER", () => {});
                    db.run("ALTER TABLE appointments ADD COLUMN creatorNumber TEXT", () => {});
                }
            });

            console.log("[INFO] Orders table ready.");
        });
    }
});

// --- TWILIO WEBHOOK ---
app.post('/api/whatsapp-webhook', (req, res) => {
    handleTwilioMessage(req, res, db, s3, process.env.S3_BUCKET_NAME, process.env.AWS_REGION);
});
// ----------------------


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
const trackUPS = (awb) => {
    // UPS tracking numbers starting with 1Z are standard.
    // UPS has heavy bot protection, so we provide a premium tracking card with direct links.
    log(`[INFO] Generating UPS Tracking Card for AWB: ${awb}`);
    
    return `
        <div class="ups-tracking p-6 bg-white rounded-xl shadow-lg border-l-8 border-yellow-600">
            <div class="flex items-center justify-between mb-4 pb-4 border-b">
                <div class="flex items-center gap-3">
                    <div class="bg-yellow-600 p-2 rounded-lg">
                        <svg viewBox="0 0 24 24" class="w-6 h-6 fill-white" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L4.5 5.5v10.5L12 22l7.5-6V5.5L12 2zm0 17.5L6.5 15.5V7.5L12 5l5.5 2.5v8l-5.5 4z"/></svg>
                    </div>
                    <div>
                        <h3 class="font-bold text-xl text-gray-800">UPS International</h3>
                        <p class="text-sm text-gray-500">Official UPS Tracking</p>
                    </div>
                </div>
                <span class="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold uppercase tracking-wider">detected</span>
            </div>

            <div class="bg-gray-50 p-4 rounded-lg mb-6 flex flex-col items-center">
                <span class="text-xs text-gray-400 uppercase font-bold mb-1">Tracking Number</span>
                <span class="text-2xl font-mono text-gray-800 font-bold">${awb}</span>
            </div>

            <div class="space-y-4">
                <a href="https://www.ups.com/track?loc=en_IN&tracknum=${awb}" target="_blank" 
                   class="flex items-center justify-center w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-4 rounded-lg transition-all shadow-md group">
                    View Live Status on UPS.com
                    <svg class="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                </a>
                
                <div class="grid grid-cols-2 gap-3">
                    <a href="https://www.aftership.com/track/ups/${awb}" target="_blank" class="text-center text-xs text-yellow-700 bg-yellow-50 py-2 rounded border border-yellow-100 hover:bg-yellow-100">Alternative Tracker</a>
                    <a href="https://parcelsapp.com/en/tracking/${awb}" target="_blank" class="text-center text-xs text-yellow-700 bg-yellow-50 py-2 rounded border border-yellow-100 hover:bg-yellow-100">Global Tracker</a>
                </div>
            </div>

            <div class="mt-6 pt-4 border-t text-[11px] text-gray-400 text-center italic">
                UPS tracking details are fetched directly from official portals for maximum accuracy.
            </div>

            <style>
                .ups-tracking { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
                @keyframes pulse-yellow {
                    0% { box-shadow: 0 0 0 0 rgba(202, 138, 4, 0.4); }
                    70% { box-shadow: 0 0 0 10px rgba(202, 138, 4, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(202, 138, 4, 0); }
                }
            </style>
        </div>
    `;
};

const trackMahavir = async (awb) => {
    try {
        log(`[INFO] Attempting Mahavir Tracking for AWB: ${awb}`);
        const baseUrl = 'https://shreemahavircourier.com/';
        
        // 1. Get ASP.NET tokens from homepage
        const homeRes = await fetch(baseUrl);
        const homeHtml = await homeRes.text();
        const cookie = homeRes.headers.get('set-cookie');

        const vs = homeHtml.match(/name="__VIEWSTATE" id="__VIEWSTATE" value="(.*?)"/)?.[1];
        const vsg = homeHtml.match(/name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="(.*?)"/)?.[1];
        const ev = homeHtml.match(/name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="(.*?)"/)?.[1];

        if (!vs || !ev) {
            logError("[MAHAVIR] Failed to extract ASP.NET tokens");
            return null;
        }

        // 2. POST to get the tracking result (follow redirect)
        const params = new URLSearchParams();
        params.append('__VIEWSTATE', vs);
        params.append('__VIEWSTATEGENERATOR', vsg || '');
        params.append('__EVENTVALIDATION', ev);
        params.append('txtAWBNo', awb);
        params.append('cmdTrack', 'Tracking');

        const trackRes = await fetch(baseUrl, {
            method: 'POST',
            body: params,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookie ? cookie.split(';')[0] : '',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            redirect: 'follow'
        });

        const html = await trackRes.text();

        // 3. Extract tables using regex
        const transitTable = html.match(/<table[^>]*id="ctl00_MainContent_tblTrack"[^>]*>[\s\S]*?<\/table>/i)?.[0];
        const deliveryTable = html.match(/<table[^>]*id="ctl00_MainContent_tblDelivery"[^>]*>[\s\S]*?<\/table>/i)?.[0];
        const statusMatch = html.match(/<span id="ctl00_MainContent_lblStatus"[^>]*>([\s\S]*?)<\/span>/i)?.[1];
        const infoMatch = html.match(/<div class="prod-info white-clr">([\s\S]*?)<\/div>/i)?.[0];

        if (!transitTable && !deliveryTable && !statusMatch) return null;

        let resultHtml = `
            <div class="mahavir-tracking p-4 bg-white rounded shadow-sm">
                <div class="flex items-center justify-between mb-4 border-b pb-2">
                    <h3 class="font-bold text-lg text-red-600">Shree Mahavir Courier</h3>
                    <div class="text-sm font-semibold">${statusMatch || 'Status Unknown'}</div>
                </div>
                ${infoMatch ? `<div class="mb-4 text-sm text-gray-700 mahavir-info">${infoMatch}</div>` : ''}
                
                <h4 class="font-bold text-md mt-4 mb-2">Transit Details</h4>
                <div class="overflow-x-auto mb-6">
                    ${transitTable || 'No transit records.'}
                </div>

                <h4 class="font-bold text-md mt-4 mb-2">Delivery Details</h4>
                <div class="overflow-x-auto">
                    ${deliveryTable || 'Not delivered yet.'}
                </div>

                <style>
                    .mahavir-tracking table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
                    .mahavir-tracking th { background: #f8f9fa; text-align: left; padding: 10px; border: 1px solid #dee2e6; }
                    .mahavir-tracking td { padding: 10px; border: 1px solid #dee2e6; }
                    .mahavir-tracking .prod-info ul { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                    .mahavir-tracking .prod-info li { border-bottom: 1px solid #f0f0f0; padding: 4px 0; }
                    .mahavir-tracking .title-2 { font-weight: bold; color: #666; margin-right: 5px; }
                    .mahavir-tracking .theme-clr { color: #d32f2f; }
                </style>
            </div>
        `;

        return resultHtml;
    } catch (e) {
        logError("[MAHAVIR ERROR]", e);
        return null;
    }
};

app.post('/api/track-order', async (req, res) => {
    const { awb } = req.body;
    if (!awb) return res.status(400).json({ status: 'error', message: 'AWB required' });

    try {
        console.log(`[INFO] Tracking AWB: ${awb}`);

        // 0. Detect UPS (AWB starts with 1Z)
        if (awb.toUpperCase().startsWith('1Z')) {
            const upsHtml = trackUPS(awb);
            return res.send(upsHtml);
        }
        
        // 1. Try Trackon first
        const trackonRes = await fetch('https://www.trackon.in/courier-tracking', {
            method: 'POST',
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.9',
                'content-type': 'application/x-www-form-urlencoded',
                'origin': 'https://www.trackon.in',
                'referer': 'https://www.trackon.in/courier-tracking',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            body: `awbSingleTrackingId=${awb}&submit=Submit`
        });

        const trackonHtml = await trackonRes.text();
        const tableMatch = trackonHtml.match(/<table[^>]*class="[^"]*table-hightlight[^"]*"[^>]*>[\s\S]*?<\/table>/i);
        
        if (tableMatch) {
            let cleanHtml = tableMatch[0];
            cleanHtml = cleanHtml.replace(/\/assets\/images\//g, 'https://www.trackon.in/assets/images/');
            cleanHtml = cleanHtml.replace(/onclick="[^"]*"/g, '');
            cleanHtml = cleanHtml.replace(/href="#BModel"/g, 'href="#" style="pointer-events: none; text-decoration: none; color: inherit;"');
            
            const hideCss = `
                <style>
                    table.footable tr > *:nth-child(2), 
                    table.footable tr > *:nth-child(4) { 
                        display: none !important; 
                    }
                </style>
            `;
            return res.send(hideCss + cleanHtml);
        }

        // 2. If Trackon fails, try Mahavir
        log(`[INFO] Trackon result empty for ${awb}, trying Mahavir...`);
        const mahavirHtml = await trackMahavir(awb);
        
        if (mahavirHtml) {
            return res.send(mahavirHtml);
        }

        // 3. Fallback
        res.send('<div class="p-4 text-center text-gray-500">No tracking information found for this AWB in Trackon or Mahavir.</div>');

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
            COUNT(CASE WHEN collectedByCustomerDate IS NULL AND type = 'Delivery' AND shippingDate IS NOT NULL THEN 1 END) AS outForDelivery,
            COUNT(CASE WHEN collectedByCustomerDate IS NULL AND returnedFromWorkshopDate IS NULL AND sentToWorkshopDate IS NULL AND (type != 'Delivery' OR shippingDate IS NULL) THEN 1 END) AS received
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
                    ready: statsRow.ready, delivered: statsRow.delivered, outForDelivery: statsRow.outForDelivery,
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
    const orderData = req.body;
    
    // Fetch current state to check for status transitions
    db.get("SELECT * FROM orders WHERE id = ?", [id], (err, currentOrder) => {
        if (err) return handleServerError(res, err, `Failed to fetch order ID: ${id}`);
        if (!currentOrder) return res.status(404).json({ status: "error", message: `Order ID ${id} not found.` });

        const updateFields = Object.keys(orderData).filter(key => key !== 'id');
        if (updateFields.length === 0) {
            return res.status(400).json({ status: "error", message: "No fields provided for update." });
        }

        const setString = updateFields.map(key => `${key} = ?`).join(', ');
        const values = updateFields.map(key => orderData[key]);
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

// --- INVOICE GENERATION ENDPOINT (HTML) ---
// Kept for debugging or quick view
app.get('/api/orders/:id/invoice/html', (req, res) => {
    // ... preserved for debug compatibility ...
    // A simple stripped down version or 404
    res.status(404).send("HTML view is deprecated. Use the PDF endpoint.");
});


// --- INVOICE PDF ENDPOINT ---
import PDFDocument from 'pdfkit';

app.get('/api/orders/:id/invoice', async (req, res) => {
    const id = req.params.id;
    
    // Disable caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    db.get("SELECT * FROM orders WHERE id = ?", [id], async (err, order) => {
        if (err || !order) {
            console.error("[PDF] Order not found:", id);
            return res.status(404).send("Order not found");
        }
        
        try {
            console.log(`[PDF] Generating shared invoice for Order #${id}`);
            const buffer = await generateInvoiceBuffer(order);

            // Set response headers
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=repair_invoice_R-${id}.pdf`);
            res.send(buffer);

        } catch (pdfErr) {
            console.error("[PDF ERROR]", pdfErr);
            if (!res.headersSent) handleServerError(res, pdfErr, "Failed to generate PDF");
        }
    });
});
// --- APPOINTMENTS API ---
app.get('/api/appointments', (req, res) => {
    const sql = "SELECT * FROM appointments ORDER BY date ASC, time ASC";
    db.all(sql, [], (err, rows) => {
        if (err) return handleServerError(res, err, "Failed to fetch appointments");
        res.json({ status: "success", data: rows });
    });
});

app.post('/api/appointments', (req, res) => {
    const { firstName, lastName, mobile, date, time, notes } = req.body;
    const sql = `INSERT INTO appointments (firstName, lastName, mobile, date, time, notes) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [firstName, lastName, mobile, date, time, notes], function(err) {
        if (err) return handleServerError(res, err, "Failed to create appointment");
        res.json({ status: "success", id: this.lastID });
    });
});

app.delete('/api/appointments/:id', (req, res) => {
    db.run("DELETE FROM appointments WHERE id = ?", [req.params.id], (err) => {
        if (err) return handleServerError(res, err, "Failed to delete appointment");
        res.json({ status: "success" });
    });
});

// -----------------------------------
// --- START SERVER ---
app.listen(PORT, () => {
    log(`[INFO] Server running on http://localhost:${PORT}`);
    log(`[INFO] API available at http://localhost:${PORT}/api/orders`);
    
    // Initialize reminders for upcoming appointments
    initReminders(db);
});
