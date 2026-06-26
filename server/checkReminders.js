import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { sendWhatsApp } from './whatsappBot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'jewelry_orders.db');
const db = new sqlite3.Database(dbPath);

const log = (...args) => console.log(`[${new Date().toISOString()}] [DAILY-DIGEST]`, ...args);
const logError = (...args) => console.error(`[${new Date().toISOString()}] [DAILY-DIGEST]`, ...args);

function formatDateDDMMYYYY(dateStr) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

function getAdminNumbers() {
    const raw = process.env.ADMIN_NUMBERS;
    if (!raw) return ['whatsapp:+917874847466'];
    
    let numbers = [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            numbers = parsed;
        } else {
            numbers = [raw];
        }
    } catch (e) {
        numbers = raw.split(',').map(num => num.trim()).filter(Boolean);
    }

    return numbers.map(num => num.startsWith('whatsapp:') ? num : `whatsapp:${num}`);
}

async function run() {
    log("Running daily digest script...");
    
    // Get today's date in Asia/Kolkata timezone
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    log(`Today's date (IST): ${todayStr}`);

    // Query today's appointments
    const sql = `SELECT * FROM appointments WHERE date = ? ORDER BY time ASC`;
    
    db.all(sql, [todayStr], async (err, rows) => {
        if (err) {
            logError("Database query error:", err.message);
            process.exit(1);
        }

        const displayDate = formatDateDDMMYYYY(todayStr);
        let body = `☀️ *Today's Video Call Appointments*\n📅 Date: *${displayDate}*\n`;
        
        if (rows.length > 0) {
            body += `Total Scheduled: *${rows.length}*\n\n`;
            rows.forEach((row, index) => {
                const customerName = `${row.firstName} ${row.lastName || ''}`.trim();
                body += `${index + 1}️⃣ *${customerName}*\n`;
                body += `🕒 Time: *${row.time}*\n`;
                body += `📞 Mobile: ${row.mobile}\n`;
                body += `💍 Notes: ${row.notes || '—'}\n\n`;
            });
        } else {
            body += `\nNo video call appointments scheduled for today! Have a wonderful day ahead! 🌸`;
        }

        // Send to admin numbers
        const targets = getAdminNumbers();
        for (const target of targets) {
            log(`Sending daily digest to admin: ${target}`);
            await sendWhatsApp(target, body);
        }

        db.close(() => {
            log('Finished sending daily digest.');
            process.exit(0);
        });
    });
}

run().catch(err => {
    logError('Fatal daily digest execution error:', err.message);
    process.exit(1);
});
