import { PutObjectCommand } from '@aws-sdk/client-s3';
import twilio from 'twilio';

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

// Convert time string → slotIndex
function timeToSlotIndex(timeStr) {
    const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i);
    if (!match) return null;
    
    let hour = parseInt(match[1]);
    const min = parseInt(match[2] || '0');
    const ampm = match[3].toLowerCase();

    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    if (hour < WORK_START_HOUR || hour >= WORK_END_HOUR) return null;
    return ((hour - WORK_START_HOUR) * 2) + (min >= 30 ? 1 : 0);
}

// Convert slotIndex → time range
function slotIndexToTime(slotIndex) {
    if (slotIndex === null || slotIndex === undefined) return '';
    const totalMinutes = slotIndex * SLOT_MINUTES;
    const startHour = WORK_START_HOUR + Math.floor(totalMinutes / 60);
    const startMin = totalMinutes % 60;

    const fmt = (h, m) => {
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hh = ((h + 11) % 12 + 1);
        return `${hh}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    return fmt(startHour, startMin);
}

function slotIndexToTimeRange(slotIndex) {
    if (slotIndex === null || slotIndex === undefined) return '';
    const totalMinutes = slotIndex * SLOT_MINUTES;
    const startHour = WORK_START_HOUR + Math.floor(totalMinutes / 60);
    const startMin = totalMinutes % 60;

    const endTotalMinutes = totalMinutes + SLOT_MINUTES;
    const endHour = WORK_START_HOUR + Math.floor(endTotalMinutes / 60);
    const endMin = endTotalMinutes % 60;

    const fmt = (h, m) => {
        const actualAmPm = h >= 12 ? 'pm' : 'am';
        let hh = h % 12;
        if (hh === 0) hh = 12;
        return `${hh}:${m.toString().padStart(2, '0')} ${actualAmPm}`;
    };

    return `${fmt(startHour, startMin)} - ${fmt(endHour, endMin)}`;
}

const sendWhatsApp = async (to, body) => {
    try {
        await twilioClient.messages.create({
            from: TWILIO_FROM,
            to: to,
            body: body
        });
        log(`[OUTBOUND] Msg sent to ${to}`);
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
    
    const [year, month, day] = appointmentDate.split('-').map(Number);
    const slotStartMinutes = slotIndex * SLOT_MINUTES;
    const hour = WORK_START_HOUR + Math.floor(slotStartMinutes / 60);
    const minute = slotStartMinutes % 60;

    const appointmentTime = new Date(year, month - 1, day, hour, minute);
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
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

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

export const handleTwilioMessage = async (req, res, db, s3, bucket, region) => {
    try {
        const { Body, From, MediaUrl0 } = req.body;
        if (!Body) return res.status(200).send('<Response></Response>');

        log(`[TWILIO] Msg from ${From}: ${Body}`);
        const today = new Date().toISOString().split('T')[0];
        const text = Body.trim();
        const lowerText = text.toLowerCase();
        
        // --- HELP HANDLERS ---
        if (lowerText.startsWith('/help')) {
            let helpMsg = "";
            const sepInfo = "⚠️ *IMPORTANT:* Separate each detail with a COMMA ( , )";

            if (lowerText.includes('repair')) {
                helpMsg = `🛠 *REPAIR Order Format*\n${sepInfo}\n\n` +
                          `*Command:*\n/repair Name, Mobile, Address, Total, Advance, Karigar, Notes\n\n` +
                          `*Example (with TBD):*\n/repair Deepa Ben, 9925042620, Ahmedabad, TBD, 0, Karigar, Ring\n\n` +
                          `💡 Use *TBD* if the amount is not yet fixed.`;
            } else if (lowerText.includes('delivery')) {
                helpMsg = `🚚 *DELIVERY Order Format*\n${sepInfo}\n\n` +
                          `*Command:*\n/delivery Name, Mobile, Address, Total, Advance, TrackingNumber, Notes\n\n` +
                          `*Example:*\n/delivery Priya, 9876543210, 56 Park Ave, 20000, 20000, TRACK123, Ship urgent`;
            } else if (lowerText.includes('appointment') || lowerText.startsWith('/a')) {
                helpMsg = `📹 *VIDEO CALL Appointment*\n${sepInfo}\n\n` +
                          `*Command:*\n/a Name, Mobile, Time, Notes\n\n` +
                          `*Strict Time Format:* HH:MM AM/PM\n` +
                          `*Example:* /a Rahul, 9876543210, 11:30 AM, Show Rings\n\n` +
                          `💡 *Keywords:*\n` +
                          `• Use *Tomorrow* in time: /a Rahul, 9876543210, 11:30 AM Tomorrow\n` +
                          `• Shortcut for tomorrow: */at* Name, Mobile, Time, Notes`;
            } else {
                // General Help
                helpMsg = `👋 *Jewelry Bot Help*\n\n` +
                          `👉 */a* (Appointment Today)\n` +
                          `👉 */at* (Appointment Tomorrow)\n` +
                          `👉 */slots* (Check Today)\n` +
                          `👉 */slots tomorrow* (Check Tomorrow)\n` +
                          `👉 */reschedule* (Clear a slot)\n` +
                          `👉 */help order/repair/delivery* for more.`;
            }

            res.set('Content-Type', 'text/xml');
            return res.send(`<Response><Message>${helpMsg}</Message></Response>`);
        }

        // --- SLOTS AVAILABILITY COMMAND ---
        if (lowerText.startsWith('/slots')) {
            const parts = text.split(/\s+/);
            let targetDate = new Date().toISOString().split('T')[0];
            let dayLabel = "Today";

            if (parts[1] && parts[1].toLowerCase() === 'tomorrow') {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                targetDate = tomorrow.toISOString().split('T')[0];
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
                return res.send(`<Response><Message>❌ Please specify a time.\nExample: */reschedule 11:30 AM*</Message></Response>`);
            }

            let targetDate = new Date().toISOString().split('T')[0];
            let cleanTime = rawTime;
            let dayLabel = "Today";

            if (rawTime.includes('tomorrow')) {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                targetDate = tomorrow.toISOString().split('T')[0];
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

        // --- GENERATE INVOICE COMMAND ---
        if (lowerText.startsWith('/generate')) {
            const parts = text.split(/\s+/);
            const orderId = parts[1];

            if (!orderId) {
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>❌ Please provide an Order ID.\nExample: */generate 123*</Message></Response>`);
            }

            // Check if order exists
            db.get("SELECT id, firstName, lastName, mobile FROM orders WHERE id = ?", [orderId], (err, row) => {
                if (err) {
                    logError('[TWILIO] DB Error:', err);
                    res.set('Content-Type', 'text/xml');
                    return res.send('<Response><Message>❌ Database Error</Message></Response>');
                }
                if (!row) {
                    res.set('Content-Type', 'text/xml');
                    return res.send(`<Response><Message>❌ Order #${orderId} not found.</Message></Response>`);
                }

                const invoiceUrl = `http://deepasoms.duckdns.org/api/orders/${orderId}/invoice`;
                
                // Construct Click-to-Chat Link
                let waLink = "No mobile number";
                if (row.mobile) {
                    let cleanMobile = row.mobile.replace(/\D/g, '');
                    if (cleanMobile.startsWith('0')) cleanMobile = cleanMobile.slice(1);
                    if (cleanMobile.length === 10) cleanMobile = '91' + cleanMobile;

                    const customerMsg = `Hi ${row.firstName}, here is your invoice: ${invoiceUrl}`;
                    waLink = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(customerMsg)}`;
                }

                const bodyText = `📄 *Invoice Generated*\n\n` +
                                 `👤 ${row.firstName} ${row.lastName}\n\n` +
                                 `👉 *Chat with Customer:*\n${waLink}\n\n` +
                                 `🔗 *Download PDF:*\n${invoiceUrl}`;

                res.set('Content-Type', 'text/xml');
                res.send(`
                    <Response>
                        <Message>
                            <Body>${bodyText}</Body>
                            <Media>${invoiceUrl}</Media>
                        </Message>
                    </Response>
                `);
            });
            return; // Stop further processing
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
            // Unknown command
            res.set('Content-Type', 'text/xml');
            return res.send(`<Response><Message>👋 Send */help order*, */help repair*, or */help delivery* for instructions.</Message></Response>`);
        }

        // Remove command keyword (e.g. "/order") and split
        const content = text.replace(/^\/\w+\s*/, '').trim(); 
        let args = content.split(',').map(s => s.trim());

        // Basic Validation (Name & Mobile are strictly required)
        if (!content.includes(',')) {
             res.set('Content-Type', 'text/xml');
             return res.send(`<Response><Message>❌ *Comma Missing*\nYou MUST use COMMAS ( , ) to separate details.\nExample: */a Rahul, 9876543210, 11:30 AM, Ring*</Message></Response>`);
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
            // Format: /a Name, Mobile, Time [Today/Tomorrow], Notes
            const aName = args[0] || 'Unknown';
            const aMobile = args[1] || '';
            let rawTime = (args[2] || '').trim().toLowerCase();
            
            // Check for Tomorrow keyword or /at flag
            let targetDate = today;
            if (req.isTomorrow || rawTime.includes('tomorrow')) {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                targetDate = tomorrow.toISOString().split('T')[0];
                rawTime = rawTime.replace('tomorrow', '').trim();
            } else if (rawTime.includes('today')) {
                rawTime = rawTime.replace('today', '').trim();
            }

            // Fallback for empty rawTime if commas were used oddly
            if (!rawTime && args[3] && args[3].match(/\d/)) {
                rawTime = args[3].trim();
                notes = args.slice(4).join(', ');
            } else {
                notes = args.slice(3).join(', ');
            }

            // STRICT TIME PARSING (Must be HH:MM AM/PM)
            const strictMatch = rawTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
            if (!strictMatch) {
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>❌ *Strict Time Format Required*\nPlease use the format: *HH:MM AM/PM*\nExample: *11:30 AM* or *04:00 PM*</Message></Response>`);
            }

            const hour = strictMatch[1];
            const min = strictMatch[2];
            const ampm = strictMatch[3].toUpperCase();
            const formattedTime = `${hour}:${min} ${ampm}`;

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
                photoUrl, orderReceivedDate
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            firstName, lastName, mobile, address,
            totalAmount, advancePaid, remainingAmount,
            commandType, karigarName, trackingNumber, notes,
            photoUrl, today
        ];

        db.run(sql, values, function (err) {
            if (err) {
                logError('[TWILIO] DB Error:', err);
                return res.status(500).send('<Response><Message>❌ Database Error</Message></Response>');
            }

            // Success Response
            const formatDisp = (val) => (val === -1) ? 'TBD' : (val || 0).toLocaleString();

            let responseText = `✅ *${commandType} Created!* (ID: ${this.lastID})\n` +
                `👤 ${firstName} ${lastName}\n` +
                `📱 ${mobile}\n` +
                `💰 Bal: ${formatDisp(remainingAmount)}`;

            if (commandType === 'Repair' && karigarName) responseText += `\n🔨 Karigar: ${karigarName}`;
            if (commandType === 'Delivery' && trackingNumber) responseText += `\n📦 AWB: ${trackingNumber}`;
            if (photoUrl) responseText += `\n🖼 Photo Attached`;

            res.set('Content-Type', 'text/xml');
            res.send(`<Response><Message>${responseText}</Message></Response>`);
        });

    } catch (e) {
        logError('[TWILIO] Error:', e);
        res.set('Content-Type', 'text/xml');
        res.status(500).send('<Response><Message>⚠️ System Error: Something went wrong. Please try again.</Message></Response>');
    }
};
