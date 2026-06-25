import { PutObjectCommand } from '@aws-sdk/client-s3';
import twilio from 'twilio';
import { generateInvoiceBuffer } from './invoiceGenerator.js';
import sharp from 'sharp';
import { extractPriceFromImage, extractDeliveryDetailsFromImage } from './src/utils/ocrUtils.js';
import { generateSkuId } from './src/utils/skuUtils.js';

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER || 'whatsapp:+14155238886';

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
const logError = (...args) => console.error(`[${new Date().toISOString()}]`, ...args);

// ---- SLOT CONFIG ----
const WORK_START_HOUR = 11;
const WORK_END_HOUR = 20; // 8 PM
const SLOT_MINUTES = 30;

const pendingPhotosSession = new Map();

async function executeSessionOrder(senderKey, session, db, s3, bucket, region) {
    log(`[PHOTOS-SESSION] Executing saved order for ${senderKey} with ${session.mediaUrls.length} photos.`);
    
    const finalPhotoUrl = session.mediaUrls.join(',');
    const command = session.command;

    const sql = `
        INSERT INTO orders (
            firstName, lastName, mobile, address, 
            totalAmount, advancePaid, remainingAmount, 
            type, karigarName, trackingNumber, notes, 
            photoUrl, orderReceivedDate, shippingDate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        command.firstName, command.lastName, command.mobile, command.address,
        command.totalAmount, command.advancePaid, command.remainingAmount,
        command.commandType, command.karigarName, command.trackingNumber, command.notes,
        finalPhotoUrl, command.today,
        command.commandType === 'Delivery' ? command.today : null
    ];

    db.run(sql, values, async function (err) {
        if (err) {
            logError('[PHOTOS-SESSION] DB Error:', err);
            return sendWhatsApp(senderKey, `❌ Database Error: Failed to save your ${command.commandType} order.`);
        }

        const formatDisp = (val) => (val === -1) ? 'TBD' : (val || 0).toLocaleString();

        let responseText = `✅ *${command.commandType} Created!* (ID: ${this.lastID})\n` +
            `👤 ${command.firstName} ${command.lastName}\n` +
            `📱 ${command.mobile}\n` +
            `💰 Bal: ${formatDisp(command.remainingAmount)}\n` +
            `🖼 Photos Attached: ${session.mediaUrls.length}`;

        if (command.commandType === 'Repair' && command.karigarName) responseText += `\n🔨 Karigar: ${command.karigarName}`;
        if (command.commandType === 'Delivery' && command.trackingNumber) responseText += `\n📦 AWB: ${command.trackingNumber}`;
        
        if (command.commandType !== 'Delivery') {
            // Create Order Object for PDF
            const order = {
                id: this.lastID, 
                firstName: command.firstName, 
                lastName: command.lastName, 
                mobile: command.mobile, 
                address: command.address, 
                totalAmount: command.totalAmount, 
                advancePaid: command.advancePaid, 
                remainingAmount: command.remainingAmount,
                type: command.commandType, 
                karigarName: command.karigarName, 
                notes: command.notes, 
                photoUrl: finalPhotoUrl
            };

            const s3Url = await createAndUploadInvoice(order, s3, bucket, region);
            const invoiceUrl = s3Url || `https://deepasoms.duckdns.org/api/orders/${this.lastID}/invoice?t=${Date.now()}`;

            let waLink = "No mobile number";
            if (command.mobile) {
                const cleanMobile = normalizeMobile(command.mobile);
                const customerMsg = `Hi ${command.firstName}, here is your invoice: ${invoiceUrl}`;
                waLink = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(customerMsg)}`;
            }

            responseText += `\n\n👉 *Chat with Customer:*\n${waLink}\n\n📄 *Invoice URL:* ${invoiceUrl}`;
        }

        // Send outbound confirmation message
        await sendWhatsApp(senderKey, responseText);
    });
}

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
export function timeToSlotIndex(timeStr) {
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
        if (!Body && !MediaUrl0) return res.status(200).send('<Response></Response>');

        const text = Body ? Body.trim() : '';
        const lowerText = text.toLowerCase();

        log(`[TWILIO] Msg from ${From}: ${text || '[Media Only]'}`);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

        // --- OCR DELIVERY BRANCH ---
        if (lowerText.startsWith('/ocrdelivery')) {
            if (!MediaUrl0) {
                return sendTwiML(res, '❌ Please attach a photo of the delivery address or receipt with the caption */ocrdelivery*.');
            }

            // Respond immediately to prevent Twilio HTTP timeout (15s limit)
            sendTwiML(res, '⏳ *Processing image...* Gemini is extracting delivery details. Please wait a moment.');

            // Process asynchronously in the background
            (async () => {
                try {
                    // 1. Download media
                    const { buffer, contentType } = await downloadMedia(MediaUrl0);

                    // 2. Call Gemini OCR
                    const details = await extractDeliveryDetailsFromImage(buffer, contentType);

                    if (!details) {
                        await sendWhatsApp(From, '❌ Failed to extract delivery details using Gemini. Please try again with a clearer photo.');
                        return;
                    }

                    if (details.is_blurry === true) {
                        await sendWhatsApp(From, '❌ The photo appears too blurry, dark, or unreadable. Please attach a clearer, well-lit photo of the delivery label and try again.');
                        return;
                    }

                    // 3. Clean fields (replace commas with spaces to not break custom command parser)
                    const name = (details.name || '').replace(/,/g, ' ').trim();
                    const mobile = (details.mobile || '').replace(/,/g, ' ').trim();
                    const address = (details.address || '').replace(/,/g, ' ').trim();
                    const total = details.total !== null && details.total !== undefined ? details.total : 0;
                    const advance = details.advance !== null && details.advance !== undefined ? details.advance : 0;
                    const awb = (details.awb || '').replace(/,/g, ' ').trim();
                    
                    // Keep pincode info in notes if available
                    let notes = (details.notes || '').replace(/,/g, ' ').trim();
                    if (details.pincode) {
                        const pinStr = `Pincode: ${details.pincode}`;
                        if (!notes.toLowerCase().includes(details.pincode.toLowerCase())) {
                            notes = notes ? `${notes} (${pinStr})` : pinStr;
                        }
                    }

                    // --- VALIDATION & WARNINGS ---
                    const warnings = [];

                    // 1. Mobile validation
                    const mobileDigits = mobile.replace(/\D/g, '');
                    if (!mobileDigits) {
                        warnings.push('📞 *Mobile number is missing!*');
                    } else if (mobileDigits.length < 10) {
                        warnings.push(`📞 *Mobile number is less than 10 digits:* ${mobile}`);
                    }

                    // 2. Pincode validation
                    const cleanPincode = (details.pincode || '').toString().trim().replace(/\s/g, '');
                    if (!cleanPincode) {
                        warnings.push('📍 *Pincode is missing!*');
                    } else if (!/^\d{6}$/.test(cleanPincode)) {
                        warnings.push(`📍 *Pincode is invalid (must be exactly 6 digits):* ${details.pincode || 'none'}`);
                    }

                    // 3. AWB (Tracking number) validation
                    if (!awb) {
                        warnings.push('📦 *AWB (Tracking number) is missing!*');
                    }

                    let warningText = '';
                    if (warnings.length > 0) {
                        warningText = `\n⚠️ *CRITICAL VERIFICATION WARNINGS:*\n` + warnings.map(w => `- ${w}`).join('\n') + `\n`;
                    }

                    // 4. Construct copy-pasteable command
                    // Format: /delivery Name, Mobile, Address, Total, Advance, AWB, Notes
                    const generatedCommand = `/delivery ${name || 'Name'}, ${mobile || 'Mobile'}, ${address || 'Address'}, ${total}, ${advance}, ${awb}, ${notes}`;

                    const responseMessage = `🤖 *OCR Delivery Details Extracted*\n\n` +
                        `👤 *Name:* ${name || '—'}\n` +
                        `📞 *Mobile:* ${mobile || '—'}${mobileDigits.length < 10 ? ' (⚠️ check)' : ''}\n` +
                        `📍 *Address:* ${address || '—'}\n` +
                        `💰 *Total:* ₹${total.toLocaleString('en-IN')}\n` +
                        `💵 *Advance:* ₹${advance.toLocaleString('en-IN')}\n` +
                        `📦 *AWB:* ${awb || '—'}${!awb ? ' (⚠️ check)' : ''}\n` +
                        `📝 *Notes:* ${notes || '—'}\n` +
                        warningText + `\n` +
                        `📋 _The copy-pasteable command has been sent in the next message._`;

                    // Send summary card & copy-pasteable command as two separate outbound WhatsApp messages
                    await sendWhatsApp(From, responseMessage);
                    await sendWhatsApp(From, generatedCommand);

                } catch (err) {
                    logError('[OCR DELIVERY] Error processing:', err);
                    await sendWhatsApp(From, '❌ Error processing OCR delivery request. Please try again.');
                }
            })();

            return;
        }

        // --- POLKI INVENTORY INGEST BRANCH ---
        if (lowerText.startsWith('/polki') && MediaUrl0) {
            try {
                // 1. Parse category
                let category = 'neckpiece'; // default
                if (lowerText.includes('set')) category = 'set';
                else if (lowerText.includes('earring')) category = 'earrings';

                // 2. Parse can_sell_separately
                const canSellSeparately = (lowerText.includes('separate') || lowerText.includes('mix')) ? 1 : 0;

                // 3. Parse quantity
                const qtyMatch = lowerText.match(/qty\s*(\d+)/i) || lowerText.match(/quantity\s*(\d+)/i);
                const quantity = qtyMatch ? parseInt(qtyMatch[1]) : 1;

                // 4. Download media (reuse existing downloadMedia helper)
                const { buffer, contentType } = await downloadMedia(MediaUrl0);

                // 5. OCR price from raw buffer (before any Sharp processing)
                let price = await extractPriceFromImage(buffer);

                // 6. Fallback: parse price from message body text
                if (!price) {
                    const priceMatch = lowerText.match(/price\s*[₹]?\s*(\d+)/i)
                        || lowerText.match(/[₹]\s*(\d+)/)
                        || lowerText.match(/\b(\d{4,6})\b/);
                    price = priceMatch ? parseInt(priceMatch[1]) : null;
                }

                // 7. If still no price — reply and bail
                if (!price) {
                    res.set('Content-Type', 'text/xml');
                    return res.send(`<Response><Message>❌ Couldn't read a price from the photo or message.\nMake sure the price tag is visible, or add: price 45000</Message></Response>`);
                }

                // 8. Process image with Sharp → JPEG
                const processedBuffer = await sharp(buffer).jpeg({ quality: 80 }).toBuffer();

                // 9. Upload to S3
                const filename = `polki/whatsapp_${Date.now()}.jpg`;
                await s3.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: filename,
                    Body: processedBuffer,
                    ACL: 'public-read',
                    ContentType: 'image/jpeg'
                }));
                const photoUrl = `https://${bucket}.s3.${region}.amazonaws.com/${filename}`;

                // 10. Generate SKU ID
                generateSkuId(db, (skuId) => {
                    const sql = `
                        INSERT INTO polki_inventory
                            (sku_id, category, can_sell_separately, photo_url, price, quantity,
                             description, source, whatsapp_media_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'whatsapp', ?)
                    `;
                    const values = [
                        skuId, category, canSellSeparately, photoUrl, price, quantity,
                        text, // full original message body as description
                        req.body.MediaSid0 || null
                    ];

                    db.run(sql, values, function(err) {
                        if (err) {
                            logError('[POLKI] DB insert error:', err);
                            res.set('Content-Type', 'text/xml');
                            return res.send(`<Response><Message>❌ Failed to save to inventory. Please try again.</Message></Response>`);
                        }

                        const msg = `✅ Polki stock added!\nSKU: ${skuId}\nType: ${category}\nPrice: ₹${price.toLocaleString('en-IN')}\nQty: ${quantity}`;
                        res.set('Content-Type', 'text/xml');
                        return res.send(`<Response><Message>${msg}</Message></Response>`);
                    });
                });

            } catch (err) {
                logError('[POLKI] Ingest error:', err);
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>❌ Failed to add stock. Please try again.</Message></Response>`);
            }
            return;
        }
        
        // --- HELP HANDLERS ---
        const fullHelp = `🤖 *Deepa's Jewelry Bot - All Commands*\n\n` +
                         `🛠 *REPAIR:* \`/repair Name, Mobile, Address, Total, Advance, Karigar, Notes\`\n` +
                         `📝 *ORDER:* \`/order Name, Mobile, Address, Total, Advance, Notes\`\n` +
                         `🚚 *DELIVERY:* \`/delivery Name, Mobile, Address, Total, Advance, AWB, Notes\`\n` +
                         `📸 *PHOTOS:* \`/photos <number>\` (Pre-declare multiple photos, e.g. /photos 3)\n` +
                         `📸 *OCR DELIVERY:* Send photo with caption \`/ocrdelivery\`\n` +
                         `✅ *COLLECTED:* \`/rc ID\` (Mark Collected + Stamped Invoice)\n` +
                         `📄 *INVOICE:* \`/generate ID\` (Normal PDF)\n` +
                         `📹 *APPT (Today):* \`/a Name, Mobile, Time, Notes, Date\`\n` +
                         `📹 *APPT (Tmrw):* \`/at Name, Mobile, Time, Notes\`\n` +
                         `📅 *SLOTS:* \`/slots\` or \`/slots tomorrow\`\n` +
                         `🗑 *CLEAR SLOT:* \`/reschedule Time\`\n\n` +
                         `💡 *Multiple Photos:* To attach multiple photos, send */photos <num>* first (e.g. */photos 3*), then send the photos and command in any order.\n\n` +
                         `⚠️ *IMPORTANT:* Separate details with a COMMA ( , ) for /repair, /delivery, /order, and /a.`;

        // --- HELP HANDLERS ---
        if (lowerText.startsWith('/help')) {
            const sepInfo = "⚠️ *IMPORTANT:* Separate each detail with a COMMA ( , )";

            if (lowerText.includes('repair')) {
                const repairHelp = `🛠 *REPAIR Order Format*\n${sepInfo}\n\n` +
                          `*Command:*\n/repair Name, Mobile, Address, Total, Advance, Karigar, Notes\n\n` +
                          `*Example:*\n/repair Deepa Ben, 9925042620, Ahmedabad, 5000, 1000, Anil, Resize Ring\n\n` +
                          `📸 *Multiple Photos:*\n` +
                          `To attach multiple photos, send */photos 3* (or any count) before completing this command.`;
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>${repairHelp}</Message></Response>`);
            } else if (lowerText.includes('delivery')) {
                const deliveryHelp = `🚚 *DELIVERY Order Format*\n${sepInfo}\n\n` +
                          `*Command:*\n/delivery Name, Mobile, Address, Total, Advance, AWB, Notes\n\n` +
                          `*Example:*\n/delivery Priya, 9876543210, 56 Park Ave, 20000, 20000, TRACK123, Ship urgent\n\n` +
                          `📸 *OCR Delivery:*\n` +
                          `Send a photo (address label, slip, etc.) with the caption */ocrdelivery* to auto-extract details.\n\n` +
                          `📸 *Multiple Photos:*\n` +
                          `To attach multiple photos, send */photos 2* (or any count) before completing this command.`;
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>${deliveryHelp}</Message></Response>`);
            } else if (lowerText.includes('order')) {
                const orderHelp = `📝 *ORDER Format*\n${sepInfo}\n\n` +
                          `*Command:*\n/order Name, Mobile, Address, Total, Advance, Notes\n\n` +
                          `*Example:*\n/order Deepa Ben, 9925042620, Ahmedabad, 5000, 1000, Custom Ring\n\n` +
                          `📸 *Multiple Photos:*\n` +
                          `To attach multiple photos, send */photos 3* (or any count) before completing this command.`;
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>${orderHelp}</Message></Response>`);
            } else if (lowerText.includes('ocr') || lowerText.includes('ocrdelivery')) {
                const ocrHelp = `📸 *OCR DELIVERY Command*\n\n` +
                          `To auto-generate a pre-filled delivery entry:\n` +
                          `1. Send an image (shipping label, written slip, or receipt) on WhatsApp.\n` +
                          `2. Set the caption of the photo to */ocrdelivery*.\n` +
                          `3. The bot will reply with the extracted details and a separate copy-pasteable /delivery command.`;
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>${ocrHelp}</Message></Response>`);
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
                    const invoiceUrl = s3Url || `https://deepasoms.duckdns.org/api/orders/${orderId}/invoice?t=${Date.now()}`;
                    
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
                const invoiceUrl = s3Url || `https://deepasoms.duckdns.org/api/orders/${orderId}/invoice?t=${Date.now()}`;
                
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
        else if (lowerText.startsWith('/photos')) commandType = 'Photos';
        else if (lowerText.startsWith('/at ') || lowerText === '/at') {
            commandType = 'Appointment';
            req.isTomorrow = true;
        }
        else if (lowerText.startsWith('/a ') || lowerText === '/a' || lowerText.startsWith('/appointment') || lowerText.startsWith('/vc')) commandType = 'Appointment';

        if (commandType === 'Photos') {
            const numStr = text.replace(/^\/photos\s*/i, '').trim();
            const N = parseInt(numStr);
            if (isNaN(N) || N < 1 || N > 10) {
                return sendTwiML(res, `❌ Invalid number of photos. Please specify a number between 1 and 10 (e.g., */photos 3*).`);
            }

            // Clear any existing session
            const existing = pendingPhotosSession.get(From);
            if (existing && existing.timer) {
                clearTimeout(existing.timer);
            }

            const session = {
                expectedPhotos: N,
                mediaUrls: [],
                command: null
            };

            session.timer = setTimeout(() => {
                log(`[PHOTOS-SESSION] Timeout reached for ${From}.`);
                pendingPhotosSession.delete(From);
                sendWhatsApp(From, `⚠️ Multi-photo session timed out. Please start again with /photos <num>.`);
            }, 120000); // 2 minutes

            pendingPhotosSession.set(From, session);

            // Handle initial photo if attached to the command message
            if (MediaUrl0) {
                try {
                    const { buffer, contentType } = await downloadMedia(MediaUrl0);
                    let ext = 'jpg';
                    if (contentType === 'image/png') ext = 'png';
                    const filename = `orders/whatsapp_${Date.now()}_0.${ext}`;
                    await s3.send(new PutObjectCommand({
                        Bucket: bucket, Key: filename, Body: buffer, ACL: "public-read", ContentType: contentType
                    }));
                    const photoUrl = `https://${bucket}.s3.${region}.amazonaws.com/${filename}`;
                    session.mediaUrls.push(photoUrl);
                } catch (err) {
                    logError('[PHOTOS-SESSION] Error uploading initial photo:', err);
                }
            }

            const received = session.mediaUrls.length;
            const pending = N - received;
            let replyText = `⏳ Got it. Expecting ${N} photos. `;
            if (received > 0) {
                replyText += `Received ${received}, pending ${pending}. Please send the remaining photos.`;
            } else {
                replyText += `Please send the photos now.`;
            }
            return sendTwiML(res, replyText);
        }

        if (!commandType) {
            // Check if this sender has a pending photos session
            const session = pendingPhotosSession.get(From);
            if (session && MediaUrl0) {
                try {
                    // Download and upload this photo to S3
                    const { buffer, contentType } = await downloadMedia(MediaUrl0);
                    let ext = 'jpg';
                    if (contentType === 'image/png') ext = 'png';
                    const filename = `orders/whatsapp_${Date.now()}_${session.mediaUrls.length}.${ext}`;
                    await s3.send(new PutObjectCommand({
                        Bucket: bucket, Key: filename, Body: buffer, ACL: "public-read", ContentType: contentType
                    }));
                    const photoUrl = `https://${bucket}.s3.${region}.amazonaws.com/${filename}`;
                    
                    session.mediaUrls.push(photoUrl);
                    log(`[PHOTOS-SESSION] Collected photo ${session.mediaUrls.length}/${session.expectedPhotos} for ${From}`);

                    // Reset fallback timer
                    clearTimeout(session.timer);

                    const received = session.mediaUrls.length;
                    const pending = session.expectedPhotos - received;

                    if (pending === 0) {
                        if (session.command) {
                            log(`[PHOTOS-SESSION] All photos collected and command exists. Executing...`);
                            pendingPhotosSession.delete(From);
                            setTimeout(() => executeSessionOrder(From, session, db, s3, bucket, region), 0);
                            
                            res.set('Content-Type', 'text/xml');
                            return res.send('<Response></Response>');
                        } else {
                            // Photos complete but command is still pending
                            session.timer = setTimeout(() => {
                                log(`[PHOTOS-SESSION] Timeout reached for ${From} waiting for command.`);
                                pendingPhotosSession.delete(From);
                                sendWhatsApp(From, `⚠️ Multi-photo session timed out waiting for command. Please try again.`);
                            }, 120000);

                            res.set('Content-Type', 'text/xml');
                            return res.send(`<Response><Message>Received ${received}, pending command.</Message></Response>`);
                        }
                    } else {
                        // Reset timer with 2 mins fallback
                        session.timer = setTimeout(() => {
                            log(`[PHOTOS-SESSION] Timeout reached for ${From} waiting for remaining photos.`);
                            pendingPhotosSession.delete(From);
                            sendWhatsApp(From, `⚠️ Multi-photo session timed out. Please try again.`);
                        }, 120000);

                        res.set('Content-Type', 'text/xml');
                        return res.send(`<Response><Message>Received ${received}, pending ${pending}.</Message></Response>`);
                    }
                } catch (err) {
                    logError('[PHOTOS-SESSION] Error handling photo:', err);
                    res.set('Content-Type', 'text/xml');
                    return res.send('<Response></Response>');
                }
            }

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
            karigarName = args[5] || '';
            notes = args.slice(6).join(', ');
        } else if (commandType === 'Delivery') {
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
            notes = args.slice(5).join(', ');
        }

        // --- SESSION STATE CHECK ---
        const session = pendingPhotosSession.get(From);
        let photoUrl = '';

        if (session) {
            clearTimeout(session.timer);
            const received = session.mediaUrls.length;
            
            if (received >= session.expectedPhotos) {
                // All photos already collected. Proceed with DB insert.
                pendingPhotosSession.delete(From);
                photoUrl = session.mediaUrls.join(',');
            } else {
                // Command received before photos are complete. Save command to session.
                session.command = {
                    commandType,
                    firstName,
                    lastName,
                    mobile,
                    address,
                    totalAmount,
                    advancePaid,
                    remainingAmount,
                    karigarName,
                    trackingNumber,
                    notes,
                    today
                };

                // Reset timer for 2 minutes
                session.timer = setTimeout(() => {
                    log(`[PHOTOS-SESSION] Timeout reached for ${From} waiting for remaining photos.`);
                    pendingPhotosSession.delete(From);
                    sendWhatsApp(From, `⚠️ Multi-photo session timed out. Please try again.`);
                }, 120000);

                const pending = session.expectedPhotos - received;
                const replyText = `⏳ Command saved. Received ${received} of ${session.expectedPhotos} photos. Please send the remaining ${pending} photos.`;
                res.set('Content-Type', 'text/xml');
                return res.send(`<Response><Message>${replyText}</Message></Response>`);
            }
        } else {
            // Normal 1-photo or no-photo flow
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

            // Success Response
            const formatDisp = (val) => (val === -1) ? 'TBD' : (val || 0).toLocaleString();

            let responseText = `✅ *${commandType} Created!* (ID: ${this.lastID})\n` +
                `👤 ${firstName} ${lastName}\n` +
                `📱 ${mobile}\n` +
                `💰 Bal: ${formatDisp(remainingAmount)}`;

            if (commandType === 'Repair' && karigarName) responseText += `\n🔨 Karigar: ${karigarName}`;
            if (commandType === 'Delivery' && trackingNumber) responseText += `\n📦 AWB: ${trackingNumber}`;
            if (photoUrl) responseText += `\n🖼 Photo Attached`;
            
            let invoiceUrl = null;
            if (commandType !== 'Delivery') {
                // Create Order Object for PDF
                const order = {
                    id: this.lastID, firstName, lastName, mobile, address, 
                    totalAmount, advancePaid, remainingAmount,
                    type: commandType, karigarName, notes, photoUrl
                };

                const s3Url = await createAndUploadInvoice(order, s3, bucket, region);
                invoiceUrl = s3Url || `https://deepasoms.duckdns.org/api/orders/${this.lastID}/invoice?t=${Date.now()}`;

                let waLink = "No mobile number";
                if (mobile) {
                    const cleanMobile = normalizeMobile(mobile);
                    const customerMsg = `Hi ${firstName}, here is your invoice: ${invoiceUrl}`;
                    waLink = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(customerMsg)}`;
                }

                responseText += `\n\n👉 *Chat with Customer:*\n${waLink}\n\n📄 *Invoice URL:* ${invoiceUrl}`;
            }

            return sendTwiML(res, responseText, commandType === 'Repair' ? invoiceUrl : null);
        });
    } catch (e) {
        logError('[TWILIO] Error:', e);
        res.set('Content-Type', 'text/xml');
        res.status(500).send('<Response><Message>⚠️ System Error: Something went wrong. Please try again.</Message></Response>');
    }
};
