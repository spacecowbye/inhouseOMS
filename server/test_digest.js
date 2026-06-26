import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read configurations from workspace root .env manually to avoid dotenv dependency
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const parts = trimmed.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            let val = parts.slice(1).join('=').trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            process.env[key] = val;
        }
    });
}

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'jewelry_orders.db');
const db = new sqlite3.Database(dbPath);

console.log(`Using Database at: ${dbPath}`);

const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

async function runTest() {
    console.log('--- STARTING DAILY DIGEST TEST SCRIPT ---');
    console.log(`Current Date in Asia/Kolkata timezone: ${todayStr}`);

    // 1. Insert dummy appointment for today
    console.log('Inserting mock appointment for today...');
    const insertSql = `
        INSERT INTO appointments (firstName, lastName, mobile, date, time, slotIndex, creatorNumber, notes)
        VALUES ('TEST_CUSTOMER_FN', 'TEST_CUSTOMER_LN', '9999999999', ?, '12:30', 3, 'whatsapp:+917874847466', 'Testing Daily Digest Flow')
    `;

    const rowId = await new Promise((resolve, reject) => {
        db.run(insertSql, [todayStr], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });

    console.log(`Mock appointment inserted with ID: ${rowId}`);

    // 2. Execute server/checkReminders.js
    console.log('Executing daily digest script server/checkReminders.js...');
    try {
        const output = execSync('node server/checkReminders.js', {
            cwd: path.join(__dirname, '..'),
            env: process.env,
            encoding: 'utf-8'
        });
        console.log('--- checkReminders.js Output ---');
        console.log(output);
        console.log('--------------------------------');
    } catch (execErr) {
        console.error('❌ Failed to run daily digest script:', execErr.message);
        if (execErr.stdout) console.log('Stdout:', execErr.stdout);
        if (execErr.stderr) console.error('Stderr:', execErr.stderr);
    }

    // 3. Delete mock appointment
    console.log('Cleaning up mock appointment...');
    await new Promise((resolve, reject) => {
        db.run("DELETE FROM appointments WHERE id = ?", [rowId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    console.log('Cleanup completed successfully.');
    console.log('--- TEST COMPLETED ---');
    db.close();
}

runTest().catch(err => {
    console.error('Test script failed:', err);
    db.close();
    process.exit(1);
});
