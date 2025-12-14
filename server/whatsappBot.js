import { PutObjectCommand } from '@aws-sdk/client-s3';

// Helper to download media
async function downloadMedia(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch media: ${response.statusText}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type');
    return { buffer, contentType };
}

export const handleTwilioMessage = async (req, res, db, s3, bucket, region) => {
    try {
        const { Body, From, MediaUrl0 } = req.body;
        if (!Body) return res.status(200).send('<Response></Response>');

        console.log(`[TWILIO] Msg from ${From}: ${Body}`);
        const text = Body.trim();
        const lowerText = text.toLowerCase();
        
        // --- HELP HANDLERS ---
        if (lowerText.startsWith('/help')) {
            let helpMsg = "";
            const sepInfo = "⚠️ *IMPORTANT:* Separate each detail with a COMMA ( , )";

            if (lowerText.includes('repair')) {
                helpMsg = `🛠 *REPAIR Order Format*\n${sepInfo}\n\n` +
                          `*Command:*\n/repair Name, Mobile, Address, Total, Advance, Karigar, Notes\n\n` +
                          `*Example:*\n/repair Deepa Ben, 9925042620, Ahmedabad, 300, 300, HariBabu, Ring repair`;
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

        const mobile = args[1] || '';
        const address = args[2] || '';
        const totalAmount = parseInt(args[3] || '0');
        const advancePaid = parseInt(args[4] || '0');
        const remainingAmount = totalAmount - advancePaid;

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
                console.error('[TWILIO] Media upload failed:', err);
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
                console.error('[TWILIO] DB Error:', err);
                return res.status(500).send('<Response><Message>❌ Database Error</Message></Response>');
            }
            
            // Success Response
            let responseText = `✅ *${commandType} Created!* (ID: ${this.lastID})\n` +
                               `👤 ${firstName} ${lastName}\n` +
                               `📱 ${mobile}\n` +
                               `💰 Bal: ${(remainingAmount || 0).toLocaleString()}`;
            
            if (commandType === 'Repair' && karigarName) responseText += `\n🔨 Karigar: ${karigarName}`;
            if (commandType === 'Delivery' && trackingNumber) responseText += `\n📦 AWB: ${trackingNumber}`;
            if (photoUrl) responseText += `\n🖼 Photo Attached`;

            res.set('Content-Type', 'text/xml');
            res.send(`<Response><Message>${responseText}</Message></Response>`);
        });

    } catch (e) {
        console.error('[TWILIO] Error:', e);
        res.status(500).send('<Response><Message>Server Error</Message></Response>');
    }
};
