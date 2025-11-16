// src/components/StatsCards.jsx
import React from 'react';
import { Package, Clock, CheckCircle, AlertCircle } from 'lucide-react';

const StatsCards = ({ stats }) => (
  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-4 mb-4 md:mb-6">
    <div className="bg-white rounded-lg shadow p-3 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs md:text-sm text-gray-600">Active Orders</p>
          <p className="text-xl md:text-2xl font-bold text-gray-900">
            {stats.total}
          </p>
        </div>
        <Package className="text-blue-500" size={24} />
      </div>
    </div>
    <div className="bg-white rounded-lg shadow p-3 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs md:text-sm text-gray-600">Received</p>
          <p className="text-xl md:text-2xl font-bold text-purple-600">
            {stats.received}
          </p>
        </div>
        <AlertCircle className="text-purple-500" size={24} />
      </div>
    </div>
    <div className="bg-white rounded-lg shadow p-3 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs md:text-sm text-gray-600">In Workshop</p>
          <p className="text-xl md:text-2xl font-bold text-yellow-600">
            {stats.inWorkshop}
          </p>
        </div>
        <Clock className="text-yellow-500" size={24} />
      </div>
    </div>
    <div className="bg-white rounded-lg shadow p-3 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs md:text-sm text-gray-600">Ready</p>
          <p className="text-xl md:text-2xl font-bold text-green-600">
            {stats.ready}
          </p>
        </div>
        <CheckCircle className="text-green-500" size={24} />
      </div>
    </div>
    <div className="bg-white rounded-lg shadow p-3 md:p-6 col-span-2 md:col-span-1">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs md:text-sm text-gray-600">Delivered</p>
          <p className="text-xl md:text-2xl font-bold text-gray-600">
            {stats.delivered}
          </p>
        </div>
        <Package className="text-gray-500" size={24} />
      </div>
    </div>
  </div>
);

export default StatsCards;