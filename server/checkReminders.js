import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { sendWhatsApp, timeToSlotIndex } from './whatsappBot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'jewelry_orders.db');
const db = new sqlite3.Database(dbPath);

if (process.env.MOCK_NOW) {
    const mockTime = parseInt(process.env.MOCK_NOW);
    Date.now = () => mockTime;
}

const log = (...args) => console.log(`[${new Date().toISOString()}] [CRON-REMINDER]`, ...args);
const logError = (...args) => console.error(`[${new Date().toISOString()}] [CRON-REMINDER]`, ...args);

// Time configuration helper
const WORK_START_HOUR = 11;
const SLOT_MINUTES = 30;

function slotIndexToTime(slotIndex) {
    if (slotIndex === null || slotIndex === undefined) return '';
    const totalMinutes = slotIndex * SLOT_MINUTES;
    const h = WORK_START_HOUR + Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function normalizeMobile(mobile) {
    let clean = (mobile || '').replace(/\D/g, '');
    if (clean.startsWith('0')) clean = clean.slice(1);
    if (clean.length === 10) clean = '91' + clean;
    return clean;
}

function formatDateDDMMYYYY(dateStr) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

async function checkDailyDigest(todayStr) {
    try {
        const kolkataHourStr = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            hour: 'numeric',
            hour12: false
        }).format(new Date(Date.now()));
        const currentHour = parseInt(kolkataHourStr, 10);

        log(`Evaluated current hour in Kolkata: ${currentHour}`);

        // Only send if it's the 8:00 AM hour (8:00 - 8:59)
        if (currentHour !== 8) {
            return;
        }

        const statePath = path.join(__dirname, 'data', 'digest_state.json');
        let state = { lastSentDate: "" };

        if (fs.existsSync(statePath)) {
            try {
                state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            } catch (parseErr) {
                logError("Failed to parse digest_state.json:", parseErr.message);
            }
        }

        if (state.lastSentDate === todayStr) {
            // Already sent today
            return;
        }

        log(`Current time is in 8 AM hour. Sending daily digest for ${todayStr}...`);

        // Query today's appointments
        const sql = `SELECT * FROM appointments WHERE date = ? ORDER BY time ASC`;
        const rows = await new Promise((resolve, reject) => {
            db.all(sql, [todayStr], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

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
        const targets = new Set();
        if (process.env.ADMIN_NUMBERS) {
            process.env.ADMIN_NUMBERS.split(',').forEach(num => {
                const trimmed = num.trim();
                if (trimmed) targets.add(trimmed);
            });
        }
        if (targets.size === 0) {
            targets.add('whatsapp:+917874847466');
        }

        for (const target of targets) {
            log(`Sending daily digest to admin: ${target}`);
            await sendWhatsApp(target, body);
        }

        // Save state
        state.lastSentDate = todayStr;
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        log(`Daily digest state saved for date ${todayStr}.`);

    } catch (digestErr) {
        logError("Error in daily digest execution:", digestErr.message);
    }
}

async function run() {
    log('Checking for daily digest and upcoming appointment reminders...');

    // 1. Get today's and tomorrow's date strings in Asia/Kolkata timezone
    const getKolkataDate = (offsetDays = 0) => {
        const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    };

    const todayStr = getKolkataDate(0);
    const tomorrowStr = getKolkataDate(1);

    // 2. Daily digest check
    await checkDailyDigest(todayStr);

    log(`Querying appointments for dates: ${todayStr}, ${tomorrowStr}`);

    // Query all appointments for today and tomorrow where reminder is not sent
    const sql = `
        SELECT * FROM appointments 
        WHERE date IN (?, ?) 
        AND (reminderSent IS NULL OR reminderSent = 0)
    `;

    db.all(sql, [todayStr, tomorrowStr], async (err, rows) => {
        if (err) {
            logError('Database query error:', err.message);
            process.exit(1);
        }

        log(`Found ${rows.length} pending appointments to check.`);

        const now = Date.now();

        for (const row of rows) {
            try {
                let slotIndex = row.slotIndex;
                if (slotIndex === null || slotIndex === undefined) {
                    slotIndex = timeToSlotIndex(row.time);
                }

                if (slotIndex === null || slotIndex === undefined) {
                    log(`Appointment ID ${row.id} has invalid time: "${row.time}". Skipping.`);
                    continue;
                }

                const slotStartMinutes = slotIndex * SLOT_MINUTES;
                const hour = WORK_START_HOUR + Math.floor(slotStartMinutes / 60);
                const minute = slotStartMinutes % 60;

                const hourStr = hour.toString().padStart(2, '0');
                const minStr = minute.toString().padStart(2, '0');

                // Parse appointment time forcing IST (+05:30) offset
                const appointmentTime = new Date(`${row.date}T${hourStr}:${minStr}:00+05:30`);
                const reminderTime = new Date(appointmentTime.getTime() - 10 * 60 * 1000); // 10 minutes before

                const reminderMs = reminderTime.getTime();

                // If reminder time has passed
                if (reminderMs <= now) {
                    // Check if the reminder is within 30 minutes (i.e. not too stale)
                    if (reminderMs >= now - 30 * 60 * 1000) {
                        log(`Sending reminder for Appointment ID ${row.id} (${row.firstName} at ${row.time})...`);
                        
                        const slotTimeDisplay = slotIndexToTime(slotIndex);
                        const cleanMobile = normalizeMobile(row.mobile);
                        const customerName = `${row.firstName} ${row.lastName || ''}`.trim();

                        const customerMsg =
                            `Hi ${customerName}, this is a reminder about your video appointment ` +
                            `at Deepa’s Customized Silver Jewellery. We’ll be connecting shortly.`;

                        const waLink = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(customerMsg)}`;

                        const body =
                            `⏰ *Video Call Reminder (10 mins)*\n\n` +
                            `👤 ${customerName}\n` +
                            `📞 ${row.mobile}\n` +
                            `🕒 ${slotTimeDisplay}\n` +
                            `💍 ${row.notes || '—'}\n\n` +
                            `👉 Message customer:\n${waLink}`;

                        // Determine who to notify
                        const targets = new Set();
                        if (row.creatorNumber) {
                            targets.add(row.creatorNumber);
                        }
                        if (process.env.ADMIN_NUMBERS) {
                            process.env.ADMIN_NUMBERS.split(',').forEach(num => {
                                const trimmed = num.trim();
                                if (trimmed) targets.add(trimmed);
                            });
                        }
                        // Default fallback admin number
                        if (targets.size === 0) {
                            targets.add('whatsapp:+917874847466');
                        }

                        // Send WhatsApp messages
                        for (const target of targets) {
                            await sendWhatsApp(target, body);
                        }

                        // Mark as sent (1)
                        await new Promise((resolve, reject) => {
                            db.run("UPDATE appointments SET reminderSent = 1 WHERE id = ?", [row.id], (updErr) => {
                                if (updErr) reject(updErr);
                                else resolve();
                            });
                        });
                        log(`Reminder sent and marked as complete for ID ${row.id}.`);
                    } else {
                        // Mark as expired/skipped (2) so we don't process it anymore
                        await new Promise((resolve, reject) => {
                            db.run("UPDATE appointments SET reminderSent = 2 WHERE id = ?", [row.id], (updErr) => {
                                if (updErr) reject(updErr);
                                else resolve();
                            });
                        });
                        log(`Appointment ID ${row.id} reminder expired. Marked as skipped.`);
                    }
                }
            } catch (itemErr) {
                logError(`Error processing Appointment ID ${row.id}:`, itemErr.message);
            }
        }

        db.close(() => {
            log('Finished checking reminders.');
            process.exit(0);
        });
    });
}

run().catch(err => {
    logError('Fatal cron execution error:', err.message);
    process.exit(1);
});
