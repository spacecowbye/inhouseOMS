import PDFDocument from 'pdfkit';

/**
 * Generates an invoice PDF for a given order and returns it as a Buffer.
 */
export async function generateInvoiceBuffer(order) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const chunks = [];

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', err => reject(err));

            // --- LOAD FONTS ---
            let cursiveFont = 'Times-Italic';
            try {
                const fontResp = await fetch('https://github.com/google/fonts/raw/main/ofl/greatvibes/GreatVibes-Regular.ttf');
                if (fontResp.ok) {
                    const fontBuffer = await fontResp.arrayBuffer();
                    doc.registerFont('GreatVibes', Buffer.from(fontBuffer));
                    cursiveFont = 'GreatVibes';
                }
            } catch (e) {
                console.warn("Could not load custom font, using fallback.");
            }

            // --- HEADER BACKGROUND ---
            doc.rect(0, 0, 595.28, 140).fill('#4a4a4a');

            // --- HEADER CONTENT ---
            doc.fillColor('white');
            doc.fontSize(10).font('Helvetica-Bold').text('(M): 9227219475 || 9227219475', 50, 30);
            
            doc.fontSize(9).font('Helvetica').fillColor('#f9c74f')
               .text('4 & 5, Ground Flr. Titanium City Center Mall,', 50, 45)
               .text('Opp.Seema Hall, Near Sachin Tower,', 50, 58)
               .text('Shyamal Prahladnagar Road,', 50, 71)
               .text('Satellite, Ahmedabad - 380015.', 50, 84)
               .fillColor('white');
            
            doc.text('GSTIN No.: 24AAFPS8301R1Z7', 50, 100);

            // Right Side: Logo
            doc.fillColor('white');
            doc.fontSize(40).font(cursiveFont).text("Deepa's", 350, 30, { align: 'right', width: 195 });
            doc.fontSize(10).font('Helvetica').fillColor('#f9c74f')
               .text("customized silver jewellery", 350, 75, { align: 'right', width: 195 });
            doc.fontSize(8).fillColor('white').text("Appointment Preferable", 350, 88, { align: 'right', width: 195 });

            // Reset Fill Color
            doc.fillColor('black');

            // Title
            const title = (order.type || 'REPAIR').toUpperCase() + ' INVOICE';
            doc.fontSize(16).font('Helvetica-Bold').text(title, 0, 160, { align: 'center', width: 595.28 });
            
            const currentY = 190;
            doc.moveTo(50, currentY).lineTo(545, currentY).strokeColor('#cccccc').stroke();

            // Customer Info
            const infoY = currentY + 15;
            const dateStr = new Date().toISOString().split('T')[0].split('-').reverse().join('/');
            
            doc.fontSize(10).font('Helvetica-Bold').text('Name:', 50, infoY);
            doc.font('Helvetica').text(`${order.firstName} ${order.lastName || ''}`, 100, infoY);
            doc.font('Helvetica-Bold').text('Address:', 50, infoY + 15);
            doc.font('Helvetica').text((order.address || '').substring(0, 40), 100, infoY + 15);
            doc.font('Helvetica-Bold').text('Mobile:', 50, infoY + 30);
            doc.font('Helvetica').text(order.mobile || '', 100, infoY + 30);

            doc.font('Helvetica-Bold').text('ORIGINAL', 400, infoY);
            doc.text('Invoice No.:', 400, infoY + 15);
            doc.font('Helvetica').text(`R-${order.id}`, 470, infoY + 15);
            doc.font('Helvetica-Bold').text('Date:', 400, infoY + 30);
            doc.font('Helvetica').text(dateStr, 470, infoY + 30);

            const tableTop = infoY + 55;
            doc.moveTo(50, tableTop).lineTo(545, tableTop).strokeColor('#cccccc').stroke();

            // Table Header
            doc.rect(50, tableTop, 495, 25).fill('#f0f0f0');
            doc.fillColor('black');

            const thY = tableTop + 8;
            doc.font('Helvetica-Bold').fontSize(10);
            doc.text('Sr.', 50, thY, { width: 30, align: 'center' });
            doc.text('Image', 90, thY, { width: 120, align: 'center' });
            doc.text('Description', 220, thY, { width: 220, align: 'left' });
            doc.text('Amount', 450, thY, { width: 90, align: 'right' });

            const rowTop = tableTop + 25;
            let rowY = rowTop + 15;
            const formatDisp = (val) => (val === -1) ? 'To Be Determined' : (val || 0).toLocaleString('en-IN');

            doc.font('Helvetica').fontSize(10);
            doc.text('1', 50, rowY, { width: 30, align: 'center' });

            if (order.photoUrl) {
                try {
                    const imgResp = await fetch(order.photoUrl);
                    if (imgResp.ok) {
                        const imgBuffer = await imgResp.arrayBuffer();
                        doc.image(Buffer.from(imgBuffer), 100, rowY, { fit: [100, 100], align: 'center' });
                    }
                } catch (e) {
                    doc.text('[Image Error]', 90, rowY, { width: 120, align: 'center' });
                }
            } else {
                 doc.text('[No Image]', 90, rowY, { width: 120, align: 'center' });
            }

            doc.text(order.notes || 'Repair Work', 220, rowY, { width: 220 });
            doc.text(formatDisp(order.totalAmount), 450, rowY, { width: 90, align: 'right' });

            const rowHeight = 120;
            const totalRowY = rowY + rowHeight;
            doc.moveTo(50, totalRowY).lineTo(545, totalRowY).strokeColor('#cccccc').stroke();

            // Breakdown
            const footerY = totalRowY + 15;
            const drawBreakdownRow = (label, value, y, isBold = false) => {
                if(isBold) doc.font('Helvetica-Bold'); else doc.font('Helvetica');
                doc.text(label, 350, y, { width: 100, align: 'left' });
                doc.text(value, 450, y, { width: 90, align: 'right' });
            };

            drawBreakdownRow('Subtotal', formatDisp(order.totalAmount), footerY, true);
            doc.moveTo(350, footerY + 12).lineTo(540, footerY + 12).stroke();
            drawBreakdownRow('Advance', formatDisp(order.advancePaid), footerY + 20);
            drawBreakdownRow('Balance', formatDisp(order.remainingAmount), footerY + 35, true);

            // Stamp
            if (order.collectedByCustomerDate) {
                doc.save();
                const stampText = 'PAID AND DELIVERED';
                doc.fontSize(50).font('Helvetica-Bold');
                const textWidth = doc.widthOfString(stampText);
                const textHeight = doc.currentLineHeight();
                
                doc.translate(297, 420);
                doc.rotate(-25);
                doc.rect(-textWidth/2 - 10, -textHeight/2 - 10, textWidth + 20, textHeight + 20).lineWidth(4).strokeColor('red').strokeOpacity(0.3).stroke();
                doc.fillColor('red').fillOpacity(0.3).text(stampText, -textWidth / 2, -textHeight / 2);
                doc.restore();
            }

            doc.fontSize(8).font('Helvetica-Oblique').text('This is an Electronically Generated Invoice.', 50, 750, { align: 'center', width: 500 });
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}
