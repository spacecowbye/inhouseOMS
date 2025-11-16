// src/utils/dataUtils.js

export const extractCity = (address) => {
    if (!address) return "N/A";
    const parts = address.split(',').map(p => p.trim()).filter(p => p.length > 0);
    // Tries to get the penultimate part, or the last part as a fallback
    return parts.length > 1 ? parts[parts.length - 2] : parts[parts.length - 1];
};

export const getStatus = (order) => {
    if (order.collectedByCustomerDate) return "Delivered";
    if (order.returnedFromWorkshopDate) return "Ready for Pickup";
    if (order.sentToWorkshopDate) return "In Workshop";
    return "Order Received";
};

export const getStatusColor = (status) => {
    switch (status) {
        // ... (Status color definitions, copied from original component)
        case "Order Received":
            return "bg-purple-100 text-purple-800 border-purple-300";
        case "In Workshop":
            return "bg-yellow-100 text-yellow-800 border-yellow-300";
        case "Ready for Pickup":
            return "bg-green-100 text-green-800 border-green-300";
        case "Delivered":
            return "bg-gray-100 text-gray-800 border-gray-300";
        default:
            return "bg-gray-100 text-gray-800 border-gray-300";
    }
};

export const getTypeColor = (type) => {
    // ... (Type color definitions, copied from original component)
    switch (type) {
        case "Order":
            return "bg-blue-100 text-blue-800";
        case "Repair":
            return "bg-orange-100 text-orange-800";
        case "Delivery":
            return "bg-purple-100 text-purple-800";
        default:
            return "bg-gray-100 text-gray-800";
    }
};

export const calculateStats = (orders) => {
    const stats = {
        total: 0, received: 0, inWorkshop: 0, ready: 0, delivered: 0,
    };
    orders.forEach(o => {
        const status = getStatus(o);
        if (o.collectedByCustomerDate) {
            stats.delivered++;
        } else {
            stats.total++;
            if (status === "Order Received") stats.received++;
            if (status === "In Workshop") stats.inWorkshop++;
            if (status === "Ready for Pickup") stats.ready++;
        }
    });
    return stats;
};