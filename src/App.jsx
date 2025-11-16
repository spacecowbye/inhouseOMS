import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { getStatus } from "./utils/dataUtils"; 

// Import Components
import StatsCards from "./components/StatsCards"; 
import TableControls from "./components/TableControls"; 
import OrderForm from "./components/OrderForm"; 
import DashboardTable from "./components/DashboardTable"; 

// --- API Configuration ---
const API_BASE_URL = "/api/orders";
const DEBOUNCE_DELAY_MS = 300; // Delay for search/filter fetches

// --- Placeholder for S3 UPLOAD LOGIC ---
// NOTE: This must be implemented on the backend!
// The frontend calls this to get a permanent URL.
const uploadImageToS3 = async (file) => {
    if (!file) return null;

    // 1. Create a FormData object to send the file to our *backend upload endpoint*
    const data = new FormData();
    data.append('photo', file); // 'photo' must match the field name in multer setup on the server.

    try {
        // 2. Call a NEW, dedicated upload endpoint on the server
        const response = await fetch(`${API_BASE_URL}/upload-photo`, {
            method: 'POST',
            body: data, // IMPORTANT: No Content-Type header needed; browser sets it automatically with boundary
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Image upload failed.');
        }

        const result = await response.json();
        // The server must return the final public URL
        return result.photoUrl; 

    } catch (error) {
        console.error("Error during image upload process:", error);
        throw error; // Re-throw to be caught by handleSubmit
    }
};

const App = () => {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // State for global statistics calculated by the server
  const [globalStats, setGlobalStats] = useState({
    total: 0, received: 0, inWorkshop: 0, ready: 0, delivered: 0,
  });
  
  // Sorting State
  const [sortBy, setSortBy] = useState("orderReceivedDate"); 
  const [sortDirection, setSortDirection] = useState("desc"); 

  // Filter State
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [typeFilter, setTypeFilter] = useState("All");

  // Ref to store the latest search/filter values for the debounced fetch
  const filterRef = useRef({ searchTerm, statusFilter, typeFilter });
  const timeoutRef = useRef(null);


  // Initial Form Data State (CRITICAL UPDATE: Added photoFile)
  const initialFormData = useMemo(() => ({
    firstName: "", lastName: "", address: "", mobile: "",
    advancePaid: "", totalAmount: "",
    orderReceivedDate: "", sentToWorkshopDate: "", returnedFromWorkshopDate: "", collectedByCustomerDate: "",
    type: "Order", trackingNumber: "", shippingDate: "", 
    photoUrl: "",     // Public URL of the image (saved to DB)
    photoFile: null,  // The actual File object (used only for upload)
    repairCourierCharges: "", karigarName: "",
    notes: "", 
  }), []);

  const [formData, setFormData] = useState(initialFormData);

  // --- Core API Data Fetching (Unchanged) ---
  const fetchOrders = useCallback(async (
    sortCol = sortBy,
    sortDir = sortDirection
  ) => {
    if (orders.length === 0) {
      setIsLoading(true);
    }
    
    setError(null);
    try {
      const query = `?sortBy=${sortCol}&sortDirection=${sortDir}`;
      const response = await fetch(`${API_BASE_URL}${query}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch orders from API.');
      }
      
      const result = await response.json();
      
      setOrders(result.data);
      setGlobalStats(result.stats);
      
    } catch (err) {
      console.error('Error fetching orders:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [orders.length]);

  // Initial Load and Re-fetch when sorting changes
  useEffect(() => {
    fetchOrders(sortBy, sortDirection); 
  }, [fetchOrders, sortBy, sortDirection]);
  
  // Debounced Filter Effect (Unchanged)
  useEffect(() => {
      filterRef.current = { searchTerm, statusFilter, typeFilter };
      
      if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
          console.log("Filters/Search state updated locally.");
      }, DEBOUNCE_DELAY_MS);
      
      return () => {
          if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
          }
      };
      
  }, [searchTerm, statusFilter, typeFilter]);


  // --- Handlers ---

  const handleInputChange = (e) => {
    const { name, value, files } = e.target;

    // --- UPDATED PHOTO LOGIC ---
    if (name === "photoUrl" && files && files[0]) {
        const file = files[0];
        setFormData((prev) => ({ 
            ...prev, 
            photoFile: file, // Save the actual File object
            photoUrl: URL.createObjectURL(file) // Generate temp URL for instant preview
        }));
        return;
    }
    // --- END PHOTO LOGIC ---

    setFormData((prev) => {
      const updated = { ...prev, [name]: value };
      // Financial calculation logic
      if (name === "totalAmount" || name === "advancePaid") {
        const total = parseFloat(name === "totalAmount" ? value : updated.totalAmount) || 0;
        const advance = parseFloat(name === "advancePaid" ? value : updated.advancePaid) || 0;
        updated.remainingAmount = (total - advance).toString();
      }
      return updated;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    
    // START: Image Upload Execution
    let finalPhotoUrl = formData.photoUrl;

    if (formData.photoFile) {
        try {
            console.log("Uploading file to S3...");
            finalPhotoUrl = await uploadImageToS3(formData.photoFile);
        } catch (uploadError) {
            setError(`Failed to upload image: ${uploadError.message}`);
            setIsLoading(false);
            return; // Stop submission if upload fails
        }
    }
    // END: Image Upload Execution
    
    const orderToSubmit = {
      ...formData,
      // Overwrite temporary photoUrl with final S3 URL (or existing URL)
      photoUrl: finalPhotoUrl, 
      photoFile: undefined, // Do not send File object to Express/DB
      totalAmount: parseFloat(formData.totalAmount) || 0,
      advancePaid: parseFloat(formData.advancePaid) || 0,
      remainingAmount: parseFloat(formData.remainingAmount) || 0,
      repairCourierCharges: parseFloat(formData.repairCourierCharges) || null,
    };

    Object.keys(orderToSubmit).forEach(key => (orderToSubmit[key] === "" || orderToSubmit[key] === null) && delete orderToSubmit[key]);


    const method = editingId ? 'PUT' : 'POST';
    const url = editingId ? `${API_BASE_URL}/${editingId}` : API_BASE_URL;

    try {
      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderToSubmit), 
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API Error: ${errorData.message}`);
      }

      await fetchOrders(sortBy, sortDirection); 

      // Reset Form State
      setFormData(initialFormData); 
      setEditingId(null);
      setShowForm(false);
      
      console.log(`Order successfully ${editingId ? 'updated' : 'added'}!`);

    } catch (err) {
      console.error(`Error ${method} order:`, err);
      setError(`Failed to save order: ${err.message}`); 
    } finally {
        setIsLoading(false);
    }
  };

  const handleEdit = (order) => {
    // When editing, ensure photoFile is null and we use the existing photoUrl
    const formattedOrder = {
      ...order,
      photoFile: null, // Always reset the file input when loading for edit
      totalAmount: String(order.totalAmount || ''),
      advancePaid: String(order.advancePaid || ''),
      remainingAmount: String(order.remainingAmount || ''),
      repairCourierCharges: String(order.repairCourierCharges || ''),
    };
    setFormData(formattedOrder);
    setEditingId(order.id);
    setShowForm(true);
  };
  
  // ... (handleDelete, handleNewOrderClick, handleColumnSort, displayOrders are unchanged)

  const handleDelete = async (id) => {
    console.log(`[INFO] Attempting to delete order ID: ${id}.`);
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API Error: ${errorData.message}`);
      }

      await fetchOrders(sortBy, sortDirection);

    } catch (err) {
      console.error('Error deleting order:', err);
      setError(`Failed to delete order: ${err.message}`);
    } finally {
        setIsLoading(false);
    }
  };
  
  const handleNewOrderClick = () => {
    setShowForm(!showForm);
    setEditingId(null);
    setFormData(initialFormData);
  }

  const handleColumnSort = (column, newDirection) => {
    if (!newDirection) {
        newDirection = sortDirection === "desc" ? "asc" : "desc";
        if (sortBy !== column) {
            newDirection = "desc";
        }
    }
    
    setSortBy(column);
    setSortDirection(newDirection);
    
    fetchOrders(column, newDirection);
  }

  // Client-side filtering (Search, Status, Type)
  const displayOrders = useMemo(() => {
    return orders.filter((order) => {
      // 1. Search Filtering
      const matchesSearch =
        order.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.mobile.includes(searchTerm) ||
        order.id.toString().includes(searchTerm);

      // 2. Status Filtering
      const status = getStatus(order);
      const matchesStatus =
        statusFilter === "All" ||
        (statusFilter === "Active" && !order.collectedByCustomerDate) ||
        (statusFilter === "Delivered" && order.collectedByCustomerDate) ||
        status === statusFilter;

      // 3. Type Filtering
      const matchesType = typeFilter === "All" || order.type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [orders, searchTerm, statusFilter, typeFilter]);


  return (
    <div className="min-h-screen bg-gray-50 p-3 md:p-6">
      <div className="max-w-full mx-auto">
        
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
            Jewelry Order Dashboard
          </h1>
          <p className="text-sm md:text-base text-gray-600">
            Track and manage all jewelry orders
          </p>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mt-4">
                <strong className="font-bold">Error:</strong>
                <span className="block sm:inline ml-2">{error}</span>
            </div>
          )}
        </div>

        {/* Stats Cards */}
        <StatsCards stats={globalStats} isLoading={isLoading} />

        {/* Controls */}
        <TableControls
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          sortBy={sortBy} 
          setSortBy={setSortBy}
          handleNewOrderClick={handleNewOrderClick}
          handleColumnSort={handleColumnSort}
        />

        {/* Form */}
        {showForm && (
          <OrderForm
            formData={formData}
            editingId={editingId}
            handleInputChange={handleInputChange}
            handleSubmit={handleSubmit}
            setShowForm={setShowForm}
            setEditingId={setEditingId}
          />
        )}

        {/* Orders Table */}
        <DashboardTable
          orders={displayOrders} 
          handleEdit={handleEdit}
          handleDelete={handleDelete}
          sortBy={sortBy}
          sortDirection={sortDirection}
          handleColumnSort={handleColumnSort}
          isLoading={isLoading}
        />

        {/* NO PAGINATION CONTROLS HERE */}
        <div className="text-center mt-4 text-sm text-gray-600">
            {isLoading ? "Fetching all records..." : 
             globalStats.total > 0 
                ? `Displaying ${displayOrders.length} of ${globalStats.total} total orders.`
                : "No orders found."
            }
        </div>
      </div>
    </div>
  );
};

export default App;