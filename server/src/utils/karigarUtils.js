/**
 * Utilities for Karigar repair serial generation and command parsing
 */

export function getKarigarPrefix(name) {
    if (!name) return 'KAR';
    // Remove non-alphabetic characters and take first 3 letters in uppercase
    const clean = name.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (clean.length === 0) return 'KAR';
    return clean.slice(0, 3);
}

/**
 * Generates next sequential serial number for a Karigar, e.g. HEM1, HEM2
 * @param {import('sqlite3').Database} db
 * @param {string} karigarName
 * @returns {Promise<string>}
 */
export function generateKarigarSerialNumber(db, karigarName) {
    return new Promise((resolve, reject) => {
        const prefix = getKarigarPrefix(karigarName);
        const query = "SELECT serial_number FROM karigar_repairs WHERE UPPER(serial_number) LIKE ?";
        
        db.all(query, [`${prefix}%`], (err, rows) => {
            if (err) return reject(err);

            let maxNum = 0;
            const regex = new RegExp(`^${prefix}(\\d+)$`, 'i');

            if (rows && rows.length > 0) {
                for (const row of rows) {
                    const match = (row.serial_number || '').trim().match(regex);
                    if (match) {
                        const num = parseInt(match[1], 10);
                        if (!isNaN(num) && num > maxNum) {
                            maxNum = num;
                        }
                    }
                }
            }

            const nextSerial = `${prefix}${maxNum + 1}`;
            resolve(nextSerial);
        });
    });
}

/**
 * Parses /kr command parameters from message text.
 * Examples:
 *   "/kr Hemant"           -> { karigarName: "Hemant", count: 1, orderRef: "", notes: "" }
 *   "/kr Hemant 3"         -> { karigarName: "Hemant", count: 3, orderRef: "", notes: "" }
 *   "/kr Hemant, 3, #1042" -> { karigarName: "Hemant", count: 3, orderRef: "1042", notes: "#1042" }
 *   "/kr Hemant 3 #1042"   -> { karigarName: "Hemant", count: 3, orderRef: "1042", notes: "#1042" }
 *   "/kr Babu Bhai 2"      -> { karigarName: "Babu Bhai", count: 2, orderRef: "", notes: "" }
 */
export function parseKarigarCommand(text) {
    // Strip leading /kr or /krrepair
    const raw = text.replace(/^\/kr\w*\s*/i, '').trim();
    if (!raw) {
        return { karigarName: '', count: 1, orderRef: '', notes: '' };
    }

    // Check if comma-separated format
    if (raw.includes(',')) {
        const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
        const karigarName = parts[0] || '';
        let count = 1;
        let orderRef = '';
        let notes = '';

        for (let i = 1; i < parts.length; i++) {
            const part = parts[i];
            const num = parseInt(part, 10);
            // If it's a small integer 1..20 and count hasn't been set yet
            if (!isNaN(num) && num >= 1 && num <= 20 && count === 1 && !part.includes('#') && !part.toLowerCase().includes('inv')) {
                count = num;
            } else if (part.match(/#?(\d{2,8})/)) {
                const match = part.match(/#?(\d{2,8})/);
                orderRef = match[1];
                notes = notes ? `${notes}, ${part}` : part;
            } else {
                notes = notes ? `${notes}, ${part}` : part;
            }
        }

        return { karigarName, count, orderRef, notes };
    }

    // Space-separated format, e.g. "Hemant 3" or "Hemant 3 #1042" or "Babu Bhai 2"
    const tokens = raw.split(/\s+/);
    let count = 1;
    let orderRef = '';
    let notes = '';
    const nameTokens = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const num = parseInt(token, 10);

        // Check if token is an explicit photo count: e.g. "3" or "2"
        if (/^\d{1,2}$/.test(token) && num >= 1 && num <= 20 && count === 1 && nameTokens.length > 0) {
            count = num;
        } else if (/^#?\d{3,8}$/.test(token) || token.toLowerCase().startsWith('inv')) {
            const clean = token.replace(/[^0-9]/g, '');
            if (clean) orderRef = clean;
            notes = notes ? `${notes} ${token}` : token;
        } else if (count > 1 || orderRef) {
            // Already seen count or orderRef, rest is notes
            notes = notes ? `${notes} ${token}` : token;
        } else {
            nameTokens.push(token);
        }
    }

    const karigarName = nameTokens.join(' ').trim();
    return { karigarName, count, orderRef, notes };
}
