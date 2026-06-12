// src/components/InventoryView.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Filter,
  SlidersHorizontal,
  Plus,
  Edit2,
  Trash2,
  Image as ImageIcon,
  Tag,
  X,
  Sparkles,
  RefreshCw,
  PlusCircle,
  Gem
} from 'lucide-react';

const API_BASE_URL = '/api/inventory';

const InventoryView = ({ authHeaders }) => {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filter & Search & Sort states
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [sortBy, setSortBy] = useState('newest'); // 'newest', 'oldest', 'price-desc', 'price-asc', 'qty-desc', 'sku'

  // Add/Edit modal states
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null); // null for add, item object for edit

  // Form states
  const [formCategory, setFormCategory] = useState('neckpiece');
  const [formQuantity, setFormQuantity] = useState('1');
  const [formPrice, setFormPrice] = useState(''); // Empty means try OCR
  const [formDescription, setFormDescription] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formCanSellSeparately, setFormCanSellSeparately] = useState(false);
  const [formPhotoFile, setFormPhotoFile] = useState(null);
  const [formPhotoPreview, setFormPhotoPreview] = useState(null);

  // Overlay states
  const [selectedImage, setSelectedImage] = useState(null);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState(null);

  // Fetch all inventory items
  const fetchItems = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(API_BASE_URL, {
        headers: authHeaders
      });
      if (!response.ok) throw new Error('Failed to fetch inventory.');
      const data = await response.json();
      setItems(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  // Form handlers
  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFormPhotoFile(file);
      setFormPhotoPreview(URL.createObjectURL(file));
    }
  };

  const openAddModal = () => {
    setEditingItem(null);
    setFormCategory('neckpiece');
    setFormQuantity('1');
    setFormPrice('');
    setFormDescription('');
    setFormTags('');
    setFormCanSellSeparately(false);
    setFormPhotoFile(null);
    setFormPhotoPreview(null);
    setShowModal(true);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setFormCategory(item.category);
    setFormQuantity(String(item.quantity));
    setFormPrice(String(item.price));
    setFormDescription(item.description || '');
    setFormTags(Array.isArray(item.tags) ? item.tags.join(', ') : '');
    setFormCanSellSeparately(item.can_sell_separately === 1);
    setFormPhotoFile(null);
    setFormPhotoPreview(item.photo_url);
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (editingItem) {
        // PATCH existing item (Metadata only, photo is static)
        const updatePayload = {
          category: formCategory,
          quantity: parseInt(formQuantity),
          price: parseInt(formPrice),
          description: formDescription,
          tags: formTags,
          can_sell_separately: formCanSellSeparately
        };

        const response = await fetch(`${API_BASE_URL}/${editingItem.sku_id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify(updatePayload)
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Failed to update item');
        }
      } else {
        // POST new item (Requires photo file upload)
        if (!formPhotoFile) {
          throw new Error('Reference photo is required for new items');
        }

        const formData = new FormData();
        formData.append('photo', formPhotoFile);
        formData.append('category', formCategory);
        formData.append('quantity', formQuantity);
        formData.append('can_sell_separately', formCanSellSeparately ? 'true' : 'false');
        
        if (formPrice) formData.append('price', formPrice);
        if (formDescription) formData.append('description', formDescription);
        if (formTags) formData.append('tags', formTags);

        const response = await fetch(API_BASE_URL, {
          method: 'POST',
          headers: authHeaders,
          body: formData
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Failed to save item. Make sure price tag is legible or enter manually.');
        }
      }

      setShowModal(false);
      fetchItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (skuId) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/${skuId}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (!response.ok) throw new Error('Failed to delete item.');
      setDeleteConfirmItem(null);
      fetchItems();
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  // Filter and Sort calculation
  const filteredAndSortedItems = useMemo(() => {
    let result = [...items];

    // 1. Category Filter
    if (categoryFilter !== 'All') {
      result = result.filter(item => item.category === categoryFilter.toLowerCase());
    }

    // 2. Search Term Filter (checks description and tags)
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      result = result.filter(item => {
        const descMatch = (item.description || '').toLowerCase().includes(query);
        const skuMatch = (item.sku_id || '').toLowerCase().includes(query);
        const tagMatch = Array.isArray(item.tags) && item.tags.some(tag => tag.toLowerCase().includes(query));
        return descMatch || skuMatch || tagMatch;
      });
    }

    // 3. Sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'price-desc':
          return b.price - a.price;
        case 'price-asc':
          return a.price - b.price;
        case 'qty-desc':
          return b.quantity - a.quantity;
        case 'sku':
          return a.sku_id.localeCompare(b.sku_id);
        case 'oldest':
          return new Date(a.created_at) - new Date(b.created_at);
        case 'newest':
        default:
          return new Date(b.created_at) - new Date(a.created_at);
      }
    });

    return result;
  }, [items, categoryFilter, searchTerm, sortBy]);

  return (
    <div className="space-y-6">
      {/* CONTROLS HEADER */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 md:p-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          
          {/* SEARCH BAR */}
          <div className="relative w-full lg:w-96">
            <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search by SKU, tag, description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* FILTERING & SORTING SELECTORS */}
          <div className="flex flex-wrap gap-3 w-full lg:w-auto items-center justify-end">
            
            {/* Category Filter */}
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5">
              <Filter size={16} className="text-gray-400" />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-transparent text-sm font-medium text-gray-700 focus:outline-none cursor-pointer"
              >
                <option value="All">All Categories</option>
                <option value="Set">Sets</option>
                <option value="Neckpiece">Neckpieces</option>
                <option value="Earrings">Earrings</option>
              </select>
            </div>

            {/* Sort Filter */}
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5">
              <SlidersHorizontal size={16} className="text-gray-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-transparent text-sm font-medium text-gray-700 focus:outline-none cursor-pointer"
              >
                <option value="newest">Newest Stock</option>
                <option value="oldest">Oldest Stock</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="qty-desc">Quantity: High to Low</option>
                <option value="sku">SKU Code</option>
              </select>
            </div>

            {/* Refresh Button */}
            <button
              onClick={fetchItems}
              className="p-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-gray-500 transition-colors"
              title="Refresh Data"
            >
              <RefreshCw size={16} />
            </button>

            {/* Add Stock button */}
            <button
              onClick={openAddModal}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow-md hover:shadow-lg transition-all"
            >
              <Plus size={18} />
              Add Polki Stock
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3.5 rounded-xl flex items-center gap-2">
          <span className="font-semibold">Error:</span>
          <span>{error}</span>
        </div>
      )}

      {/* ITEMS CARD GRID (Aspect-ratio optimized for Portrait iPhone photos: 3:4) */}
      {isLoading && items.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm animate-pulse">
              <div className="aspect-[3/4] bg-gray-200 w-full" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-6 bg-gray-200 rounded w-2/3" />
                <div className="h-4 bg-gray-200 rounded w-full" />
                <div className="flex gap-2 pt-2">
                  <div className="h-6 bg-gray-200 rounded-full w-12" />
                  <div className="h-6 bg-gray-200 rounded-full w-12" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredAndSortedItems.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200">
          <Gem className="mx-auto text-gray-300 mb-3" size={48} />
          <p className="text-gray-500 font-medium text-lg">No Polki stock items found</p>
          <p className="text-gray-400 text-sm mt-1">Try modifying search term or category filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {filteredAndSortedItems.map((item) => (
            <div
              key={item.id}
              className="group bg-white rounded-2xl border border-gray-150 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col relative"
            >
              {/* IMAGE PORTRAIT HOLDER (3:4 ratio for iPhone uploads) */}
              <div className="relative aspect-[3/4] w-full bg-gray-50 overflow-hidden border-b border-gray-100">
                {item.photo_url ? (
                  <img
                    src={item.photo_url}
                    alt={item.sku_id}
                    onClick={() => setSelectedImage(item.photo_url)}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 cursor-zoom-in"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400">
                    <ImageIcon size={32} />
                  </div>
                )}

                {/* Overlaid Badges */}
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg text-white font-mono text-[10px] uppercase tracking-wider font-bold shadow-sm">
                  {item.sku_id}
                </div>

                <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-md px-2.5 py-1 rounded-lg text-indigo-700 text-[10px] uppercase font-bold tracking-wider shadow-sm">
                  {item.category}
                </div>

                {item.can_sell_separately === 1 && (
                  <div className="absolute bottom-3 left-3 bg-emerald-500/90 backdrop-blur-md px-2.5 py-1 rounded-lg text-white text-[9px] uppercase font-bold tracking-wider shadow-sm">
                    Separables Sellable
                  </div>
                )}
              </div>

              {/* CARD DETAILS */}
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex justify-between items-baseline">
                    <div className="text-xl font-extrabold text-gray-900">
                      ₹{item.price.toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                      Qty: {item.quantity}
                    </div>
                  </div>

                  {item.description ? (
                    <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed italic" title={item.description}>
                      {item.description}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No description provided</p>
                  )}

                  {/* Tags Capsule List */}
                  {Array.isArray(item.tags) && item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {item.tags.map((tag, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-semibold rounded-full"
                        >
                          <Tag size={8} />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-[10px] text-gray-400 capitalize">
                    Source: {item.source}
                  </span>
                  
                  {/* Card Actions */}
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditModal(item)}
                      className="p-1.5 hover:bg-gray-100 text-gray-500 hover:text-indigo-600 rounded-lg transition"
                      title="Edit Item Info"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmItem(item)}
                      className="p-1.5 hover:bg-gray-100 text-gray-500 hover:text-red-600 rounded-lg transition"
                      title="Delete Item"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* INPUT / UPDATE MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all duration-300">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-gray-100 transform scale-100">
            
            <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Sparkles size={18} className="text-indigo-500" />
                {editingItem ? `Edit Polki Stock: ${editingItem.sku_id}` : 'Add New Polki Stock'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 hover:bg-gray-200 rounded-full text-gray-400 hover:text-gray-600 transition"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              
              {/* Image Upload field (Manual only) */}
              {!editingItem && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Reference Image *
                  </label>
                  <div className="flex items-center justify-center w-full">
                    <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100 hover:border-indigo-400 transition">
                      {formPhotoPreview ? (
                        <img
                          src={formPhotoPreview}
                          alt="Preview"
                          className="h-full w-full object-cover rounded-xl"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          <ImageIcon className="w-8 h-8 text-gray-400 mb-2" />
                          <p className="text-xs text-gray-500">
                            Upload portrait tag photo
                          </p>
                          <p className="text-[10px] text-gray-400 mt-1">
                            PNG, JPG, HEIC up to 10MB
                          </p>
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoChange}
                        className="hidden"
                        required={!editingItem}
                      />
                    </label>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {/* Category Selection */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase">
                    Category
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="neckpiece">Neckpiece</option>
                    <option value="set">Set</option>
                    <option value="earrings">Earrings</option>
                  </select>
                </div>

                {/* Quantity input */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase">
                    Quantity
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formQuantity}
                    onChange={(e) => setFormQuantity(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {/* Price (Manual Override / OCR) */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase">
                    Price (INR)
                  </label>
                  <input
                    type="number"
                    placeholder={editingItem ? "Price amount" : "Leave empty to attempt OCR on image tag"}
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required={!!editingItem} // Required only during edits since OCR runs during creates
                  />
                </div>
              </div>

              {/* Tags Comma-separated */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. bridal, kundan, heavy"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Description free-text */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase">
                  Description
                </label>
                <textarea
                  placeholder="Add notes, dimensions, or details..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows="2"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              {/* Toggle switch for can_sell_separately */}
              {formCategory === 'set' && (
                <div className="flex items-center justify-between py-2 bg-gray-50 px-3 rounded-lg border border-gray-150">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-gray-700">Mix & Match Sellable</span>
                    <p className="text-[10px] text-gray-400">Can the components of this set be sold separately?</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formCanSellSeparately}
                    onChange={(e) => setFormCanSellSeparately(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded cursor-pointer"
                  />
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm hover:shadow transition disabled:opacity-50"
                >
                  {isLoading ? 'Processing...' : editingItem ? 'Save Updates' : 'Add to Inventory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FULL-SIZE IMAGE PREVIEW OVERLAY */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 cursor-pointer"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute -top-4 -right-4 bg-white text-gray-800 rounded-full p-1.5 shadow hover:bg-gray-100 transition z-10"
            >
              <X size={20} />
            </button>
            <img
              src={selectedImage}
              alt="Polki preview"
              className="max-w-[85vw] max-h-[85vh] object-contain rounded-xl shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteConfirmItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm border border-gray-100">
            <h2 className="text-base font-bold text-gray-900 mb-2">Delete Inventory Item</h2>
            <p className="text-xs text-gray-650 mb-6 leading-relaxed">
              Are you sure you want to delete SKU <strong>{deleteConfirmItem.sku_id}</strong>? This will soft-delete the item and remove it from lists. This action is irreversible.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmItem(null)}
                className="px-4 py-2 bg-gray-150 hover:bg-gray-200 text-gray-600 rounded-xl text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmItem.sku_id)}
                disabled={isLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-sm hover:shadow transition"
              >
                {isLoading ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryView;
