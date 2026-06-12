# inhouseOMS: Project Overview

An elegant, internal Order Management System (OMS) built for **Deepa's Customized Silver Jewellery** to streamline repair jobs, custom orders, deliveries, and video call appointments. 

---

## 🏗️ Architecture & Stack

The application is split into a client-server architecture, fully containerized using Docker:

- **Client (Frontend)**: React + Vite + Tailwind CSS. Provides a rich dashboard displaying order metrics, search/filter capabilities, status transitions, and a calendar slot booker.
- **Server (Backend)**: Express.js (Node.js) serving REST APIs and handling external webhooks.
- **Database**: SQLite3 (`jewelry_orders.db`) for lightweight, transaction-safe storage.
- **Object Storage**: AWS S3 client integration to host order reference photos (uploaded via Dashboard or Twilio MMS) and generated PDF invoices.
- **External Integrations**:
  - **Twilio API**: Powering outbound and inbound WhatsApp communications.
  - **PDFKit**: Dynamically building beautiful, print-ready PDF invoices.
  - **Sharp**: Pre-processing, compressing, and converting HEIC/HEIF uploaded images into standard web-compatible JPEGs.

---

## 🗄️ Database Schema

The database uses SQLite3. It has two main tables:

### 1. `orders` Table
Stores all repair, order, and delivery entries.
```sql
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName TEXT,
    lastName TEXT,
    address TEXT,
    mobile TEXT,
    advancePaid INTEGER,
    remainingAmount INTEGER,
    totalAmount INTEGER,
    orderReceivedDate TEXT,
    sentToWorkshopDate TEXT,
    returnedFromWorkshopDate TEXT,
    collectedByCustomerDate TEXT,
    type TEXT,                 -- 'Order', 'Repair', or 'Delivery'
    trackingNumber TEXT,       -- AWB tracking ID (Trackon, Mahavir, or UPS)
    shippingDate TEXT,
    photoUrl TEXT,             -- S3 Public URL to image
    karigarName TEXT,          -- Karigar responsible for repairs
    repairCourierCharges INTEGER,
    notes TEXT
);
```

### 2. `appointments` Table
Stores booked video calling slots.
```sql
CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName TEXT,
    lastName TEXT,
    mobile TEXT,
    date TEXT,                 -- Format: YYYY-MM-DD
    time TEXT,                 -- Normalized HH:MM display
    slotIndex INTEGER,         -- Index corresponding to 30-minute block (0-17)
    creatorNumber TEXT,        -- WhatsApp sender who booked the slot
    notes TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 💬 WhatsApp Integration & Bot Commands

The backend exposes `/api/whatsapp-webhook` which listens to incoming Twilio webhooks. Staff can execute commands directly inside a WhatsApp chat to create orders, book calls, check slot availability, or generate invoices.

### Commands Reference

| Command | Usage / Format | Description / Example |
| :--- | :--- | :--- |
| **`/help`** | `/help [repair \| delivery \| appointment]` | Returns general instructions or format details for a specific command type. |
| **`/order`** | `/order Name, Mobile, Address, Total, Advance, Notes` | Creates a new order entry and responds with a draft invoice. |
| **`/repair`** | `/repair Name, Mobile, Address, Total, Advance, Karigar, Notes` | Creates a repair order (usually with an attached image) and sends back a PDF invoice link. |
| **`/delivery`** | `/delivery Name, Mobile, Address, Total, Advance, AWB, Notes` | Creates a delivery entry. Auto-detects UPS and Trackon/Mahavir tracking numbers. |
| **`/generate`** | `/generate <ID>` | Re-generates a clean PDF invoice for the given order ID and uploads it to AWS S3. |
| **`/rc`** | `/rc <ID>` | **Repair Collected**: Marks order as collected/delivered today and returns an S3 link to the stamped PAID PDF. |
| **`/a`** | `/a Name, Mobile, Time, Notes, [Date]` | Books a video call appointment slot for **today** (or a specified `DD-MM` date). |
| **`/at`** | `/at Name, Mobile, Time, Notes` | Books a video call appointment slot for **tomorrow**. |
| **`/slots`** | `/slots [tomorrow]` | Lists all available free slots and booked slots. |
| **`/reschedule`**| `/reschedule <Time> [tomorrow]` | Clears the appointment booked at the specified time, freeing it up for re-booking. |

> [!IMPORTANT]
> Detail parameters must be separated by commas (`,`).
> Appointment time slots are strict 30-minute blocks between **11:00 AM and 08:00 PM** (mapped as indices `0` through `17`).

---

## 🕒 Video Call Slot & Reminder System

- Appointments are stored using `slotIndex` (0 to 17) to prevent double-booking.
- An in-memory scheduling daemon (`initReminders`) triggers reminders:
  1. Checks database on start (or on booking) for slots scheduled today/tomorrow.
  2. Dispatches a WhatsApp notification to the customer & creator **exactly 10 minutes** before the call starts.
  3. Provides the staff member with a direct WhatsApp API deep-link (`https://wa.me/...`) to message the customer with a single click.

---

## 📄 PDF Invoice Generator

The invoice generator uses `pdfkit` to build professional A4 invoices:
1. **Branding**: Dynamic header with Deepa's store address, contact numbers, GSTIN, and store logo using the custom *GreatVibes* script font fetched from Google Fonts.
2. **Visual Items**: Displays item description, totals, and embeds the reference image hosted on AWS S3 directly in the table row.
3. **Stamped State**: When an order is completed (via `/rc` command or when `collectedByCustomerDate` is present), the PDF generator dynamically overlays a rotated, transparent **RED ink stamp** saying `PAID AND DELIVERED` along with the exact collection date.

---

## 🚚 Carrier Integration (Proxy Tracker)

The tracking system supports three major carriers and falls back gracefully:
1. **UPS (International)**: If the AWB matches `/^1Z/i`, it bypasses web scrapes (due to heavy bot protection) and serves a styled, premium tracking card containing direct deep links to UPS, AfterShip, and ParcelsApp.
2. **Trackon (Domestic)**: Attempts to fetch tracking details from Trackon's status portal. Filters out redundant columns (such as transaction IDs) and fixes relative asset paths.
3. **Shree Mahavir Courier**: If Trackon has no data, it scrapes the Mahavir ASP.NET portal by first obtaining landing page viewstate tokens (`__VIEWSTATE`, `__EVENTVALIDATION`) and cookies, then POSTing the tracking requests.
