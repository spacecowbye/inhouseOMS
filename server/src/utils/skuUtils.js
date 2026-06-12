export function generateSkuId(db, callback) {
    db.get("SELECT COUNT(*) as count FROM polki_inventory", (err, row) => {
        const seq = String((row?.count || 0) + 1).padStart(4, '0');
        const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
            .format(new Date())
            .replace(/-/g, '');
        callback(`POLKI-${dateStr}-${seq}`);
    });
}
