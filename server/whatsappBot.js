import { PutObjectCommand } from '@aws-sdk/client-s3';
import twilio from 'twilio';
import { generateInvoiceBuffer } from './invoiceGenerator.js';

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER || 'whatsapp:+14155238886';

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
const logError = (...args) => console.error(`[${new Date().toISOString()}]`, ...args);

// ---- SLOT CONFIG ----
const WORK_START_HOUR = 11;
const WORK_END_HOUR = 20; // 8 PM
const SLOT_MINUTES = 30;

// Store active reminder timers in memory
const reminderTimers = new Map();

// Normalize Indian mobile
function normalizeMobile(mobile) {
    let clean = mobile.replace(/\D/g, '');
    if (clean.startsWith('0')) clean = clean.slice(1);
    if (clean.length === 10) clean = '91' + clean;
    return clean;
}

/**
 * Sends a clean, escaped TwiML response to Twilio.
 */
function sendTwiML(res, body, mediaUrl = null) {
    const twiml = new twilio.twiml.MessagingResponse();
    const message = twiml.message();
    message.body(body.trim());
    if (mediaUrl) {
        message.media(mediaUrl);
    }
    res.set('Content-Type', 'text/xml');
    return res.send(twiml.toString());
}

// Convert time string → slotIndex (24-hour format: HH:MM)
function timeToSlotIndex(timeStr) {
    const match = timeStr.match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (!match) return null;
    
    let hour = parseInt(match[1]);
    const min = parseInt(match[2] || '0');

    if (hour < WORK_START_HOUR || hour >= WORK_END_HOUR) return null;
    return ((hour - WORK_START_HOUR) * 2) + (min >= 30 ? 1 : 0);
}

