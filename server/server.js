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
import { handleTwilioMessage } from "./whatsappBot.js" // Import Twilio Handler
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
    
    db.get("SELECT * FROM orders WHERE id = ?", [id], async (err, order) => {
        if (err) return handleServerError(res, err, "Database error");
        if (!order) return res.status(404).send("Order not found");

        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });

            // Set response headers
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=repair_invoice_R-${id}.pdf`);
            
            doc.pipe(res);

            // --- LOAD FONTS ---
            // Try to load Great Vibes for the logo, fallback to Times-Italic
            let cursiveFont = 'Times-Italic';
            try {
                const fontResp = await fetch('https://github.com/google/fonts/raw/main/ofl/greatvibes/GreatVibes-Regular.ttf');
                if (fontResp.ok) {
                    const fontBuffer = await fontResp.arrayBuffer();
                    doc.registerFont('GreatVibes', Buffer.from(fontBuffer));
                    cursiveFont = 'GreatVibes';
                }
            } catch (e) {
                console.warn("Could not load custom font, using fallback.");
            }

            // --- HEADER BACKGROUND ---
            // Full width black background rect for header
            // A4 width is ~595.28 points
            doc.rect(0, 0, 595.28, 140).fill('#4a4a4a');

            // --- HEADER CONTENT ---
            // Left Side: Address
            doc.fillColor('white');
            doc.fontSize(10).font('Helvetica-Bold').text('(M): 9227219475 || 9227219475', 50, 30);
            
            doc.fontSize(9).font('Helvetica').fillColor('#f9c74f')
               .text('4 & 5, Ground Flr. Titanium City Center Mall,', 50, 45)
               .text('Opp.Seema Hall, Near Sachin Tower,', 50, 58)
               .text('Shyamal Prahladnagar Road,', 50, 71)
               .text('Satellite, Ahmedabad - 380015.', 50, 84)
               .fillColor('white'); // Reset to white for GSTIN
            
            doc.text('GSTIN No.: 24AAFPS8301R1Z7', 50, 100);

            // Right Side: Logo
            // Using the custom font if loaded
            doc.fillColor('white');
            doc.fontSize(40).font(cursiveFont).text("Deepa's", 350, 30, { align: 'right', width: 195 });
            
            doc.fontSize(10).font('Helvetica').fillColor('#f9c74f')
               .text("customized silver jewellery", 350, 75, { align: 'right', width: 195 });
               
            doc.fontSize(8).fillColor('white').text("Appointment Preferable", 350, 88, { align: 'right', width: 195 });

            // Reset Fill Color for body
            doc.fillColor('black');

            // Title "REPAIR INVOICE"
            // Positioned below the dark header
            doc.fontSize(16).font('Helvetica-Bold').text('REPAIR INVOICE', 0, 160, { align: 'center', width: 595.28 });
            
            const currentY = 190;
            // Draw line below title
            doc.moveTo(50, currentY).lineTo(545, currentY).strokeColor('#cccccc').stroke();

            // --- CUSTOMER INFO ---
            const infoY = currentY + 15;
            const date = new Date().toISOString().split('T')[0].split('-').reverse().join('/');
            
            // Left Col
            doc.fontSize(10).font('Helvetica-Bold').text('Name:', 50, infoY);
            doc.font('Helvetica').text(`${order.firstName} ${order.lastName || ''}`, 100, infoY);
            
            doc.font('Helvetica-Bold').text('Address:', 50, infoY + 15);
            doc.font('Helvetica').text((order.address || '').substring(0, 40), 100, infoY + 15);
            
            doc.font('Helvetica-Bold').text('Mobile:', 50, infoY + 30);
            doc.font('Helvetica').text(order.mobile || '', 100, infoY + 30);

            // Right Col
            doc.font('Helvetica-Bold').text('ORIGINAL', 400, infoY);
            doc.text('Invoice No.:', 400, infoY + 15);
            doc.font('Helvetica').text(`R-${order.id}`, 470, infoY + 15);
            doc.font('Helvetica-Bold').text('Date:', 400, infoY + 30);
            doc.font('Helvetica').text(date, 470, infoY + 30);

            const tableTop = infoY + 55;
            // Draw line below info
            doc.moveTo(50, tableTop).lineTo(545, tableTop).strokeColor('#cccccc').stroke();

            // --- TABLE HEADER ---
            // Light grey background for table header
            doc.rect(50, tableTop, 495, 25).fill('#f0f0f0');
            doc.fillColor('black'); // Reset text color

            const thY = tableTop + 8; // Vertical centering approx
            doc.font('Helvetica-Bold').fontSize(10);
            const drawText = (text, x, y, width, align) => {
                 doc.text(text, x, y, { width: width, align: align });
            }
            
            drawText('Sr.', 50, thY, 30, 'center');
            drawText('Image', 90, thY, 120, 'center');
            drawText('Description', 220, thY, 220, 'left');
            drawText('Amount', 450, thY, 90, 'right');

            const rowTop = tableTop + 25;
            
            // --- TABLE ROW ---
            let rowY = rowTop + 15;
            
            const formatDisp = (val) => (val === -1) ? 'To Be Determined' : (val || 0).toLocaleString('en-IN');
            
            doc.font('Helvetica').fontSize(10);
            drawText('1', 50, rowY, 30, 'center');

            // Image Handling
            if (order.photoUrl) {
                try {
                    const imgResp = await fetch(order.photoUrl);
                    if (imgResp.ok) {
                        const imgBuffer = await imgResp.arrayBuffer();
                        // Draw Image boxed
                        doc.image(Buffer.from(imgBuffer), 100, rowY, { fit: [100, 100], align: 'center' });
                    }
                } catch (e) {
                    console.error("Failed to load invoice image:", e);
                    drawText('[Image Error]', 90, rowY, 120, 'center');
                }
            } else {
                 drawText('[No Image]', 90, rowY, 120, 'center');
            }

            doc.text(order.notes || (order.type === 'Repair' ? 'Repair Work' : 'Jewelry Item'), 220, rowY, { width: 220 });
            doc.text(formatDisp(order.totalAmount), 450, rowY, { width: 90, align: 'right' });

            // Row Bottom
            const rowHeight = 120; 
            const totalRowY = rowY + rowHeight;
            doc.moveTo(50, totalRowY).lineTo(545, totalRowY).strokeColor('#cccccc').stroke();

            // --- TOTAL ROW ---
            // Light grey background for total
            doc.rect(50, totalRowY, 495, 25).fill('#f9f9f9');
            doc.fillColor('black');

            const trY = totalRowY + 8;
            doc.font('Helvetica-Bold');
            doc.text('Repair Amount', 300, trY, { width: 140, align: 'right' });
            doc.text(formatDisp(order.totalAmount), 450, trY, { width: 90, align: 'right' });

            const footerTop = totalRowY + 35; // Leave some space

            // --- FOOTER ---
            const footerY = footerTop + 15;
            
            // Left: Terms
            doc.fontSize(8).font('Helvetica-Bold').text('Terms & Conditions', 50, footerY);
            doc.font('Helvetica').fontSize(7)
               .list([
                   'Goods once sold will not be taken back.',
                   'Show Room Time: 11 am to 8 pm.',
                   'Appointment Preferable due to Exhibition.',
                   'Subject to Ahmedabad Jurisdiction.'
               ], 50, footerY + 15, { bulletRadius: 1 });
            
            // Bank Details
            const bankY = footerY + 70;
            // Dot dashed line
            doc.lineWidth(1).dash(2, { space: 2 }).moveTo(50, bankY).lineTo(250, bankY).stroke();
            doc.undash();
            
            doc.font('Helvetica-Bold').fontSize(8).text('Bank Details', 50, bankY + 10);
            doc.font('Helvetica').fontSize(7)
               .text('HDFC BANK - VASNA, AHMEDABAD', 50, bankY + 22)
               .text('A/C No. 50200013555481 | IFSC: HDFC0001229', 50, bankY + 32);

            // Right: Breakdown
            doc.font('Helvetica').fontSize(10);
            const breakdownY = footerY;
            
            const drawBreakdownRow = (label, value, y, isBold = false) => {
                if(isBold) doc.font('Helvetica-Bold'); else doc.font('Helvetica');
                doc.text(label, 350, y, { width: 100, align: 'left' });
                doc.text(value, 450, y, { width: 90, align: 'right' });
            };

            drawBreakdownRow('Repair Amount', formatDisp(order.totalAmount), breakdownY, true);
            // Line under gross
            doc.moveTo(350, breakdownY + 12).lineTo(540, breakdownY + 12).stroke();
            
            drawBreakdownRow('Advance', formatDisp(order.advancePaid), breakdownY + 20);
            drawBreakdownRow('Balance', formatDisp(order.remainingAmount), breakdownY + 35, true);

            // Footer Note
            doc.fontSize(8).font('Helvetica-Oblique').text('This is an Electronically Generated Invoice.', 50, 750, { align: 'center', width: 500 });
            doc.moveTo(50, 740).lineTo(545, 740).strokeColor('#cccccc').stroke();

            doc.end();

        } catch (pdfErr) {
            console.error("[PDFKIT ERROR]", pdfErr);
            if (!res.headersSent) handleServerError(res, pdfErr, "Failed to generate PDF");
        }
    });
});
// -----------------------------------
// --- START SERVER ---
app.listen(PORT, () => {
    log(`[INFO] Server running on http://localhost:${PORT}`);
    log(`[INFO] API available at http://localhost:${PORT}/api/orders`);
});
