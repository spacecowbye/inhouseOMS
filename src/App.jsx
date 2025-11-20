import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { getStatus } from "./utils/dataUtils"; 

// Import Components
import StatsCards from "./components/StatsCards"; 
import TableControls from "./components/TableControls"; 
import OrderForm from "./components/OrderForm"; 
import DashboardTable from "./components/DashboardTable"; 
import LoginScreen from "./components/LoginScreen"; 

// --- API Configuration ---
const API_BASE_URL = "/api/orders";
const DEBOUNCE_DELAY_MS = 300; 

// --- Helper: Basic Auth Encoding ---
const encodeBase64 = (username, password) => {
    // FIX: Use native browser functions (btoa) for client-side encoding
    const credentials = `${username}:${password}`;
    return btoa(credentials);
};
// ----------------------------------


const App = () => {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // --- AUTHENTICATION STATE ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authCredentials, setAuthCredentials] = useState(null); // Stores base64 token
  // ----------------------------
  
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

  const filterRef = useRef({ searchTerm, statusFilter, typeFilter });
  const timeoutRef = useRef(null);

  const initialFormData = useMemo(() => ({
    firstName: "", lastName: "", address: "", mobile: "",
    advancePaid: "", totalAmount: "",
    orderReceivedDate: "", sentToWorkshopDate: "", returnedFromWorkshopDate: "", collectedByCustomerDate: "",
    type: "Order", trackingNumber: "", shippingDate: "", 
    photoUrl: "",     
    photoFile: null,  
    repairCourierCharges: "", karigarName: "",
    notes: "", 
  }), []);

  const [formData, setFormData] = useState(initialFormData);

  // --- Auth Header Helper ---
  const getAuthHeader = useCallback(() => {
    if (authCredentials) {
        return { 'Authorization': `Basic ${authCredentials}` };
    }
    return {};
  }, [authCredentials]);

  // --- LOGIN FUNCTION ---

const handleLogin = async (username, password) => {
    const encoded = encodeBase64(username, password);
    setAuthError(null);
    setIsLoading(true);

    try {
        // Verify credentials by making a test API call
        const response = await fetch(`${API_BASE_URL}?sortBy=orderReceivedDate&sortDirection=desc`, {
            headers: { 'Authorization': `Basic ${encoded}` }
        });

        if (response.status === 401) {
            setAuthError("Invalid username or password. Please try again.");
            setIsLoading(false);
            return;
        }

        if (!response.ok) {
            throw new Error('Authentication failed');
        }

        // Only set authentication state if credentials are valid
        const result = await response.json();
        setAuthCredentials(encoded);
        setIsAuthenticated(true);
        setOrders(result.data);
        setGlobalStats(result.stats);

    } catch (err) {
        console.error('Login error:', err);
        setAuthError(err.message || "Login failed. Please try again.");
    } finally {
        setIsLoading(false);
    }
};
  
  // --- Logout Function (Optional, but good practice) ---
  const handleLogout = () => {
    setIsAuthenticated(false);
    setAuthCredentials(null);
    setOrders([]); // Clear sensitive data
  };
  

  // --- Core API Data Fetching ---
  const fetchOrders = useCallback(async (
    sortCol = sortBy,
    sortDir = sortDirection
  ) => {
    if (!authCredentials) return; // Prevent fetch if not authenticated

    if (orders.length === 0) {
      setIsLoading(true);
    }
    
    setError(null);
    try {
      const query = `?sortBy=${sortCol}&sortDirection=${sortDir}`;
      const response = await fetch(`${API_BASE_URL}${query}`, {
          headers: getAuthHeader(), // <--- AUTH HEADER
      });
      
      if (response.status === 401) {
          // If server rejects the token, force re-login
          setIsAuthenticated(false);
          setAuthError("Invalid credentials. Please try again.");
          return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch orders from API.');
      }
      
      const result = await response.json();
      
      setOrders(result.data);
      setGlobalStats(result.stats);
      setIsAuthenticated(true); // Confirm authentication successful
      
    } catch (err) {
      console.error('Error fetching orders:', err);
      // If error is network related (CORS, network down, etc.)
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [orders.length, sortBy, sortDirection, authCredentials, getAuthHeader]);

  // Initial Load and Re-fetch when sorting/auth changes
  useEffect(() => {
    if (isAuthenticated) {
        fetchOrders(sortBy, sortDirection); 
    }
  }, [fetchOrders, sortBy, sortDirection, isAuthenticated]);
  
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


  // Placeholder for S3 UPLOAD LOGIC 
  const uploadImageToS3 = async (file) => {
      if (!file || !authCredentials) throw new Error("Authentication required for upload.");

      const data = new FormData();
      data.append('photo', file); 

      try {
          const response = await fetch(`${API_BASE_URL}/upload-photo`, {
              method: 'POST',
              body: data, 
              headers: getAuthHeader(), // <--- AUTH HEADER
          });
          
          if (response.status === 401) throw new Error("Authentication failed during upload.");

          if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.message || 'Image upload failed.');
          }

          const result = await response.json();
          return result.photoUrl; 

      } catch (error) {
          console.error("Error during image upload process:", error);
          throw error; 
      }
  };


  const handleInputChange = (e) => {
    const { name, value, files } = e.target;
    
    if (name === "photoFile" && files && files[0]) {
        const file = files[0];
        setFormData((prev) => ({ 
            ...prev, 
            photoFile: file, 
            photoUrl: URL.createObjectURL(file) 
        }));
        return;
    }

    setFormData((prev) => {
      const updated = { ...prev, [name]: value };
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
    
    let finalPhotoUrl = formData.photoUrl;

    if (formData.photoFile) {
        try {
            console.log("Uploading file to S3...");
            finalPhotoUrl = await uploadImageToS3(formData.photoFile);
        } catch (uploadError) {
            setError(`Failed to upload image: ${uploadError.message}`);
            setIsLoading(false);
            return; 
        }
    }

    const orderToSubmit = {
      ...formData,
      photoUrl: finalPhotoUrl, 
      photoFile: undefined, 
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
        headers: { 
            'Content-Type': 'application/json',
            ...getAuthHeader() // <--- AUTH HEADER
        },
        body: JSON.stringify(orderToSubmit), 
      });
      
      if (response.status === 401) throw new Error("Authentication failed during save.");

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API Error: ${errorData.message}`);
      }

      await fetchOrders(sortBy, sortDirection); 

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
    const formattedOrder = {
      ...order,
      photoFile: null, 
      totalAmount: String(order.totalAmount || ''),
      advancePaid: String(order.advancePaid || ''),
      remainingAmount: String(order.remainingAmount || ''),
      repairCourierCharges: String(order.repairCourierCharges || ''),
    };
    setFormData(formattedOrder);
    setEditingId(order.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    console.log(`[INFO] Attempting to delete order ID: ${id}.`);
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader(), // <--- AUTH HEADER
      });
      
      if (response.status === 401) throw new Error("Authentication failed during delete.");

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
      const matchesSearch =
        order.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.mobile.includes(searchTerm) ||
        order.id.toString().includes(searchTerm);

      const status = getStatus(order);
      const matchesStatus =
        statusFilter === "All" ||
        (statusFilter === "Active" && !order.collectedByCustomerDate) ||
        (statusFilter === "Delivered" && order.collectedByCustomerDate) ||
        status === statusFilter;

      const matchesType = typeFilter === "All" || order.type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [orders, searchTerm, statusFilter, typeFilter]);


  // --- MAIN RENDER LOGIC ---
  if (!isAuthenticated) {
    // Show login screen if not authenticated
    return <LoginScreen handleLogin={handleLogin} error={authError} />;
  }


  return (
    <div className="min-h-screen bg-gray-50 p-3 md:p-6">
      <div className="max-w-full mx-auto">
        
        {/* Header and Logout Button */}
        <div className="mb-6 md:mb-8 flex justify-between items-center">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
                    Jewelry Order Dashboard
                </h1>
                <p className="text-sm md:text-base text-gray-600">
                    Track and manage all jewelry orders
                </p>
            </div>
            <button 
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors shadow-md"
            >
                Logout
            </button>
        </div>

        {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mt-4">
                <strong className="font-bold">Error:</strong>
                <span className="block sm:inline ml-2">{error}</span>
            </div>
        )}

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

        {/* Footer */}
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