// Convert slotIndex → HH:MM (24-hour)
function slotIndexToTime(slotIndex) {
    if (slotIndex === null || slotIndex === undefined) return '';
    const totalMinutes = slotIndex * SLOT_MINUTES;
    const h = WORK_START_HOUR + Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function slotIndexToTimeRange(slotIndex) {
    if (slotIndex === null || slotIndex === undefined) return '';
    const totalMinutes = slotIndex * SLOT_MINUTES;
    const startHour = WORK_START_HOUR + Math.floor(totalMinutes / 60);
    const startMin = totalMinutes % 60;

    const endTotalMinutes = totalMinutes + SLOT_MINUTES;
    const endHour = WORK_START_HOUR + Math.floor(endTotalMinutes / 60);
    const endMin = endTotalMinutes % 60;

    const fmt = (h, m) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

    return `${fmt(startHour, startMin)} - ${fmt(endHour, endMin)}`;
}

export const sendWhatsApp = async (to, body, mediaUrl = null) => {
    try {
        const payload = {
            from: TWILIO_FROM,
            to: to,
            body: body
        };
        if (mediaUrl) payload.mediaUrl = [mediaUrl];

        await twilioClient.messages.create(payload);
        log(`[OUTBOUND] Msg sent to ${to}${mediaUrl ? ' (with media)' : ''}`);
    } catch (err) {
        logError(`[OUTBOUND] Error sending to ${to}:`, err.message);
    }
};

function scheduleReminder({
    appointmentId,
    appointmentDate,
    slotIndex,
    customerName,
    customerMobile,
    notes,
    notifyNumbers
}) {
    if (slotIndex === null || slotIndex === undefined) return;
    
    const slotStartMinutes = slotIndex * SLOT_MINUTES;
    const hour = WORK_START_HOUR + Math.floor(slotStartMinutes / 60);
    const minute = slotStartMinutes % 60;

    const hourStr = hour.toString().padStart(2, '0');
    const minStr = minute.toString().padStart(2, '0');
    
    // Force IST (+05:30) regardless of server local time
    const appointmentTime = new Date(`${appointmentDate}T${hourStr}:${minStr}:00+05:30`);
    const reminderTime = new Date(appointmentTime.getTime() - 10 * 60 * 1000); // 10 mins before

    const delay = reminderTime.getTime() - Date.now();

    // Cancel existing if any
    if (reminderTimers.has(appointmentId)) {
        clearTimeout(reminderTimers.get(appointmentId));
    }

    if (delay < - (30 * 60 * 1000)) {
        log(`[REMINDER] Appointment ID ${appointmentId} is too far in the past. Skipping.`);
        return;
    }

    const timer = setTimeout(() => {
        const slotTimeDisplay = slotIndexToTime(slotIndex);
        const cleanMobile = normalizeMobile(customerMobile);

        const customerMsg =
            `Hi ${customerName}, this is a reminder about your video appointment ` +
            `at Deepa’s Customized Silver Jewellery. We’ll be connecting shortly.`;

        const waLink = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(customerMsg)}`;

        const body =
            `⏰ *Video Call Reminder (10 mins)*\n\n` +
            `👤 ${customerName}\n` +
            `📞 ${customerMobile}\n` +
            `🕒 ${slotTimeDisplay}\n` +
            `💍 ${notes || '—'}\n\n` +
            `👉 Message customer:\n${waLink}`;

        notifyNumbers.forEach(num => {
            sendWhatsApp(num, body);
        });

        reminderTimers.delete(appointmentId);
        log('[REMINDER] Sent for appointment', appointmentId);
    }, Math.max(delay, 0));

    reminderTimers.set(appointmentId, timer);
    log(`[REMINDER] Scheduled for ID ${appointmentId} in ${Math.round(Math.max(delay, 0) / 1000 / 60)} mins`);
}

export const initReminders = (db) => {
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrow);

    log('[REMINDER] Initializing reminders from DB...');
    db.all("SELECT * FROM appointments WHERE date IN (?, ?) AND slotIndex IS NOT NULL", [todayStr, tomorrowStr], (err, rows) => {
        if (err) return logError('[REMINDER] DB Error:', err);
        rows.forEach(row => {
            if (row.creatorNumber) {
                scheduleReminder({
                    appointmentId: row.id,
                    appointmentDate: row.date,
                    slotIndex: row.slotIndex,
                    customerName: `${row.firstName} ${row.lastName}`,
                    customerMobile: row.mobile,
                    notes: row.notes,
                    notifyNumbers: [row.creatorNumber]
                });
            }
        });
    });
};

// Helper to download media
async function downloadMedia(url) {
    log(`[TWILIO] Downloading media from: ${url}`);
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Node.js)'
        }
    });
    if (!response.ok) throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type');
    
    // Default to jpeg if indeterminate, but rely on header
    if (!contentType) log('[TWILIO] Warning: No content-type header from media URL');
    
    return { buffer, contentType: contentType || 'image/jpeg' };
}

async function createAndUploadInvoice(order, s3, bucket, region) {
    try {
        const buffer = await generateInvoiceBuffer(order);
        const ts = Date.now();
        const state = order.collectedByCustomerDate ? 'DELIVERED' : 'DRAFT';
        const filename = `invoices/inv_${order.id}_${state}_${ts}.pdf`;
        
        await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: filename,
            Body: buffer,
            ACL: "public-read",
            ContentType: "application/pdf",
            // Force download and prevent caching
            CacheControl: "no-cache, no-store, must-revalidate",
            ContentDisposition: `inline; filename="invoice_${order.id}.pdf"`
        }));
        
        return `https://${bucket}.s3.${region}.amazonaws.com/${filename}`;
    } catch (err) {
        logError('[PDF-S3] Failed to generate/upload:', err);
        return null;
    }
}

export const handleTwilioMessage = async (req, res, db, s3, bucket, region) => {
    try {
        const { Body, From, MediaUrl0 } = req.body;
        if (!Body) return res.status(200).send('<Response></Response>');

        log(`[TWILIO] Msg from ${From}: ${Body}`);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        const text = Body.trim();
        const lowerText = text.toLowerCase();
        
        // --- HELP HANDLERS ---
        const fullHelp = `🤖 *Deepa's Jewelry Bot - All Commands*\n\n` +
                         `🛠 *REPAIR:* \`/repair Name, Mobile, Address, Total, Advance, Karigar, Notes\`\n` +
                         `📝 *ORDER:* \`/order Name, Mobile, Address, Total, Advance, Notes\`\n` +
                         `🚚 *DELIVERY:* \`/delivery Name, Mobile, Address, Total, Advance, AWB, Notes\`\n` +
                         `✅ *COLLECTED:* \`/rc ID\` (Mark Collected + Stamped Invoice)\n` +
                         `📄 *INVOICE:* \`/generate ID\` (Normal PDF)\n` +
                         `📹 *APPT (Today):* \`/a Name, Mobile, Time, Notes, Date\`\n` +
                         `📹 *APPT (Tmrw):* \`/at Name, Mobile, Time, Notes\`\n` +
                         `📅 *SLOTS:* \`/slots\` or \`/slots tomorrow\`\n` +
                         `🗑 *CLEAR SLOT:* \`/reschedule Time\`\n\n` +
                         `⚠️ *IMPORTANT:* Separate details with a COMMA ( , ) for /repair, /delivery, /order, and /a.`;

        // --- HELP HANDLERS ---
        if (lowerText.startsWith('/help')) {
            const sepInfo = "⚠️ *IMPORTANT:* Separate each detail with a COMMA ( , )";

            if (lowerText.includes('repair')) {
                const repairHelp = `🛠 *REPAIR Order Format*\n${sepInfo}\n\n` +
                          `*Command:*\n/repair Name, Mobile, Address, Total, Advance, Karigar, Notes\n\n` +
                          `*Example:*\n/repair Deepa Ben, 9925042620, Ahmedabad, 5000, 1000, Anil, Resize Ring`;
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>${repairHelp}</Message></Response>`);
            } else if (lowerText.includes('delivery')) {
                const deliveryHelp = `🚚 *DELIVERY Order Format*\n${sepInfo}\n\n` +
                          `*Command:*\n/delivery Name, Mobile, Address, Total, Advance, AWB, Notes\n\n` +
                          `*Example:*\n/delivery Priya, 9876543210, 56 Park Ave, 20000, 20000, TRACK123, Ship urgent`;
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>${deliveryHelp}</Message></Response>`);
            } else if (lowerText.includes('appointment')) {
                const apptHelp = `📹 *VIDEO CALL Appointment*\n${sepInfo}\n\n` +
                          `*Command:*\n/a Name, Mobile, Time, Notes, Date\n\n` +
                          `*Format:* Date (DD-MM) is optional. Time is HH:MM (24-hour).\n\n` +
                          `*Example:*\n/a Rahul, 9876543210, 11:30, Show Rings, 18-01`;
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>${apptHelp}</Message></Response>`);
            } else {
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>${fullHelp}</Message></Response>`);
            }
        }

        // --- SLOTS AVAILABILITY COMMAND ---
        if (lowerText.startsWith('/slots')) {
            const parts = text.split(/\s+/);
            const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
            let targetDate = todayDate;
            let dayLabel = "Today";

            if (parts[1] && parts[1].toLowerCase() === 'tomorrow') {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                targetDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrow);
                dayLabel = "Tomorrow";
            }

            db.all("SELECT slotIndex, firstName, mobile FROM appointments WHERE date = ?", [targetDate], (err, rows) => {
                if (err) {
                    logError('[TWILIO] DB Error:', err);
                    res.set('Content-Type', 'text/xml');
                    return res.send('<Response><Message>❌ Database Error</Message></Response>');
                }

                const bookedSlots = {};
                rows.forEach(r => bookedSlots[r.slotIndex] = r);

                let freeItems = [];
                let bookedItems = [];

                for (let i = 0; i < 18; i++) {
                    const timeRange = slotIndexToTimeRange(i);
                    const booking = bookedSlots[i];
                    if (booking) {
                        bookedItems.push(`• ${timeRange}: ✅ ${booking.firstName} (${booking.mobile})`);
                    } else {
                        freeItems.push(`• ${timeRange}`);
                    }
                }

                let msg = `📅 *Slots for ${dayLabel} (${targetDate})*\n\n`;
                
                msg += `🆓 *FREE SLOTS*\n`;
                msg += freeItems.length > 0 ? freeItems.join('\n') : "_None_";
                msg += `\n\n`;
                
                msg += `✅ *BOOKED SLOTS*\n`;
                msg += bookedItems.length > 0 ? bookedItems.join('\n') : "_None_";

                res.set('Content-Type', 'text/xml');
                res.send(`<Response><Message>${msg}</Message></Response>`);
            });
            return;
        }
        
        // --- RESCHEDULE / CLEAR COMMAND ---
        if (lowerText.startsWith('/reschedule')) {
            const parts = text.split(/\s+/);
            const rawTime = parts.slice(1).join(' ').toLowerCase();
            
            if (!rawTime) {
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>❌ Please specify a time.\nExample: */reschedule 11:30*</Message></Response>`);
            }

            let targetDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
            let cleanTime = rawTime;
            let dayLabel = "Today";

            if (rawTime.includes('tomorrow')) {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                targetDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrow);
                cleanTime = rawTime.replace('tomorrow', '').trim();
                dayLabel = "Tomorrow";
            }

            const slotIdx = timeToSlotIndex(cleanTime);
            if (slotIdx === null) {
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>❌ Invalid time or out of bounds (11 AM - 8 PM).</Message></Response>`);
            }

            // Find the ID first to clear memory timer
            db.get("SELECT id FROM appointments WHERE date = ? AND slotIndex = ?", [targetDate, slotIdx], (err, row) => {
                if (err) return res.status(500).send('<Response><Message>❌ DB Error</Message></Response>');
                
                if (row) {
                    if (reminderTimers.has(row.id)) {
                        clearTimeout(reminderTimers.get(row.id));
                        reminderTimers.delete(row.id);
                    }
                }

                db.run("DELETE FROM appointments WHERE date = ? AND slotIndex = ?", [targetDate, slotIdx], function(err) {
                    if (err) {
                        res.set('Content-Type', 'text/xml');
                        return res.send('<Response><Message>❌ Database Error</Message></Response>');
                    }
                    if (this.changes === 0) {
                        res.set('Content-Type', 'text/xml');
                        return res.send(`<Response><Message>ℹ️ No booking found at ${slotIndexToTimeRange(slotIdx)} for ${dayLabel}.</Message></Response>`);
                    }

                    res.set('Content-Type', 'text/xml');
                    res.send(`<Response><Message>🗑️ Slot ${slotIndexToTimeRange(slotIdx)} for ${dayLabel} is now *Free* and available to book.</Message></Response>`);
                });
            });
            return;
        }

        // --- REPAIR COLLECTED COMMAND ---
        if (lowerText.startsWith('/rc')) {
            const parts = text.split(/\s+/);
            const orderId = parts[1];

            if (!orderId) {
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>❌ Please provide an Order ID.\nExample: */rc 123*</Message></Response>`);
            }

            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
            log(`[TWILIO] Processing /rc ${orderId} on ${today}`);

            // 1. Update the order status to Delivered
            db.run("UPDATE orders SET collectedByCustomerDate = ? WHERE id = ?", [today, orderId], function(err) {
                if (err) {
                    logError('[TWILIO] DB Update Error:', err);
                    res.set('Content-Type', 'text/xml');
                    return res.send('<Response><Message>❌ Database Update Error</Message></Response>');
                }

                if (this.changes === 0) {
                    logError(`[TWILIO] /rc ${orderId} failed: No rows changed.`);
                    res.set('Content-Type', 'text/xml');
                    return res.send(`<Response><Message>❌ Order #${orderId} not found.</Message></Response>`);
                }

                log(`[TWILIO] /rc ${orderId} success: Fetching details and generating S3 PDF...`);
                // 2. Fetch order details to generate response
                db.get("SELECT * FROM orders WHERE id = ?", [orderId], async (err, row) => {
                    if (err || !row) {
                        logError('[TWILIO] DB Fetch Error after /rc:', err);
                        res.set('Content-Type', 'text/xml');
                        return res.send(`<Response><Message>✅ Order #${orderId} marked as Collected, but failed to fetch details for confirmation.</Message></Response>`);
                    }

                    // GENERATE AND UPLOAD S3 PDF
                    const s3Url = await createAndUploadInvoice(row, s3, bucket, region);
                    const invoiceUrl = s3Url || `http://deepasoms.duckdns.org/api/orders/${orderId}/invoice?t=${Date.now()}`;
                    
                    let waLink = "No mobile number";
                    if (row.mobile) {
                        const cleanMobile = normalizeMobile(row.mobile);
                        const customerMsg = `Hi ${row.firstName}, your repair is ready and collected! Here is your PAID & DELIVERED invoice: ${invoiceUrl}`;
                        waLink = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(customerMsg)}`;
                    }

                    const bodyText = `📦 *Repair Collected & Paid*\n\n` +
                                     `👤 ${row.firstName} ${row.lastName}\n` +
                                     `✅ Status: Delivered (Today)\n\n` +
                                     `👉 *Chat with Customer:*\n${waLink}\n\n` +
                                     `🔗 *Invoice PDF (S3 Stamped):*\n${invoiceUrl}`;

                    log(`[TWILIO] Sending /rc success reply for ID ${orderId} with Media: ${invoiceUrl}`);
                    return sendTwiML(res, bodyText, invoiceUrl);
                });
            });
            return;
        }

        // --- GENERATE INVOICE COMMAND ---
        if (lowerText.startsWith('/generate')) {
            const parts = text.split(/\s+/);
            const orderId = parts[1];

            if (!orderId) {
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>❌ Please provide an Order ID.\nExample: */generate 123*</Message></Response>`);
            }

            db.get("SELECT * FROM orders WHERE id = ?", [orderId], async (err, row) => {
                if (err || !row) {
                    res.set('Content-Type', 'text/xml');
                    return res.send(`<Response><Message>❌ Order #${orderId} not found.</Message></Response>`);
                }

                const s3Url = await createAndUploadInvoice(row, s3, bucket, region);
                const invoiceUrl = s3Url || `http://deepasoms.duckdns.org/api/orders/${orderId}/invoice?t=${Date.now()}`;
                
                let waLink = "No mobile number";
                if (row.mobile) {
                    const cleanMobile = normalizeMobile(row.mobile);
                    const customerMsg = `Hi ${row.firstName}, here is your invoice: ${invoiceUrl}`;
                    waLink = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(customerMsg)}`;
                }

                const bodyText = `📄 *Invoice Generated*\n\n` +
                                 `👤 ${row.firstName} ${row.lastName}\n\n` +
                                 `👉 *Chat with Customer:*\n${waLink}\n\n` +
                                 `🔗 *Download PDF (S3):*\n${invoiceUrl}`;

                log(`[TWILIO] Sending /generate success reply for ID ${orderId} with Media: ${invoiceUrl}`);
                return sendTwiML(res, bodyText, invoiceUrl);
            });
            return;
        }

        // --- COMMAND PARSING ---
        let commandType = null;
        if (lowerText.startsWith('/order')) commandType = 'Order';
        else if (lowerText.startsWith('/repair')) commandType = 'Repair';
        else if (lowerText.startsWith('/delivery')) commandType = 'Delivery';
        else if (lowerText.startsWith('/at ') || lowerText === '/at') {
            commandType = 'Appointment';
            req.isTomorrow = true;
        }
        else if (lowerText.startsWith('/a ') || lowerText === '/a' || lowerText.startsWith('/appointment') || lowerText.startsWith('/vc')) commandType = 'Appointment';

        if (!commandType) {
            // Unknown command - show full help
            res.set('Content-Type', 'text/xml');
            return res.send(`<Response><Message>${fullHelp}</Message></Response>`);
        }

        // Remove command keyword (e.g. "/order") and split
        const content = text.replace(/^\/\w+\s*/, '').trim(); 
        let args = content.split(',').map(s => s.trim());

        // Basic Validation (Name & Mobile are strictly required)
        if (!content.includes(',')) {
             res.set('Content-Type', 'text/xml');
             return res.send(`<Response><Message>❌ *Comma Missing*\nYou MUST use COMMAS ( , ) to separate details.\nExample: */a Rahul, 9876543210, 11:30, Ring*</Message></Response>`);
        }

        if (args.length < 2) {
             res.set('Content-Type', 'text/xml');
             return res.send(`<Response><Message>❌ *Invalid Format*\nName and Mobile are mandatory.\nTry: */help ${commandType.toLowerCase()}*</Message></Response>`);
        }

        // --- MAPPING FIELDS BASED ON TYPE ---
        // Common Fields: Name (0), Mobile (1), Address (2), Total (3), Advance (4)
        
        const rawName = args[0] || 'Unknown';
        const nameParts = rawName.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || '';

        const parseAmount = (val) => {
            if (!val) return 0;
            const clean = val.trim().toLowerCase();
            if (clean === 'tbd') return -1;
            const parsed = parseInt(clean);
            return isNaN(parsed) ? 0 : parsed;
        };

        const mobile = args[1] || '';
        const address = args[2] || '';
        const totalAmount = parseAmount(args[3]);
        const advancePaid = parseAmount(args[4]);
        
        let remainingAmount = 0;
        if (totalAmount === -1 || advancePaid === -1) {
            remainingAmount = -1;
        } else {
            remainingAmount = totalAmount - advancePaid;
        }

        let karigarName = '';
        let trackingNumber = '';
        let notes = '';
        let appointmentDate = today;
        let appointmentTime = '';

        // Specific Fields
        if (commandType === 'Repair') {
            // Arg 5: Karigar, Arg 6+: Notes
            karigarName = args[5] || '';
            notes = args.slice(6).join(', ');
        } else if (commandType === 'Delivery') {
            // Arg 5: Tracking, Arg 6+: Notes
            trackingNumber = args[5] || '';
            notes = args.slice(6).join(', ');
        } else if (commandType === 'Appointment') {
            // Format: /a Name, Mobile, Time, Notes, Date
            const aName = args[0] || 'Unknown';
            const aMobile = args[1] || '';
            let rawTime = (args[2] || '').trim().toLowerCase();
            let rawDate = (args[4] || '').trim(); // 5th argument is specifically for Date
            
            // Notes logic: If we have a 5th arg that is NOT a date, it might be more notes? 
            // But let's follow the user's strict structure.
            notes = (args[3] || '').trim(); 
            
            // Check for explicit date in the 5th arg first
            let targetDate = today;
            const datePattern = /(\d{1,2})-(\d{1,2})/;
            const dateMatchArg4 = rawDate.match(datePattern);
            const dateMatchArg2 = rawTime.match(datePattern);

            if (dateMatchArg4) {
                const day = dateMatchArg4[1].padStart(2, '0');
                const month = dateMatchArg4[2].padStart(2, '0');
                const year = new Date().getFullYear();
                targetDate = `${year}-${month}-${day}`;
            } else if (dateMatchArg2) {
                const day = dateMatchArg2[1].padStart(2, '0');
                const month = dateMatchArg2[2].padStart(2, '0');
                const year = new Date().getFullYear();
                targetDate = `${year}-${month}-${day}`;
                rawTime = rawTime.replace(dateMatchArg2[0], '').trim();
            } else if (req.isTomorrow || rawTime.includes('tomorrow') || rawDate.toLowerCase().includes('tomorrow')) {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                targetDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrow);
                rawTime = rawTime.replace('tomorrow', '').trim();
            } else if (rawTime.includes('today')) {
                rawTime = rawTime.replace('today', '').trim();
            }

            // Strict fallback: if they put the time in the Notes slot by mistake
            if (!rawTime.match(/\d/) && notes.match(/\d/)) {
                rawTime = notes;
                notes = (args[4] || '');
            }

            // STRICT TIME PARSING (Must be HH:MM)
            const strictMatch = rawTime.match(/^(\d{1,2}):(\d{2})$/);
            if (!strictMatch) {
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>❌ *Strict Time Format Required*\nPlease use the 24-hour format: *HH:MM*\nExample: *11:30* or *16:00*</Message></Response>`);
            }

            const hour = strictMatch[1].padStart(2, '0');
            const min = strictMatch[2].padStart(2, '0');
            const formattedTime = `${hour}:${min}`;

            // Calculate slotIndex
            const slotIdx = timeToSlotIndex(formattedTime);
            if (slotIdx === null) {
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>❌ *Time Out of Bounds*\nPlease specify a valid time between 11:00 AM and 08:00 PM.</Message></Response>`);
            }

            appointmentDate = targetDate;
            appointmentTime = slotIndexToTime(slotIdx) || formattedTime; // Normalizing display
            
            req.slotIndex = slotIdx; // Pass to insert
        } else {
            // Order: Arg 5+: Notes
            notes = args.slice(5).join(', ');
        }

        // --- IMAGE HANDLING ---
        let photoUrl = '';
        if (MediaUrl0) {
            try {
                const { buffer, contentType } = await downloadMedia(MediaUrl0);
                let ext = 'jpg';
                if (contentType === 'image/png') ext = 'png';
                
                const filename = `orders/whatsapp_${Date.now()}.${ext}`;
                await s3.send(new PutObjectCommand({
                    Bucket: bucket, Key: filename, Body: buffer, ACL: "public-read", ContentType: contentType
                }));
                photoUrl = `https://${bucket}.s3.${region}.amazonaws.com/${filename}`;
            } catch (err) {
                logError('[TWILIO] Media upload failed:', err);
            }
        }

        // --- DATABASE INSERT ---
        if (commandType === 'Appointment') {
            const slotIdx = req.slotIndex;
            const sql = `INSERT INTO appointments (firstName, lastName, mobile, date, time, slotIndex, creatorNumber, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
            db.run(sql, [firstName, lastName, mobile, appointmentDate, appointmentTime, slotIdx, From, notes], function (err) {
                if (err) {
                    logError('[TWILIO] Appointment DB Error:', err);
                    return res.status(500).send('<Response><Message>❌ Database Error</Message></Response>');
                }

                const responseText = `✅ *Video Call Set!* (ID: ${this.lastID})\n` +
                    `👤 ${firstName} ${lastName}\n` +
                    `📱 ${mobile}\n` +
                    `📅 Date: ${appointmentDate}\n` +
                    `⏰ Time: ${appointmentTime}`;

                // Schedule Reminder (notify the person who sent the message)
                scheduleReminder({
                    appointmentId: this.lastID,
                    appointmentDate: appointmentDate,
                    slotIndex: slotIdx,
                    customerName: `${firstName} ${lastName}`,
                    customerMobile: mobile,
                    notes: notes,
                    notifyNumbers: [From],
                    sendWhatsApp: sendWhatsApp
                });

                res.set('Content-Type', 'text/xml');
                res.send(`<Response><Message>${responseText}</Message></Response>`);
            });
            return;
        }

        const sql = `
            INSERT INTO orders (
                firstName, lastName, mobile, address, 
                totalAmount, advancePaid, remainingAmount, 
                type, karigarName, trackingNumber, notes, 
                photoUrl, orderReceivedDate, shippingDate
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            firstName, lastName, mobile, address,
            totalAmount, advancePaid, remainingAmount,
            commandType, karigarName, trackingNumber, notes,
            photoUrl, today,
            commandType === 'Delivery' ? today : null
        ];

        db.run(sql, values, async function (err) {
            if (err) {
                logError('[TWILIO] DB Error:', err);
                return res.status(500).send('<Response><Message>❌ Database Error</Message></Response>');
            }

            // Create Order Object for PDF
            const order = {
                id: this.lastID, firstName, lastName, mobile, address, 
                totalAmount, advancePaid, remainingAmount,
                type: commandType, karigarName, notes, photoUrl
            };

            const s3Url = await createAndUploadInvoice(order, s3, bucket, region);
            const invoiceUrl = s3Url || `http://deepasoms.duckdns.org/api/orders/${this.lastID}/invoice?t=${Date.now()}`;

            // Success Response
            const formatDisp = (val) => (val === -1) ? 'TBD' : (val || 0).toLocaleString();

            let waLink = "No mobile number";
            if (mobile) {
                const cleanMobile = normalizeMobile(mobile);
                const customerMsg = `Hi ${firstName}, here is your invoice: ${invoiceUrl}`;
                waLink = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(customerMsg)}`;
            }

            let responseText = `✅ *${commandType} Created!* (ID: ${this.lastID})\n` +
                `👤 ${firstName} ${lastName}\n` +
                `📱 ${mobile}\n` +
                `💰 Bal: ${formatDisp(remainingAmount)}`;

            if (commandType === 'Repair' && karigarName) responseText += `\n🔨 Karigar: ${karigarName}`;
            if (commandType === 'Delivery' && trackingNumber) responseText += `\n📦 AWB: ${trackingNumber}`;
            if (photoUrl) responseText += `\n🖼 Photo Attached`;
            
            responseText += `\n\n👉 *Chat with Customer:*\n${waLink}\n\n📄 *Invoice URL:* ${invoiceUrl}`;

            return sendTwiML(res, responseText, commandType === 'Repair' ? invoiceUrl : null);
        });
    } catch (e) {
        logError('[TWILIO] Error:', e);
        res.set('Content-Type', 'text/xml');
        res.status(500).send('<Response><Message>⚠️ System Error: Something went wrong. Please try again.</Message></Response>');
    }
};
