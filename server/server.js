import express from "express"
import sqlite3 from "sqlite3"
import cors from "cors"
import process from "process"
import path, { dirname } from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { S3Client } from '@aws-sdk/client-s3'; 
import multer from 'multer';
import multerS3 from 'multer-s3';

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
    const authHeader = req.headers.authorization;

    // Log the expected user/pass from environment variables (for server-side validation)
    console.log('\n======================================');
    console.log('[AUTH] Expected USER:', AUTH_USER);
    console.log('[AUTH] Expected PASS:', AUTH_PASS);
    console.log('--------------------------------------');
    
    // Log the header received
    console.log('[AUTH] Received Auth Header:', authHeader ? authHeader.substring(0, 30) + '...' : 'NONE');

    if (!authHeader) {
        console.log('[AUTH] ❌ No auth header present. Returning 401.');
        return res.status(401).json({ status: "error", message: "Authentication required by client." });
    }

    const [type, credentials] = authHeader.split(' ');
    
    if (type !== 'Basic' || !credentials) {
        console.log('[AUTH] ❌ Invalid auth scheme. Returning 401.');
        return res.status(401).json({ status: "error", message: "Invalid authentication scheme." });
    }

    // Decode the credentials
    let decoded;
    try {
        decoded = Buffer.from(credentials, 'base64').toString();
    } catch (e) {
        console.log('[AUTH] ❌ Invalid token encoding. Returning 401.');
        return res.status(401).json({ status: "error", message: "Invalid token encoding." });
    }
    
    const [user, pass] = decoded.split(':');
    
    console.log('[AUTH] Decoded Request USER:', user);
    console.log('[AUTH] Decoded Request PASS:', pass);

    // Check credentials
    if (user === AUTH_USER && pass === AUTH_PASS) {
        console.log('[AUTH] ✅ Authentication successful. Proceeding.');
        return next();
    } else {
        console.log('[AUTH] ❌ Invalid credentials. Returning 401.');
        // This rejection handles the case where the user entered the wrong info.
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


// --- AWS CONFIGURATION (omitted for brevity) ---
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.S3_BUCKET_NAME,
        acl: "public-read",
        contentType: multerS3.AUTO_CONTENT_TYPE,   
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            const safeName = file.originalname
                .normalize("NFKD")
                .replace(/[^\w.\-]+/g, "_");

            const filename = `orders/${Date.now()}-${safeName}`;
            cb(null, filename);
        }
    })
});


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

// --- DATABASE INITIALIZATION (omitted for brevity) ---
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

// --- NEW ENDPOINT: IMAGE UPLOAD ---
app.post('/api/orders/upload-photo', upload.single('photo'), (req, res) => {
    // Check if the S3 upload was successful
    if (!req.file || !req.file.location) {
        if (!process.env.AWS_REGION || !process.env.S3_BUCKET_NAME) {
            console.error("[ERROR] AWS environment variables are missing.");
            return res.status(500).json({ status: "error", message: "Server configuration error: AWS credentials missing." });
        }
        return res.status(400).json({ status: "error", message: "File upload failed or no file provided." });
    }
    
    const publicUrl = req.file.location;

    console.log(`[INFO] Image uploaded to S3: ${publicUrl}`);
    
    res.json({
        status: "success",
        photoUrl: publicUrl
    });
});
// --- END IMAGE UPLOAD ENDPOINT ---


// 1. GET all orders (Returns ALL rows with global stats)
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

// 2. POST a new order
app.post('/api/orders', (req, res) => {
    const order = req.body;
    
    if (!order.firstName || !order.totalAmount || !order.orderReceivedDate) {
        console.error("[ERROR] Missing required fields in POST body.");
        return res.status(400).json({ status: "error", message: "Missing required fields (firstName, totalAmount, orderReceivedDate)." });
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

// 3. PUT (Update) an order
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

// 4. DELETE an order
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

// Start server
app.listen(PORT, () => {
    console.log(`[INFO] Server running on http://localhost:${PORT}`);
    console.log(`[INFO] API available at http://localhost:${PORT}/api/orders`);
});