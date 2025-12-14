import { PutObjectCommand } from '@aws-sdk/client-s3';

// Helper to download media from Twilio URL
// Twilio media URLs might require Basic Auth if "Enforce Basic Auth" is on in Twilio Console.
// For now assuming public or simple fetch works, but usually it redirects or just works.
async function downloadMedia(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch media: ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type');
    return { buffer, contentType };
}

export const handleTwilioMessage = async (req, res, db, s3, bucket, region) => {
    try {
        const { Body, From, MediaUrl0 } = req.body;
        console.log(`[TWILIO] Received message from ${From}: ${Body}`);

        if (!Body) return res.status(200).send('<Response></Response>');

        const text = Body.trim();
        const lowerText = text.toLowerCase();

        // --- HELP COMMANDS ---
        if (lowerText.startsWith('/help')) {
            let helpMsg = "";

            if (lowerText.includes('repair')) {
                helpMsg = `🛠 *Repair Order Format*\n\n` +
                          `Mandatory: Name, Mobile\n` +
                          `Optional: Cost, Advance, Notes\n\n` +
                          `*Format:*\n/order Name, Mobile, Cost, Advance, Repair, Notes\n\n` +
                          `*Example:*\n/order Rahul, 9876543210, 500, 0, Repair, Ring resizing`;
            } else if (lowerText.includes('delivery')) {
                helpMsg = `🚚 *Delivery Order Format*\n\n` +
                          `Mandatory: Name, Mobile\n` +
                          `Optional: Total, Advance, Notes\n\n` +
                          `*Format:*\n/order Name, Mobile, TotalAmount, AdvancePaid, Delivery, Address/Notes\n\n` +
                          `*Example:*\n/order Priya, 9876543210, 20000, 20000, Delivery, Ship to 123 Main St`;
            } else {
                // Default / help order
                helpMsg = `💍 *New Order Format*\n\n` +
                          `Mandatory: Name, Mobile\n` +
                          `Optional: Total, Advance, Notes\n\n` +
                          `*Format:*\n/order Name, Mobile, Total, Advance, Order, Notes\n\n` +
                          `*Example:*\n/order Amit, 9988776655, 50000, 10000, Order, Gold Chain design`;
            }

            res.set('Content-Type', 'text/xml');
            return res.send(`<Response><Message>${helpMsg}</Message></Response>`);
        }

        // --- ORDER PROCESSING ---
        if (lowerText.startsWith('/order')) {
            const content = text.slice(6).trim(); // Remove '/order'
            const args = content.split(',').map(s => s.trim());

            if (args.length < 2) {
                 res.set('Content-Type', 'text/xml');
                 return res.send(`
                    <Response>
                        <Message>❌ *Invalid Format*\n\nNeed at least Name & Mobile.\nSend */help order* for examples.</Message>
                    </Response>
                `);
            }

            const firstName = args[0] || 'Unknown';
            const mobile = args[1] || '';
            const totalAmount = parseInt(args[2] || '0');
            const advancePaid = parseInt(args[3] || '0');
            const remainingAmount = totalAmount - advancePaid;
            
            // Type Logic
            let type = args[4] || 'Order';
            const validTypes = ['Order', 'Repair', 'Delivery'];
            if (!validTypes.some(t => t.toLowerCase() === type.toLowerCase())) {
                if (type.toLowerCase().includes('rep')) type = 'Repair';
                else if (type.toLowerCase().includes('del')) type = 'Delivery';
                else type = 'Order';
            } else {
                 type = validTypes.find(t => t.toLowerCase() === type.toLowerCase());
            }

            const notes = args.slice(5).join(', ');

            let photoUrl = '';

            // Handle Media
            if (MediaUrl0) {
                console.log(`[TWILIO] Fetching media from: ${MediaUrl0}`);
                try {
                    const { buffer, contentType } = await downloadMedia(MediaUrl0);
                    
                    let ext = 'jpg';
                    if (contentType === 'image/png') ext = 'png';
                    if (contentType === 'image/jpeg') ext = 'jpg';
                    
                    const filename = `orders/whatsapp_${Date.now()}.${ext}`;

                    await s3.send(new PutObjectCommand({
                        Bucket: bucket,
                        Key: filename,
                        Body: buffer,
                        ACL: "public-read",
                        ContentType: contentType
                    }));

                    photoUrl = `https://${bucket}.s3.${region}.amazonaws.com/${filename}`;
                    console.log(`[TWILIO] Media uploaded to S3: ${photoUrl}`);
                } catch (err) {
                    console.error('[TWILIO] Media upload failed:', err);
                }
            }

            const sql = `INSERT INTO orders (firstName, mobile, totalAmount, advancePaid, remainingAmount, type, notes, photoUrl, orderReceivedDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const today = new Date().toISOString().split('T')[0];

            db.run(sql, [firstName, mobile, totalAmount, advancePaid, remainingAmount, type, notes, photoUrl, today], function(err) {
                if (err) {
                    console.error('[TWILIO] DB Insert Error:', err);
                     return res.status(500).send('<Response><Message>❌ Internal Database Error</Message></Response>');
                }
                const orderId = this.lastID;
                console.log(`[TWILIO] Order created. ID: ${orderId}`);

                const responseText = `✅ *Order Created!*\n🆔 ID: ${orderId}\n👤 Name: ${firstName}\n💰 Balance: ${remainingAmount}\n🏷 Type: ${type}\n🖼 Photo: ${photoUrl ? 'Attached' : 'None'}`;
                
                res.set('Content-Type', 'text/xml');
                res.send(`
                    <Response>
                        <Message>${responseText}</Message>
                    </Response>
                `);
            });
            return;
        }

        // --- UNKNOWN COMMAND ---
        res.set('Content-Type', 'text/xml');
        res.send(`
            <Response>
                <Message>👋 Hi! Send */help order* to see how to add new orders.</Message>
            </Response>
        `);

    } catch (e) {
        console.error('[TWILIO] Error:', e);
        res.status(500).send('<Response><Message>Server Error</Message></Response>');
    }
};
