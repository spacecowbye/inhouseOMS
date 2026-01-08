import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { getStatus } from "./utils/dataUtils";

import StatsCards from "./components/StatsCards";
import TableControls from "./components/TableControls";
import OrderForm from "./components/OrderForm";
import DashboardTable from "./components/DashboardTable";
import LoginScreen from "./components/LoginScreen";
import CalendarView from "./components/CalendarView";
import { LayoutList, Calendar as CalendarIcon } from "lucide-react";

const API_BASE_URL = "/api/orders";
const DEBOUNCE_DELAY_MS = 300;

const encodeBase64 = (username, password) => {
  const credentials = `${username}:${password}`;
  return btoa(credentials);
};

const App = () => {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [appointments, setAppointments] = useState([]);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authCredentials, setAuthCredentials] = useState(null);

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
  const [view, setView] = useState("list"); // 'list' or 'calendar'

  const filterRef = useRef({ searchTerm, statusFilter, typeFilter });
  const timeoutRef = useRef(null);

  // NEW — Delete confirmation state
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

  const getAuthHeader = useCallback(() => {
    if (authCredentials) {
      return { 'Authorization': `Basic ${authCredentials}` };
    }
    return {};
  }, [authCredentials]);

  const handleLogin = async (username, password) => {
    const encoded = encodeBase64(username, password);
    setAuthError(null);
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}?sortBy=orderReceivedDate&sortDirection=desc`, {
        headers: { 'Authorization': `Basic ${encoded}` }
      });

      if (response.status === 401) {
        setAuthError("Invalid username or password. Please try again.");
        setIsLoading(false);
        return;
      }

      if (!response.ok) throw new Error('Authentication failed');

      const result = await response.json();
      setAuthCredentials(encoded);
      setIsAuthenticated(true);
      localStorage.setItem('jewelry_dashboard_auth', encoded);
      setOrders(result.data);
      setGlobalStats(result.stats);

    } catch (err) {
      console.error('Login error:', err);
      setAuthError(err.message || "Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('jewelry_dashboard_auth');
    setIsAuthenticated(false);
    setAuthCredentials(null);
    setOrders([]);
  };

  const fetchOrders = useCallback(async (
    sortCol = sortBy,
    sortDir = sortDirection
  ) => {
    if (!authCredentials) return;

    if (orders.length === 0) setIsLoading(true);

    setError(null);
    try {
      const query = `?sortBy=${sortCol}&sortDirection=${sortDir}`;
      const response = await fetch(`${API_BASE_URL}${query}`, {
        headers: getAuthHeader(),
      });

      if (response.status === 401) {
        localStorage.removeItem('jewelry_dashboard_auth');
        setIsAuthenticated(false);
        setAuthError("Invalid credentials. Please try again.");
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
  }, [orders.length, sortBy, sortDirection, authCredentials, getAuthHeader]);

  const fetchAppointments = useCallback(async () => {
    if (!authCredentials) return;
    try {
      const response = await fetch('/api/appointments', {
        headers: getAuthHeader(),
      });
      if (response.ok) {
        const result = await response.json();
        setAppointments(result.data);
      }
    } catch (err) {
      console.error('Error fetching appointments:', err);
    }
  }, [authCredentials, getAuthHeader]);

  useEffect(() => {
    const stored = localStorage.getItem('jewelry_dashboard_auth');
    if (stored) {
      setAuthCredentials(stored);
      setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchOrders(sortBy, sortDirection);
      fetchAppointments();
    }
  }, [fetchOrders, fetchAppointments, sortBy, sortDirection, isAuthenticated]);

  useEffect(() => {
    filterRef.current = { searchTerm, statusFilter, typeFilter };

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => { }, DEBOUNCE_DELAY_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };

  }, [searchTerm, statusFilter, typeFilter]);

  const uploadImageToS3 = async (file) => {
    if (!file || !authCredentials) throw new Error("Authentication required.");

    const data = new FormData();
    data.append('photo', file);

    const response = await fetch(`${API_BASE_URL}/upload-photo`, {
      method: 'POST',
      body: data,
      headers: getAuthHeader(),
    });

    if (!response.ok) throw new Error("Upload failed");

    const result = await response.json();
    return result.photoUrl;
  };

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
          ...getAuthHeader()
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

  // REAL DELETE OPERATION
  const handleDelete = async (id) => {
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
      });

      if (!response.ok) throw new Error("Delete failed");

      await fetchOrders(sortBy, sortDirection);

    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // NEW — Trigger confirmation modal
  const handleDeleteConfirmation = (id) => {
    setDeleteConfirmId(id);
  };

  // NEW — Cancel modal
  const handleDeleteCancel = () => {
    setDeleteConfirmId(null);
  };

  // NEW — Confirm delete
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

          <div className="flex gap-2">
            <div className="flex bg-gray-200 p-1 rounded-lg shadow-inner mr-2">
              <button
                onClick={() => setView('list')}
                className={`p-2 rounded-md transition-all ${view === 'list' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                title="List View"
              >
                <LayoutList size={20} />
              </button>
              <button
                onClick={() => setView('calendar')}
                className={`p-2 rounded-md transition-all ${view === 'calendar' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                title="7-Day Calendar View"
              >
                <CalendarIcon size={20} />
              </button>
            </div>

            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition shadow-md"
            >
              Logout
            </button>
          </div>
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

        {/* Orders List/Calendar */}
        {view === 'list' ? (
          <DashboardTable
            orders={displayOrders}
            handleEdit={handleEdit}
            handleDelete={handleDeleteConfirmation}
            sortBy={sortBy}
            sortDirection={sortDirection}
            handleColumnSort={handleColumnSort}
            isLoading={isLoading}
            authHeaders={getAuthHeader()}
          />
        ) : (
          <CalendarView orders={displayOrders} appointments={appointments} />
        )}

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
