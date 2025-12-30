import React, { useState, useEffect } from "react";
import {
  Package,
  Edit2,
  Trash2,
  MapPin,
  ArrowUp,
  ArrowDown,
  X,
  FileText,
  MessageCircle
} from "lucide-react";
import {
  extractCity,
  getStatusColor,
  getTypeColor,
} from "../utils/dataUtils";
import {
  formatDateWithDays,
  calculateShowroomDays,
  calculateWorkshopDays,
  calculateDeliveryTime,
  formatDate,
} from "../utils/dateUtils";

// ----- Workshop Timeline -----
const renderWorkshopTimeline = (order) => {
  const workshopDays = calculateWorkshopDays(
    order.sentToWorkshopDate,
    order.returnedFromWorkshopDate
  );

  return (
    <div className="text-xs leading-tight">
      <div className="flex items-center gap-1">
        <span className="text-gray-400">sent:</span>
        <span>{order.sentToWorkshopDate ? formatDate(order.sentToWorkshopDate) : "-"}</span>
      </div>

      <div className="flex items-center gap-1 mt-1">
        <span className="text-gray-400">recv:</span>
        <span>{order.returnedFromWorkshopDate ? formatDate(order.returnedFromWorkshopDate) : "-"}</span>
      </div>

      {workshopDays !== null && (
        <div className="mt-1 text-xs font-medium text-yellow-700">
          {workshopDays} days in workshop
        </div>
      )}

      {order.type === "Repair" && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          {order.karigarName && (
            <div className="text-xs text-orange-700 font-medium">
              Karigar: {order.karigarName}
            </div>
          )}
          {order.repairCourierCharges && (
            <div className="text-xs text-gray-600 mt-1">
              Courier: ₹{order.repairCourierCharges}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ----- Sortable Header -----
const SortableHeader = ({
  column,
  children,
  className = "",
  sortBy,
  sortDirection,
  handleColumnSort,
}) => {
  const isActive = sortBy === column;

  return (
    <th
      className={`px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 transition-colors ${className}`}
      onClick={() => handleColumnSort(column)}
    >
      <div className="flex items-center gap-1">
        <span>{children}</span>
        {isActive &&
          (sortDirection === "desc" ? (
            <ArrowDown size={14} className="text-indigo-600" />
          ) : (
            <ArrowUp size={14} className="text-indigo-600" />
          ))}
      </div>
    </th>
  );
};

// ----- Skeleton Row -----
const SkeletonRow = () => (
  <tr className="animate-pulse">
    {[...Array(11)].map((_, i) => (
      <td key={i} className="px-4 py-4 whitespace-nowrap">
        {i === 0 ? (
          <div className="w-10 h-10 bg-gray-200 rounded-lg"></div>
        ) : (
          <div className="h-4 bg-gray-200 rounded max-w-[90%]"></div>
        )}
      </td>
    ))}
  </tr>
);

// ----- Tracking Modal -----
const TrackingModal = ({ awb, html, isLoading, onClose }) => {
  if (!awb) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">
            Tracking Details: {awb}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 overflow-auto flex-1">
          {isLoading ? (
            <div className="flex justify-center items-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : html ? (
            <div
              className="tracking-content prose max-w-none"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <p className="text-center text-gray-500">No tracking details found.</p>
          )}
        </div>
      </div>
    </div>
  );
};

// --------------------------------------------------------------------------------
// MAIN TABLE COMPONENT
// --------------------------------------------------------------------------------

const DashboardTable = ({
  orders,
  handleEdit,
  handleDelete,
  sortBy,
  sortDirection,
  handleColumnSort,
  isLoading,
  authHeaders
}) => {
  const rowsToRender =
    isLoading && orders.length === 0 ? 5 : orders.length;

  const [selectedImage, setSelectedImage] = useState(null);

  // Tracking State
  const [trackingAwb, setTrackingAwb] = useState(null);
  const [trackingHtml, setTrackingHtml] = useState(null);
  const [isTrackingLoading, setIsTrackingLoading] = useState(false);

  const handleTrackOrder = async (awb) => {
    setTrackingAwb(awb);
    setIsTrackingLoading(true);
    setTrackingHtml(null);

    try {
      const response = await fetch('/api/track-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ awb })
      });
      const html = await response.text();
      setTrackingHtml(html);
    } catch (error) {
      console.error("Tracking failed", error);
      setTrackingHtml("<p class='text-red-600'>Failed to load tracking info.</p>");
    } finally {
      setIsTrackingLoading(false);
    }
  };

  const handleInvoice = async (order) => {
    const invoiceUrl = `${window.location.origin}/api/orders/${order.id}/invoice`;

    // Mobile share (WhatsApp, etc.)
    if (navigator.share) {
      try {
        const response = await fetch(invoiceUrl, {
          headers: authHeaders,
        });

        const blob = await response.blob();

        const file = new File([blob], `invoice-${order.id}.pdf`, {
          type: "application/pdf",
        });

        // Extra safety check
        if (navigator.canShare && !navigator.canShare({ files: [file] })) {
          throw new Error("File sharing not supported");
        }

        await navigator.share({
          title: "Invoice",
          text: "Invoice PDF",
          files: [file],
        });

        return;
      } catch (err) {
        console.error("Share failed, falling back to open PDF", err);
      }
    }

    // Desktop / fallback
    window.open(invoiceUrl, "_blank");
  };

  const handleMobileClick = (order) => {
    if (!order.mobile) return;

    let cleanMobile = order.mobile.replace(/\D/g, '');
    if (cleanMobile.startsWith('0')) cleanMobile = cleanMobile.slice(1);
    if (cleanMobile.length === 10) cleanMobile = '91' + cleanMobile;

    const message = `Hi ${order.firstName}, attaching your invoice below`;
    const waUrl = `https://wa.me/${cleanMobile}?text=${encodeURIComponent(message)}`;

    window.open(waUrl, '_blank');
  };


  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setSelectedImage(null);
        setTrackingAwb(null);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  return (
    <>
      <div className="bg-white rounded-lg shadow overflow-hidden relative">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Photo
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Customer
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>

                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase lg:hidden">
                  Delivery / Address
                </th>

                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">
                  Address
                </th>

                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">
                  Payment
                </th>

                <SortableHeader
                  column="orderReceivedDate"
                  className="hidden xl:table-cell"
                  {...{ sortBy, sortDirection, handleColumnSort }}
                >
                  Order Received
                </SortableHeader>

                <SortableHeader
                  column="sentToWorkshopDate"
                  className="hidden xl:table-cell"
                  {...{ sortBy, sortDirection, handleColumnSort }}
                >
                  Workshop Timeline
                </SortableHeader>

                <SortableHeader
                  column="returnedFromWorkshopDate"
                  className="hidden xl:table-cell"
                  {...{ sortBy, sortDirection, handleColumnSort }}
                >
                  In Showroom Since
                </SortableHeader>

                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="bg-white divide-y divide-gray-200">
              {isLoading && orders.length === 0 ? (
                [...Array(rowsToRender)].map((_, i) => (
                  <SkeletonRow key={i} />
                ))
              ) : (
                orders.map((order) => {
                  const status =
                    order.status ||
                    (order.collectedByCustomerDate
                      ? "Delivered"
                      : order.returnedFromWorkshopDate
                        ? "Ready for Pickup"
                        : order.sentToWorkshopDate
                          ? "In Workshop"
                          : "Order Received");

                  const showroomDays = calculateShowroomDays(
                    order.returnedFromWorkshopDate,
                    order.collectedByCustomerDate
                  );

                  const {
                    formatted: receivedDate,
                    days: receivedDays,
                  } = formatDateWithDays(order.orderReceivedDate);

                  return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      {/* PHOTO */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        {order.photoUrl ? (
                          <img
                            src={order.photoUrl}
                            alt="Jewelry"
                            onClick={() =>
                              setSelectedImage(order.photoUrl)
                            }
                            className="w-10 h-10 object-cover rounded-lg border border-gray-200 cursor-pointer hover:opacity-80 transition"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                            <Package
                              size={18}
                              className="text-gray-400"
                            />
                          </div>
                        )}
                      </td>

                      {/* ID */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-gray-900">
                          #{order.id}
                        </div>
                      </td>

                      {/* TYPE + AWB */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded ${getTypeColor(
                            order.type
                          )}`}
                        >
                          {order.type}
                        </span>

                        {/* --- AWB BELOW TYPE --- */}
                        {order.type === "Delivery" && order.trackingNumber && (
                          <div
                            onClick={() => handleTrackOrder(order.trackingNumber)}
                            className="text-xs text-blue-600 mt-1 cursor-pointer hover:underline flex items-center gap-1"
                            title="Click to Track"
                          >
                            AWB: {order.trackingNumber}
                          </div>
                        )}
                      </td>

                      {/* CUSTOMER */}
                      <td className="px-4 py-4">
                        <div className="text-sm font-medium text-gray-900">
                          {order.firstName} {order.lastName}
                        </div>
                        <div
                          className="text-xs text-blue-600 mt-1 cursor-pointer hover:underline flex items-center gap-1"
                          onClick={() => handleMobileClick(order)}
                          title="Chat on WhatsApp"
                        >
                          <MessageCircle size={10} />
                          {order.mobile}
                        </div>
                      </td>

                      {/* STATUS */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span
                          className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getStatusColor(
                            status
                          )}`}
                        >
                          {status}
                        </span>
                      </td>

                      {/* DELIVERY (MOBILE) */}
                      <td className="px-4 py-4 lg:hidden">
                        {order.type === "Delivery" &&
                          order.shippingDate ? (
                          <div className="text-xs">
                            <div className="font-semibold text-purple-700 flex items-center gap-1">
                              <MapPin size={12} />
                              {extractCity(order.address)}
                            </div>
                            <div
                              onClick={(e) => { e.stopPropagation(); handleTrackOrder(order.trackingNumber); }}
                              className="text-blue-600 mt-1 cursor-pointer hover:underline"
                            >
                              {order.trackingNumber}
                            </div>

                            <div className="text-gray-500">
                              {(() => {
                                const deliveryInfo =
                                  calculateDeliveryTime(
                                    order.shippingDate,
                                    order.collectedByCustomerDate
                                  );
                                if (!deliveryInfo)
                                  return "-";
                                return `${deliveryInfo.days} days ${deliveryInfo.status}`;
                              })()}
                            </div>
                          </div>
                        ) : (
                          <div
                            className="text-xs text-gray-500"
                            title={order.address}
                          >
                            {extractCity(order.address)}
                            <span className="text-gray-400">
                              {" "}
                              (Tap for full address)
                            </span>
                          </div>
                        )}
                      </td>

                      {/* ADDRESS */}
                      <td className="px-4 py-4 hidden lg:table-cell">
                        <div className="text-sm text-gray-600 max-w-xs">
                          {order.address}
                        </div>
                      </td>

                      {/* PAYMENT */}
                      <td className="px-4 py-4 hidden md:table-cell">
                        <div className="text-sm font-semibold text-gray-900">
                          ₹{order.totalAmount?.toLocaleString()}
                        </div>
                        <div className="text-xs text-green-600">
                          Adv: ₹{order.advancePaid?.toLocaleString()}
                        </div>
                        <div className="text-xs text-red-600">
                          Bal: ₹{order.remainingAmount?.toLocaleString()}
                        </div>
                      </td>

                      {/* ORDER RECEIVED */}
                      <td className="px-4 py-4 hidden xl:table-cell">
                        <div>
                          <div className="text-xs font-medium">
                            {receivedDate}
                          </div>
                          <div className="text-xs text-gray-500">
                            {receivedDays} days ago
                          </div>
                        </div>
                      </td>

                      {/* WORKSHOP */}
                      <td className="px-4 py-4 hidden xl:table-cell">
                        {renderWorkshopTimeline(order)}
                      </td>

                      {/* SHOWROOM */}
                      <td className="px-4 py-4 hidden xl:table-cell">
                        <div className="text-sm font-medium text-gray-900">
                          {showroomDays !== null
                            ? `${Math.abs(showroomDays)} days`
                            : "-"}
                        </div>
                      </td>

                      {/* ACTIONS */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex gap-2">
                          {/* Invoice Button (Repairs Only) */}
                          {order.type === 'Repair' && (
                            <button
                              onClick={() => handleInvoice(order)}
                              className="text-indigo-600 hover:text-indigo-800"
                              title="View/Download Invoice PDF"
                            >
                              <FileText size={16} />
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(order)}
                            className="text-blue-600 hover:text-blue-800"
                            title="Edit"
                          >
                            <Edit2 size={16} />
                          </button>

                          <button
                            onClick={() => handleDelete(order.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!isLoading && orders.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No orders found matching your criteria
          </div>
        )}

        {selectedImage && (
          <div
            className="fixed inset-0 bg-black bg-opacity-70 backdrop-blur-sm flex items-center justify-center z-50 p-4 cursor-pointer"
            onClick={() => setSelectedImage(null)}
          >
            <div
              className="relative max-w-[90vw] max-h-[90vh] cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setSelectedImage(null)}
                className="absolute -top-3 -right-3 bg-white rounded-full p-1 shadow hover:bg-gray-100"
              >
                <X size={20} />
              </button>

              <img
                src={selectedImage}
                alt="Full view"
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-xl"
              />
            </div>
          </div>
        )}
      </div>

      {trackingAwb && (
        <TrackingModal
          awb={trackingAwb}
          html={trackingHtml}
          isLoading={isTrackingLoading}
          onClose={() => setTrackingAwb(null)}
        />
      )}
    </>
  );
};

export default DashboardTable;
