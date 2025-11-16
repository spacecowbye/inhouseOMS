// src/components/TableControls.jsx
import React from 'react';
import { Search, X } from 'lucide-react';

const TableControls = ({ 
    searchTerm, setSearchTerm, 
    statusFilter, setStatusFilter, 
    typeFilter, setTypeFilter, 
    sortBy, setSortBy, 
    handleNewOrderClick 
}) => {
  return (
    <div className="bg-white rounded-lg shadow p-4 mb-6">
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
              size={20}
            />
            <input
              type="text"
              placeholder="Search by name, phone, or order ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="Active">Active Orders</option>
          <option value="All">All Orders</option>
          <option value="Order Received">Order Received</option>
          <option value="In Workshop">In Workshop</option>
          <option value="Ready for Pickup">Ready for Pickup</option>
          <option value="Delivered">Delivered</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="All">All Types</option>
          <option value="Order">Order</option>
          <option value="Repair">Repair</option>
          <option value="Delivery">Delivery</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="orderReceived">Order Received Date</option>
          <option value="showroomTime">Longest in Showroom</option>
          <option value="workshopTime">Longest in Workshop</option>
        </select>
        <button
          onClick={handleNewOrderClick}
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
        >
          + New Order
        </button>
      </div>
    </div>
  );
};

export default TableControls;