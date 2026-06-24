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

/**
 * Uses Gemini API to perform multimodal OCR extraction of delivery details from an image buffer.
 * Returns a JSON object with name, mobile, address, pincode, total, advance, awb, and notes.
 */
export async function extractDeliveryDetailsFromImage(buffer, contentType) {
    const maxRetries = 3;
    let delay = 1000; // start with 1 second delay

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey || apiKey === 'your_gemini_api_key_here') {
                console.error('[OCR] Gemini API key not configured.');
                return null;
            }

            const base64Image = buffer.toString('base64');
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

            const prompt = `Extract delivery details from this shipping label, receipt, handwritten address slip, or order image.
Return a JSON object with the following fields:
- 'is_blurry' (boolean, set to true if the image is too blurry, dark, out of focus, low-resolution, or contains no readable/extractable text; otherwise false)
- 'name' (string, full name of the recipient/customer)
- 'mobile' (string, phone/mobile number, clean of spaces/dashes, ideally 10 digits. IMPORTANT: Do NOT extract '9376871164', '937871164', or '9227219475' as the mobile number. Those are sender/shop numbers. Look for the other 10-digit number representing the recipient/customer.)
- 'address' (string, full shipping address; if a postal code is present in the image, ensure it is included here)
- 'pincode' (string, postal code / zip code / pincode extracted from the address)
- 'total' (number or null, total amount to be paid or value if visible)
- 'advance' (number or null, advance paid if visible)
- 'awb' (string or null, courier/tracking number if visible. Note: The AWB is typically located near a barcode.)
- 'notes' (string or null, any other delivery or order notes)`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: prompt },
                                {
                                    inlineData: {
                                        mimeType: contentType || 'image/jpeg',
                                        data: base64Image
                                    }
                                }
                            ]
                        }
                    ],
                    generationConfig: {
                        responseMimeType: "application/json"
                    }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.warn(`[OCR] Gemini API HTTP error (Attempt ${attempt}/${maxRetries}): ${response.status}`, errText);
                
                // If transient capacity spike (503) or rate limit (429), retry after a delay
                if ((response.status === 503 || response.status === 429) && attempt < maxRetries) {
                    console.log(`[OCR] Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // exponential backoff
                    continue;
                }
                return null;
            }

            const resData = await response.json();
            const responseText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!responseText) {
                console.error('[OCR] Empty response from Gemini API.');
                return null;
            }

            console.log('[OCR GEMINI RAW]', responseText);
            return JSON.parse(responseText.trim());

        } catch (err) {
            console.error(`[OCR] Gemini error (Attempt ${attempt}/${maxRetries}):`, err);
            if (attempt < maxRetries) {
                console.log(`[OCR] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }
            return null;
        }
    }
    return null;
}
