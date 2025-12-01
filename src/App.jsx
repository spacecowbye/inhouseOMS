import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { getStatus } from "./utils/dataUtils"; 

import StatsCards from "./components/StatsCards"; 
import TableControls from "./components/TableControls"; 
import OrderForm from "./components/OrderForm"; 
import DashboardTable from "./components/DashboardTable"; 
import LoginScreen from "./components/LoginScreen"; 

const API_BASE_URL = "/api/orders";
const DEBOUNCE_DELAY_MS = 300; 
// 💡 NEW: Base URL for the public login endpoint
const LOGIN_URL = "/login"; 

// ❌ DELETED: encodeBase64 is no longer needed

const App = () => {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState(null);
  // 💡 CHANGE: authCredentials now stores the JWT Token string
  const [authToken, setAuthToken] = useState(null);

  const [globalStats, setGlobalStats] = useState({
    total: 0, received: 0, inWorkshop: 0, ready: 0, delivered: 0,
  });

  const [sortBy, setSortBy] = useState("orderReceivedDate"); 
  const [sortDirection, setSortDirection] = useState("desc"); 

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [typeFilter, setTypeFilter] = useState("All");

  const filterRef = useRef({ searchTerm, statusFilter, typeFilter });
  const timeoutRef = useRef(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

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

  // 💡 CHANGE: Use Bearer scheme with the JWT Token
  const getAuthHeader = useCallback(() => {
    if (authToken) {
        return { 'Authorization': `Bearer ${authToken}` };
    }
    return {};
  }, [authToken]);


  // 💡 CHANGE: New Login Handler for JWT
  const handleLogin = async (username, password) => {
    setAuthError(null);
    setIsLoading(true);

    try {
        // 1. Call the public /login endpoint
        const response = await fetch(LOGIN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        if (response.status === 401) {
            setAuthError("Invalid username or password. Please try again.");
            setIsLoading(false);
            return;
        }

        if (!response.ok) throw new Error('Authentication failed');

        const result = await response.json();
        
        // 2. Extract and store the token
        const token = result.token;
        localStorage.setItem('authToken', token); // Persist token in local storage
        setAuthToken(token);
        setIsAuthenticated(true);
        
        // 3. Immediately fetch orders with the new token
        // This is done implicitly by the useEffect below, but let's reset loading now.
        // We will let the main useEffect trigger fetchOrders.

    } catch (err) {
        console.error('Login error:', err);
        setAuthError(err.message || "Login failed. Please try again.");
    } finally {
        setIsLoading(false);
    }
  };

  // 💡 CHANGE: Logout handler clears local storage
  const handleLogout = () => {
    localStorage.removeItem('authToken'); 
    setIsAuthenticated(false);
    setAuthToken(null);
    setOrders([]);
    setError(null);
  };
  
  // 💡 NEW: Check local storage for token on mount for persistence
  useEffect(() => {
      const storedToken = localStorage.getItem('authToken');
      if (storedToken) {
          // Note: In a production app, you would verify this token's expiration 
          // before setting isAuthenticated to true. For simplicity, we trust it here.
          setAuthToken(storedToken);
          setIsAuthenticated(true);
      } else {
          // If no token, we are not logged in and not loading data
          setIsLoading(false);
      }
  }, []);

  // 💡 CHANGE: fetchOrders now uses authToken
  const fetchOrders = useCallback(async (
    sortCol = sortBy,
    sortDir = sortDirection
  ) => {
    // Check for the token, not just the state
    if (!authToken) {
        setIsLoading(false);
        return;
    }

    if (orders.length === 0) setIsLoading(true);
    
    setError(null);
    try {
      const query = `?sortBy=${sortCol}&sortDirection=${sortDir}`;
      const response = await fetch(`${API_BASE_URL}${query}`, {
          headers: getAuthHeader(), // uses Bearer token
      });

      // Handle token expiration/rejection
      if (response.status === 401) {
          // Clear token if the server says it's bad
          handleLogout(); 
          setAuthError("Session expired or invalid. Please log in again.");
          return;
      }

      if (!response.ok) throw new Error('Failed to fetch orders.');

      const result = await response.json();
      setOrders(result.data);
      setGlobalStats(result.stats);
      setIsAuthenticated(true);
      
    } catch (err) {
      console.error('Error fetching orders:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [orders.length, sortBy, sortDirection, authToken, getAuthHeader, handleLogout]);

  // 💡 Dependency change: Now depends on authToken, which handles initial load from storage
  useEffect(() => {
    // Only fetch if authToken is present (either from login or local storage)
    if (authToken) {
        fetchOrders(sortBy, sortDirection); 
    }
  }, [fetchOrders, sortBy, sortDirection, authToken]);

  useEffect(() => {
    filterRef.current = { searchTerm, statusFilter, typeFilter };
      
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {}, DEBOUNCE_DELAY_MS);
      
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
      
  }, [searchTerm, statusFilter, typeFilter]);

  const uploadImageToS3 = async (file) => {
      if (!file || !authToken) throw new Error("Authentication required."); // 💡 CHANGE: Check authToken

      const data = new FormData();
      data.append('photo', file);

      const response = await fetch(`${API_BASE_URL}/upload-photo`, {
        method: 'POST',
        body: data,
        headers: getAuthHeader(), // uses Bearer token
      });

      if (!response.ok) throw new Error("Upload failed");

      const result = await response.json();
      return result.photoUrl; 
  };
  
  // ... (handleInputChange function is unchanged) ...
  const handleInputChange = (e) => {
    const { name, value, files } = e.target;

    if (name === "photoFile" && files && files[0]) {
        const file = files[0];
        setFormData(prev => ({ 
            ...prev, 
            photoFile: file, 
            photoUrl: URL.createObjectURL(file) 
        }));
        return;
    }

    setFormData(prev => {
      const updated = { ...prev, [name]: value };
      if (name === "totalAmount" || name === "advancePaid") {
        const total = parseFloat(name === "totalAmount" ? value : updated.totalAmount) || 0;
        const advance = parseFloat(name === "advancePaid" ? value : updated.advancePaid) || 0;
        updated.remainingAmount = (total - advance).toString();
      }
      return updated;
    });
  };

  // ... (handleSubmit function is unchanged other than the auth header) ...
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    let finalPhotoUrl = formData.photoUrl;

    if (formData.photoFile) {
        try {
            finalPhotoUrl = await uploadImageToS3(formData.photoFile);
        } catch (uploadError) {
            setError(uploadError.message);
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

    Object.keys(orderToSubmit).forEach(key => 
      (orderToSubmit[key] === "" || orderToSubmit[key] === null) && delete orderToSubmit[key]
    );

    const method = editingId ? 'PUT' : 'POST';
    const url = editingId ? `${API_BASE_URL}/${editingId}` : API_BASE_URL;

    try {
      const response = await fetch(url, {
        method,
        headers: { 
            'Content-Type': 'application/json',
            ...getAuthHeader() // uses Bearer token
        },
        body: JSON.stringify(orderToSubmit), 
      });

      if (!response.ok) throw new Error("API error");

      await fetchOrders(sortBy, sortDirection);

      setFormData(initialFormData);
      setEditingId(null);
      setShowForm(false);

    } catch (err) {
      setError(err.message); 
    } finally {
      setIsLoading(false);
    }
  };

  // ... (handleEdit function is unchanged) ...
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

  // REAL DELETE OPERATION (Auth Header updated via getAuthHeader)
  const handleDelete = async (id) => {
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader(), // uses Bearer token
      });

      if (!response.ok) throw new Error("Delete failed");

      await fetchOrders(sortBy, sortDirection);

    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };
  
  // ... (Other functions are unchanged) ...
  const handleDeleteConfirmation = (id) => {
    setDeleteConfirmId(id);
  };
  const handleDeleteCancel = () => {
    setDeleteConfirmId(null);
  };
  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return;
    await handleDelete(deleteConfirmId);
    setDeleteConfirmId(null);
  };
  const handleNewOrderClick = () => {
    setShowForm(!showForm);
    setEditingId(null);
    setFormData(initialFormData);
  };
  const handleColumnSort = (column, newDirection) => {
    if (!newDirection) {
        newDirection = sortDirection === "desc" ? "asc" : "desc";
        if (sortBy !== column) newDirection = "desc";
    }
    
    setSortBy(column);
    setSortDirection(newDirection);
    fetchOrders(column, newDirection);
  };

  const displayOrders = useMemo(() => {
    return orders.filter(order => {
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

      const matchesType =
        typeFilter === "All" || order.type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [orders, searchTerm, statusFilter, typeFilter]);

  if (!isAuthenticated) {
    return <LoginScreen handleLogin={handleLogin} error={authError} />;
  }

  // ... (Return JSX is unchanged) ...
  return (
    <div className="min-h-screen bg-gray-50 p-3 md:p-6">
      <div className="max-w-full mx-auto">

        {/* HEADER */}
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
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition shadow-md"
          >
            Logout
          </button>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mt-4">
            <strong className="font-bold">Error:</strong>
            <span className="ml-2">{error}</span>
          </div>
        )}

        <StatsCards stats={globalStats} isLoading={isLoading} />

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
          handleDelete={handleDeleteConfirmation}
          sortBy={sortBy}
          sortDirection={sortDirection}
          handleColumnSort={handleColumnSort}
          isLoading={isLoading}
        />

        {/* Footer */}
        <div className="text-center mt-4 text-sm text-gray-600">
          {isLoading
            ? "Fetching all records..."
            : globalStats.total > 0
              ? `Displaying ${displayOrders.length} of ${globalStats.total} orders`
              : "No orders found."}
        </div>
      </div>

      {/* CONFIRM DELETE MODAL */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Confirm Delete</h2>
            <p className="text-gray-700 mb-6">
              Are you sure you want to delete this order?  
              <br />This action <strong>cannot be undone.</strong>
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={handleDeleteCancel}
                className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
              >
                Cancel
              </button>

              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;