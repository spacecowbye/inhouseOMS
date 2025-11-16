import React from 'react';
import { Package, Edit2, Trash2, MapPin, ArrowUp, ArrowDown } from 'lucide-react';
import { extractCity, getStatusColor, getTypeColor } from '../utils/dataUtils';
import { formatDateWithDays, calculateShowroomDays, calculateWorkshopDays, calculateDeliveryTime, formatDate } from '../utils/dateUtils';


// Helper to render workshop timeline
const renderWorkshopTimeline = (order) => {
    const workshopDays = calculateWorkshopDays(order.sentToWorkshopDate, order.returnedFromWorkshopDate);
    return (
      <div className="text-xs leading-tight">
        <div className="flex items-center gap-1">
          <span className="text-gray-400">sent:</span>
          <span>
            {order.sentToWorkshopDate
              ? formatDate(order.sentToWorkshopDate)
              : "-"}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <span className="text-gray-400">recv:</span>
          <span>
            {order.returnedFromWorkshopDate
              ? formatDate(order.returnedFromWorkshopDate)
              : "-"}
          </span>
        </div>
        {workshopDays !== null && (
          <div className="mt-1 text-xs font-medium text-yellow-700">
            {workshopDays} days in workshop
          </div>
        )}
        {/* Repair-specific fields */}
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

// Helper to render sortable header
const SortableHeader = ({ column, children, className = "", sortBy, sortDirection, handleColumnSort }) => {
    const isActive = sortBy === column;
    return (
      <th 
        className={`px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 transition-colors ${className}`}
        onClick={() => handleColumnSort(column)}
      >
        <div className="flex items-center gap-1">
          <span>{children}</span>
          {isActive && (
            sortDirection === "desc" ? (
              <ArrowDown size={14} className="text-indigo-600" />
            ) : (
              <ArrowUp size={14} className="text-indigo-600" />
            )
          )}
        </div>
      </th>
    );
  };

// Skeleton Row Component
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
  
const DashboardTable = ({ orders, handleEdit, handleDelete, sortBy, sortDirection, handleColumnSort, isLoading }) => {
    
  const rowsToRender = isLoading && orders.length === 0 ? 5 : orders.length;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          {/* Table Header */}
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Photo</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase lg:hidden">Delivery / Address</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">Address</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Payment</th>
              
              <SortableHeader column="orderReceivedDate" className="hidden xl:table-cell" {...{sortBy, sortDirection, handleColumnSort}}>Order Received</SortableHeader>
              <SortableHeader column="sentToWorkshopDate" className="hidden xl:table-cell" {...{sortBy, sortDirection, handleColumnSort}}>Workshop Timeline</SortableHeader>
              <SortableHeader column="returnedFromWorkshopDate" className="hidden xl:table-cell" {...{sortBy, sortDirection, handleColumnSort}}>In Showroom Since</SortableHeader>
              
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          
          <tbody className="bg-white divide-y divide-gray-200">
            {/* Render Skeletons during initial load or while fetching */}
            {isLoading && orders.length === 0 ? (
                [...Array(rowsToRender)].map((_, i) => <SkeletonRow key={i} />)
            ) : (
                orders.map((order) => {
                    const status = order.status || (order.collectedByCustomerDate ? "Delivered" : order.returnedFromWorkshopDate ? "Ready for Pickup" : order.sentToWorkshopDate ? "In Workshop" : "Order Received");
                    const showroomDays = calculateShowroomDays(order.returnedFromWorkshopDate, order.collectedByCustomerDate);
                    const { formatted: receivedDate, days: receivedDays } = formatDateWithDays(order.orderReceivedDate);

                    return (
                        <tr key={order.id} className="hover:bg-gray-50">
                            {/* Photo */}
                            <td className="px-4 py-4 whitespace-nowrap">
                                {order.photoUrl ? (
                                    <img src={order.photoUrl} alt="Jewelry" className="w-10 h-10 object-cover rounded-lg border border-gray-200" />
                                ) : (
                                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                                        <Package size={18} className="text-gray-400" />
                                    </div>
                                )}
                            </td>
                            {/* ID */}
                            <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm font-bold text-gray-900">#{order.id}</div>
                            </td>
                            {/* Type */}
                            <td className="px-4 py-4 whitespace-nowrap">
                                <span className={`px-2 py-1 text-xs font-medium rounded ${getTypeColor(order.type)}`}>
                                    {order.type}
                                </span>
                            </td>
                            {/* Customer */}
                            <td className="px-4 py-4">
                                <div className="text-sm font-medium text-gray-900">{order.firstName} {order.lastName}</div>
                                <div className="text-xs text-gray-500 mt-1">{order.mobile}</div>
                            </td>
                            
                            {/* Status */}
                            <td className="px-4 py-4 whitespace-nowrap">
                                <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getStatusColor(status)}`}>
                                    {status}
                                </span>
                            </td>

                            {/* Delivery/Address (Mobile/Tablet View) */}
                            <td className="px-4 py-4 lg:hidden">
                                {order.type === "Delivery" && order.shippingDate ? (
                                    <div className="text-xs">
                                        <div className="font-semibold text-purple-700 flex items-center gap-1">
                                            <MapPin size={12} />
                                            {extractCity(order.address)}
                                        </div>
                                        <div className="text-gray-600 mt-1">{order.trackingNumber}</div>
                                        <div className="text-gray-500">
                                            {(() => {
                                                const deliveryInfo = calculateDeliveryTime(order.shippingDate, order.collectedByCustomerDate);
                                                if (!deliveryInfo) return "-";
                                                return `${deliveryInfo.days} days ${deliveryInfo.status}`;
                                            })()}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-xs text-gray-500" title={order.address}>
                                        {extractCity(order.address)}
                                        <span className="text-gray-400"> (Tap for full address)</span>
                                    </div>
                                )}
                            </td>

                            {/* Address (Desktop View) */}
                            <td className="px-4 py-4 hidden lg:table-cell">
                                <div className="text-sm text-gray-600 max-w-xs">{order.address}</div>
                            </td>
                            
                            {/* Payment (Hidden on Mobile) */}
                            <td className="px-4 py-4 hidden md:table-cell">
                                <div className="text-sm font-semibold text-gray-900">₹{order.totalAmount?.toLocaleString()}</div>
                                <div className="text-xs text-green-600">Adv: ₹{order.advancePaid?.toLocaleString()}</div>
                                <div className="text-xs text-red-600">Bal: ₹{order.remainingAmount?.toLocaleString()}</div>
                            </td>
                            
                            {/* Order Received (Hidden until XL screen) */}
                            <td className="px-4 py-4 whitespace-nowrap hidden xl:table-cell">
                                <div>
                                    <div className="text-xs font-medium">{receivedDate}</div>
                                    <div className="text-xs text-gray-500">{receivedDays} days ago</div>
                                </div>
                            </td>

                            {/* Workshop Timeline (Hidden until XL screen) */}
                            <td className="px-4 py-4 whitespace-nowrap hidden xl:table-cell">
                                {renderWorkshopTimeline(order)}
                            </td>
                            
                            {/* In Showroom Since (Hidden until XL screen) */}
                            <td className="px-4 py-4 whitespace-nowrap hidden xl:table-cell">
                                <div className="text-sm font-medium text-gray-900">
                                    {showroomDays !== null ? `${Math.abs(showroomDays)} days` : "-"}
                                </div>
                            </td>

                            {/* Actions */}
                            <td className="px-4 py-4 whitespace-nowrap">
                                <div className="flex gap-2">
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

      {/* No orders/data message */}
      {!isLoading && orders.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No orders found matching your criteria
        </div>
      )}
    </div>
  );
};

export default DashboardTable;