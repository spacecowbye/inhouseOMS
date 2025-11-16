import React from 'react';

const OrderForm = ({
  formData,
  editingId,
  handleInputChange,
  handleSubmit,
  setShowForm,
  setEditingId,
}) => {
  // Helper to calculate Balance dynamically
  const balanceAmount = 
    parseFloat(formData.totalAmount || 0) -
    parseFloat(formData.advancePaid || 0);

  // Determine the URL for preview: use the current photoUrl from state, 
  // which will be either the permanent S3 URL (editing) or the temporary blob URL (newly selected).
  const previewUrl = formData.photoUrl;

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        {editingId ? "Edit Order" : "Add New Order"}
      </h2>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Order Type *
        </label>
        <div className="flex gap-4">
          {["Order", "Repair", "Delivery"].map((type) => (
            <label key={type} className="flex items-center">
              <input
                type="radio"
                name="type"
                value={type}
                checked={formData.type === type}
                onChange={handleInputChange}
                className="mr-2"
              />
              <span className="text-sm">{type}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {/* Input fields for Customer details (firstName, lastName, mobile, address) */}
        <input type="text" name="firstName" placeholder="First Name *" value={formData.firstName} onChange={handleInputChange} required className="border border-gray-300 rounded-lg px-3 py-2" />
        <input type="text" name="lastName" placeholder="Last Name *" value={formData.lastName} onChange={handleInputChange} required className="border border-gray-300 rounded-lg px-3 py-2" />
        <input type="tel" name="mobile" placeholder="Mobile *" value={formData.mobile} onChange={handleInputChange} required className="border border-gray-300 rounded-lg px-3 py-2" />
        <input type="text" name="address" placeholder="Address *" value={formData.address} onChange={handleInputChange} required className="border border-gray-300 rounded-lg px-3 py-2" />
      </div>

      {/* Photo Upload/Preview */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Photo</label>
        <div className="flex items-center gap-4">
          {/* Use the dynamically determined preview URL */}
          {previewUrl && (
            <img src={previewUrl} alt="Preview" className="w-20 h-20 object-cover rounded-lg border-2 border-gray-300" />
          )}
          {/* CRITICAL FIX: Changed name to photoFile */}
          <input type="file" name="photoFile" accept="image/*" onChange={handleInputChange} className="border border-gray-300 rounded-lg px-3 py-2 flex-1" />
        </div>
      </div>

      {/* Financial Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <input type="number" name="totalAmount" placeholder="Total Amount (₹) *" value={formData.totalAmount} onChange={handleInputChange} required className="border border-gray-300 rounded-lg px-3 py-2" />
        <input type="number" name="advancePaid" placeholder="Advance Paid (₹) *" value={formData.advancePaid} onChange={handleInputChange} required className="border border-gray-300 rounded-lg px-3 py-2" />
        <input type="number" placeholder="Balance (₹)" value={balanceAmount || ""} readOnly className="border border-gray-300 rounded-lg px-3 py-2 bg-gray-50" />
      </div>

      {/* Date fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {/* Order Received */}
        <div><label className="block text-xs text-gray-600 mb-1">Order Received *</label><input type="date" name="orderReceivedDate" value={formData.orderReceivedDate} onChange={handleInputChange} required className="w-full border border-gray-300 rounded-lg px-3 py-2" /></div>
        {/* Sent to Workshop */}
        <div><label className="block text-xs text-gray-600 mb-1">Sent to Workshop</label><input type="date" name="sentToWorkshopDate" value={formData.sentToWorkshopDate} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2" /></div>
        {/* Returned from Workshop */}
        <div><label className="block text-xs text-gray-600 mb-1">Returned from Workshop</label><input type="date" name="returnedFromWorkshopDate" value={formData.returnedFromWorkshopDate} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2" /></div>
        {/* Collected by Customer */}
        <div><label className="block text-xs text-gray-600 mb-1">Collected by Customer</label><input type="date" name="collectedByCustomerDate" value={formData.collectedByCustomerDate} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2" /></div>
      </div>

      {/* Delivery fields */}
      {formData.type === "Delivery" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input type="text" name="trackingNumber" placeholder="Tracking Number" value={formData.trackingNumber} onChange={handleInputChange} className="border border-gray-300 rounded-lg px-3 py-2" />
          <div>
            <label className="block text-xs text-gray-600 mb-1">Shipping Date</label>
            <input type="date" name="shippingDate" value={formData.shippingDate} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
          </div>
        </div>
      )}

      {/* Repair fields */}
      {formData.type === "Repair" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Karigar Name</label>
            <input type="text" name="karigarName" placeholder="Enter karigar name" value={formData.karigarName || ""} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Repair Courier Charges (₹)</label>
            <input type="number" name="repairCourierCharges" placeholder="Enter courier charges" value={formData.repairCourierCharges || ""} onChange={handleInputChange} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
          </div>
        </div>
      )}
      
      {/* NOTES FIELD */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Description</label>
        <textarea
          name="notes"
          placeholder="Any special instructions, material details, or customer requests..."
          value={formData.notes || ""}
          onChange={handleInputChange}
          rows="3"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 resize-y focus:ring-2 focus:ring-blue-500"
        ></textarea>
      </div>


      {/* Actions */}
      <div className="flex gap-4">
        <button onClick={handleSubmit} className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          {editingId ? "Update" : "Add"} Order
        </button>
        <button
          onClick={() => { setShowForm(false); setEditingId(null); }}
          className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default OrderForm;