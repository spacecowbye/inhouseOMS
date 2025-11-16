import express from "express"
import sqlite3 from "sqlite3"
import cors from "cors"
import process from "process"

const sqlite = sqlite3.verbose();

const app = express();
const PORT = 3001;

// --- CONFIGURATION & MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- GLOBAL ERROR HANDLER ---
const handleServerError = (res, error, message = "Internal Server Error") => {
    console.error(`[ERROR] ${message}:`, error.message);
    res.status(500).json({ status: "error", message: message, details: error.message });
};

// --- DATABASE INITIALIZATION ---
const db = new sqlite.Database('./jewelry_orders.db', (err) => {
    if (err) {
        console.error("[FATAL] Error opening database:", err.message);
        process.exit(1); 
    } else {
        console.log('[INFO] Database connected: jewelry_orders.db');
        // Ensure the table includes the 'notes' column
        db.run(`
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                firstName TEXT,
                lastName TEXT,
                address TEXT,
                mobile TEXT,
                advancePaid INTEGER,
                remainingAmount INTEGER,
                totalAmount INTEGER,
                orderReceivedDate TEXT,
                sentToWorkshopDate TEXT,
                returnedFromWorkshopDate TEXT,
                collectedByCustomerDate TEXT,
                type TEXT,
                trackingNumber TEXT,
                shippingDate TEXT,
                photoUrl TEXT,
                karigarName TEXT,
                repairCourierCharges INTEGER,
                notes TEXT  
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

// --- API Endpoints ---

// 1. GET all orders (Returns ALL rows with global stats)
app.get('/api/orders', (req, res) => {
    // Sanitize and define query parameters (only sorting remains)
    const sortBy = req.query.sortBy || 'orderReceivedDate'; 
    const sortDirection = (req.query.sortDirection || 'desc').toUpperCase();

    // Input validation for sorting
    const validSortColumns = [
        'id', 'firstName', 'lastName', 'advancePaid', 'totalAmount', 
        'orderReceivedDate', 'sentToWorkshopDate', 'returnedFromWorkshopDate', 'type'
    ];
    if (!validSortColumns.includes(sortBy)) {
        return res.status(400).json({ 
            status: "error", 
            message: `Invalid sortBy column: ${sortBy}` 
        });
    }

    // SQL to fetch global statistics
    const statsSql = `
        SELECT 
            COUNT(CASE WHEN collectedByCustomerDate IS NOT NULL THEN 1 END) AS delivered,
            COUNT(CASE WHEN collectedByCustomerDate IS NULL THEN 1 END) AS total,
            COUNT(CASE WHEN collectedByCustomerDate IS NULL AND returnedFromWorkshopDate IS NOT NULL THEN 1 END) AS ready,
            COUNT(CASE WHEN collectedByCustomerDate IS NULL AND returnedFromWorkshopDate IS NULL AND sentToWorkshopDate IS NOT NULL THEN 1 END) AS inWorkshop,
            COUNT(CASE WHEN collectedByCustomerDate IS NULL AND returnedFromWorkshopDate IS NULL AND sentToWorkshopDate IS NULL THEN 1 END) AS received
        FROM orders
    `;

    // 1. Get global stats
    db.get(statsSql, [], (err, statsRow) => {
        if (err) {
            return handleServerError(res, err, "Failed to calculate global statistics");
        }
        
        // Data SQL: Fetch ALL rows, applying only sorting
        const dataSql = `
            SELECT * FROM orders 
            ORDER BY ${sortBy} ${sortDirection}
        `;

        // 2. Get all data
        db.all(dataSql, [], (err, rows) => { 
            if (err) {
                return handleServerError(res, err, "Failed to fetch all orders");
            }
            
            console.log(`[INFO] Fetched ${rows.length} total orders.`);
            res.json({
                status: "success",
                data: rows,
                stats: {
                    total: statsRow.total,
                    received: statsRow.received,
                    inWorkshop: statsRow.inWorkshop,
                    ready: statsRow.ready,
                    delivered: statsRow.delivered,
                },
                // Pagination object is intentionally omitted
            });
        });
    });
});

// 2. POST a new order (Improved Error Handling)
app.post('/api/orders', (req, res) => {
    const order = req.body;
    
    if (!order.firstName || !order.totalAmount || !order.orderReceivedDate) {
        console.error("[ERROR] Missing required fields in POST body.");
        return res.status(400).json({ status: "error", message: "Missing required fields (firstName, totalAmount, orderReceivedDate)." });
    }

    // Ensure values are in the correct order for the table schema
    const allColumns = [
        'firstName', 'lastName', 'address', 'mobile', 'advancePaid', 'remainingAmount', 
        'totalAmount', 'orderReceivedDate', 'sentToWorkshopDate', 'returnedFromWorkshopDate', 
        'collectedByCustomerDate', 'type', 'trackingNumber', 'shippingDate', 'photoUrl', 
        'karigarName', 'repairCourierCharges', 'notes' 
    ];
    
    // Construct keys, placeholders, and values based on the schema and input
    const keys = [];
    const placeholders = [];
    const values = [];

    allColumns.forEach(col => {
        // Check for presence in the incoming order data
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