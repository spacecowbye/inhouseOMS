// src/utils/dateUtils.js

const ONE_DAY = 1000 * 60 * 60 * 24;

export const calculateDays = (dateString) => {
    if (!dateString) return null;
    const today = new Date(new Date().toDateString());
    const targetDate = new Date(new Date(dateString).toDateString());
    const diffTime = today - targetDate;
    return Math.floor(diffTime / ONE_DAY);
};

export const formatDate = (dateString) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    const formatted = date.toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
    });
    const days = calculateDays(dateString);
    return `${formatted} (${days}d ago)`;
};

export const formatDateWithDays = (dateString) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    const formatted = date.toLocaleDateString("en-GB", {
        day: "2-digit", month: "short",
    });
    const days = calculateDays(dateString);
    return { formatted, days };
};

export const calculateShowroomDays = (returnedDate, collectedDate) => {
    if (!returnedDate || collectedDate) return null;
    return calculateDays(returnedDate);
};

export const calculateWorkshopDays = (sentDate, returnedDate) => {
    if (!sentDate) return null;
    const end = returnedDate ? new Date(returnedDate) : new Date();
    const start = new Date(sentDate);
    if (end < start) return 0; // Prevent negative time if dates are entered incorrectly
    const diffTime = end - start;
    return Math.floor(diffTime / ONE_DAY);
}

export const calculateDeliveryTime = (shippingDate, collectedDate) => {
    if (!shippingDate) return null;
    const end = collectedDate ? new Date(collectedDate) : new Date();
    const start = new Date(shippingDate);
    if (end < start) return 0;
    const diffTime = end - start;
    const days = Math.floor(diffTime / ONE_DAY);
    return { days, status: collectedDate ? 'Delivered' : 'In Transit' };
}