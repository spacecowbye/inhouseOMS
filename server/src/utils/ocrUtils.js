import Tesseract from 'tesseract.js';

/**
 * Attempts to extract a price integer from an image buffer using Tesseract OCR.
 * Run this on the RAW buffer BEFORE any Sharp processing.
 * Returns an integer (e.g. 45000) or null if no price found.
 */
export async function extractPriceFromImage(buffer) {
    try {
        const { data: { text } } = await Tesseract.recognize(buffer, 'eng', {
            tessedit_char_whitelist: '0123456789₹Rs.,/ ',
        });

        console.log('[OCR RAW]', text); // Keep during development to tune regex

        const priceMatch = text.match(/[₹Rs\.]*\s*([\d,]+)/i);
        if (priceMatch) {
            const parsed = parseInt(priceMatch[1].replace(/,/g, ''));
            if (!isNaN(parsed) && parsed > 0) return parsed;
        }
        return null;
    } catch (err) {
        console.error('[OCR] Tesseract error:', err);
        return null;
    }
}
