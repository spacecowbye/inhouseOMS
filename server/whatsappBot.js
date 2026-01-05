import { PutObjectCommand } from '@aws-sdk/client-s3';

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
const logError = (...args) => console.error(`[${new Date().toISOString()}]`, ...args);

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
            } else if (lowerText.includes('order')) {
                helpMsg = `💍 *NEW ORDER Format*\n${sepInfo}\n\n` +
                          `*Command:*\n/order Name, Mobile, Address, Total, Advance, Notes\n\n` +
                          `*Example:*\n/order Amit, 9988776655, 21 Sector 4, 50000, 10000, Gold Chain design`;
            } else {
                // General Help
                helpMsg = `👋 *Jewelry Bot Help*\n\n` +
                          `To see the format for a specific type, send one of these commands:\n\n` +
                          `👉 */help order* (New Orders)\n` +
                          `👉 */help repair* (Repairs)\n` +
                          `👉 */help delivery* (Shipments)\n\n` +
                          `⚠️ Always use COMMAS ( , ) to separate details.`;
            }

            res.set('Content-Type', 'text/xml');
            return res.send(`<Response><Message>${helpMsg}</Message></Response>`);
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

        if (!commandType) {
            // Unknown command
            res.set('Content-Type', 'text/xml');
            return res.send(`<Response><Message>👋 Send */help order*, */help repair*, or */help delivery* for instructions.</Message></Response>`);
        }

        // Remove command keyword (e.g. "/order") and split
        const content = text.replace(/^\/\w+\s*/, '').trim(); 
        const args = content.split(',').map(s => s.trim());

        // Basic Validation (Name & Mobile are strictly required)
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

        // Specific Fields
        if (commandType === 'Repair') {
            // Arg 5: Karigar, Arg 6+: Notes
            karigarName = args[5] || '';
            notes = args.slice(6).join(', ');
        } else if (commandType === 'Delivery') {
            // Arg 5: Tracking, Arg 6+: Notes
            trackingNumber = args[5] || '';
            notes = args.slice(6).join(', ');
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
        const today = new Date().toISOString().split('T')[0];
        
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

        db.run(sql, values, function(err) {
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
