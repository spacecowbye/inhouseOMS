// src/components/KarigarGalleryView.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Plus,
  CheckCircle2,
  RotateCcw,
  Image as ImageIcon,
  Tag,
  Calendar,
  Clock,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  Hammer,
  User,
  RefreshCw,
  Trash2,
  FileText,
  HelpCircle,
  Eye,
  SlidersHorizontal
} from 'lucide-react';
import Gallery from './Gallery';

const API_BASE_URL = '/api/karigar-repairs';

export default function KarigarGalleryView({ authHeaders }) {
  const [repairs, setRepairs] = useState([]);
  const [stats, setStats] = useState({
    totalActivePieces: 0,
    activeJobs: 0,
    activeKarigars: 0,
    returnedThisMonth: 0
  });
  const [karigarList, setKarigarList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filter States
  const [statusFilter, setStatusFilter] = useState('with_karigar'); // 'with_karigar', 'returned', 'all'
  const [selectedKarigar, setSelectedKarigar] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('newest'); // 'newest', 'oldest', 'karigar', 'pieces'

  // Card photo carousel indices (repairId -> index)
  const [cardPhotoIndex, setCardPhotoIndex] = useState({});

  // Lightbox Modal state
  const [activeLightboxPhotos, setActiveLightboxPhotos] = useState(null);
  const [activeLightboxTitle, setActiveLightboxTitle] = useState('');

  // Add Repair Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [formKarigarName, setFormKarigarName] = useState('');
  const [formOrderId, setFormOrderId] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formFiles, setFormFiles] = useState([]);
  const [formPreviews, setFormPreviews] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quick Action States
  const [copiedSerial, setCopiedSerial] = useState(null);
  const [showHelpGuide, setShowHelpGuide] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Fetch Karigar Repairs data
  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams();
      if (statusFilter !== 'all') queryParams.append('status', statusFilter);
      if (selectedKarigar !== 'all') queryParams.append('karigar', selectedKarigar);
      if (searchTerm.trim()) queryParams.append('search', searchTerm.trim());
      queryParams.append('sortBy', sortBy);

      const res = await fetch(`${API_BASE_URL}?${queryParams.toString()}`, {
        headers: authHeaders
      });

      if (!res.ok) throw new Error('Failed to fetch Karigar repairs data');
      const json = await res.json();

      setRepairs(json.data || []);
      if (json.stats) setStats(json.stats);
      if (json.karigars) setKarigarList(json.karigars);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Error loading records');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [statusFilter, selectedKarigar, sortBy]);

  // Handle Search Debounced / Enter
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchData();
  };

  // Quick return item (Mark Returned)
  const handleMarkReturned = async (id, serial) => {
    try {
      const res = await fetch(`${API_BASE_URL}/${id}/return`, {
        method: 'PUT',
        headers: authHeaders
      });
      if (!res.ok) throw new Error('Failed to update status');

      // If viewing active items, remove from view immediately
      if (statusFilter === 'with_karigar') {
        setRepairs(prev => prev.filter(item => item.id !== id));
      } else {
        fetchData();
      }
    } catch (err) {
      alert('Error marking item as returned: ' + err.message);
    }
  };

  // Quick reopen item
  const handleReopen = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/${id}/reopen`, {
        method: 'PUT',
        headers: authHeaders
      });
      if (!res.ok) throw new Error('Failed to reopen repair');
      fetchData();
    } catch (err) {
      alert('Error reopening repair: ' + err.message);
    }
  };

  // Delete repair entry
  const handleDelete = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/${id}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (!res.ok) throw new Error('Failed to delete');
      setDeleteConfirmId(null);
      fetchData();
    } catch (err) {
      alert('Error deleting: ' + err.message);
    }
  };

  // File selection for Add Modal
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setFormFiles(files);
    const previews = files.map(file => URL.createObjectURL(file));
    setFormPreviews(previews);
  };

  // Submit Add Modal
  const handleCreateRepair = async (e) => {
    e.preventDefault();
    if (!formKarigarName.trim()) {
      alert('Please enter a Karigar name.');
      return;
    }
    if (formFiles.length === 0) {
      alert('Please attach at least one photo of the pieces.');
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('karigar_name', formKarigarName.trim());
      formData.append('order_id', formOrderId.trim());
      formData.append('notes', formNotes.trim());

      for (let i = 0; i < formFiles.length; i++) {
        formData.append('photos', formFiles[i]);
      }

      const res = await fetch(API_BASE_URL, {
        method: 'POST',
        headers: {
          ...authHeaders
        },
        body: formData
      });

      if (!res.ok) {
        const errorJson = await res.json();
        throw new Error(errorJson.message || 'Failed to create karigar repair');
      }

      setShowAddModal(false);
      setFormKarigarName('');
      setFormOrderId('');
      setFormNotes('');
      setFormFiles([]);
      setFormPreviews([]);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to log repair: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Copy /kc command helper
  const handleCopyCommand = (serial) => {
    const cmd = `/kc ${serial.toLowerCase()}`;
    navigator.clipboard.writeText(cmd);
    setCopiedSerial(serial);
    setTimeout(() => setCopiedSerial(null), 2500);
  };

  // Card photo carousel navigation
  const prevPhoto = (e, repairId, photosLength) => {
    e.stopPropagation();
    setCardPhotoIndex(prev => {
      const current = prev[repairId] || 0;
      return { ...prev, [repairId]: current === 0 ? photosLength - 1 : current - 1 };
    });
  };

  const nextPhoto = (e, repairId, photosLength) => {
    e.stopPropagation();
    setCardPhotoIndex(prev => {
      const current = prev[repairId] || 0;
      return { ...prev, [repairId]: (current + 1) % photosLength };
    });
  };

  // Relative time helper
  const formatTimeAgo = (dateStr) => {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const sentDate = new Date(parts[0], parts[1] - 1, parts[2]);
        const today = new Date();
        const diffDays = Math.floor((today - sentDate) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays > 1) return `${diffDays} days ago`;
      }
    } catch {
      // Fallback
    }
    return dateStr;
  };

  return (
    <div className="space-y-6 pb-16">

      {/* TOP METRICS HERO BANNER */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 md:p-5 shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs md:text-sm font-medium text-gray-500 uppercase">
              Pieces With Karigar
            </span>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl md:text-4xl font-bold text-gray-900">
              {stats.totalActivePieces}
            </span>
            <span className="text-xs text-gray-500">active pieces</span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4 md:p-5 shadow">
          <div className="text-xs md:text-sm font-semibold text-gray-500 tracking-wide uppercase">
            Active Job Batches
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl md:text-4xl font-bold text-gray-900">
              {stats.activeJobs}
            </span>
            <span className="text-xs text-gray-500 font-medium">serial slots</span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4 md:p-5 shadow">
          <div className="text-xs md:text-sm font-semibold text-gray-500 tracking-wide uppercase">
            Karigars Working
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl md:text-4xl font-bold text-indigo-900">
              {stats.activeKarigars}
            </span>
            <span className="text-xs text-indigo-600 font-medium">craftsmen</span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4 md:p-5 shadow">
          <div className="text-xs md:text-sm font-semibold text-gray-500 tracking-wide uppercase">
            Returned This Month
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl md:text-4xl font-bold text-emerald-800">
              {stats.returnedThisMonth}
            </span>
            <span className="text-xs text-emerald-600 font-medium">back in showroom</span>
          </div>
        </div>
      </div>

      {/* SEARCH, STATUS & CONTROLS TOOLBAR */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow space-y-4">

        {/* Row 1: Status Segments + Action Buttons */}
        <div className="flex flex-col md:flex-row justify-between gap-3 items-stretch md:items-center">

          {/* Status Tabs */}
          <div className="inline-flex bg-gray-100 p-1 rounded-lg border border-gray-200 self-start">
            <button
              onClick={() => setStatusFilter('with_karigar')}
              className={`px-3.5 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition-all duration-150 flex items-center gap-1.5 ${
                statusFilter === 'with_karigar'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>With Karigar (Active)</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                statusFilter === 'with_karigar' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'
              }`}>
                {stats.totalActivePieces}
              </span>
            </button>

            <button
              onClick={() => setStatusFilter('returned')}
              className={`px-3.5 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition-all duration-150 flex items-center gap-1.5 ${
                statusFilter === 'returned'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>Returned to Showroom</span>
            </button>

            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition-all duration-150 ${
                statusFilter === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              All Records
            </button>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowHelpGuide(!showHelpGuide)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs md:text-sm font-medium text-gray-700 bg-gray-50 border border-gray-300 rounded-lg hover:bg-gray-100 transition"
              title="View WhatsApp commands guide"
            >
              <HelpCircle size={16} className="text-indigo-600" />
              <span>WhatsApp Commands</span>
            </button>

            <button
              onClick={fetchData}
              className="p-2 text-gray-600 hover:text-gray-900 bg-gray-50 border border-gray-300 rounded-lg hover:bg-gray-100 transition"
              title="Refresh Records"
            >
              <RefreshCw size={16} />
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs md:text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition shadow-sm"
            >
              <Plus size={18} />
              <span>Log Karigar Repair</span>
            </button>
          </div>
        </div>

        {/* WhatsApp Command Cheat Sheet (Expandable) */}
        {showHelpGuide && (
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 text-xs md:text-sm text-amber-950 space-y-2">
            <div className="flex justify-between items-center font-bold text-amber-900">
              <div className="flex items-center gap-2">
                <Hammer size={16} className="text-amber-700" />
                <span>WhatsApp Bot Commands Guide</span>
              </div>
              <button
                onClick={() => setShowHelpGuide(false)}
                className="text-amber-800 hover:text-amber-950 p-1"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div className="bg-white/90 p-3 rounded-lg border border-amber-200/70">
                <span className="font-bold text-amber-900 block mb-1">1. Send to Karigar (`/kr`)</span>
                <p className="text-gray-700 mb-1">
                  • <strong>1 Photo:</strong> Send photo on WhatsApp with caption:
                  <code className="ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-900 font-mono rounded">/kr Hemant</code>
                </p>
                <p className="text-gray-700">
                  • <strong>Multi-photo:</strong> Send:
                  <code className="ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-900 font-mono rounded">/kr Hemant 3</code>
                  then send the 3 photos. Auto-generates serial like <strong>HEM1</strong>.
                </p>
              </div>

              <div className="bg-white/90 p-3 rounded-lg border border-amber-200/70">
                <span className="font-bold text-emerald-900 block mb-1">2. Returned to Showroom (`/kc`)</span>
                <p className="text-gray-700 mb-1">
                  When the piece returns from the workshop, simply send:
                  <code className="ml-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-900 font-mono rounded">/kc HEM1</code>
                </p>
                <p className="text-gray-600 text-[11px]">
                  Instantly marks it returned and removes the photos from the active workshop gallery!
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Row 2: Search + Sort + Karigar Pills */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={17} />
            <input
              type="text"
              placeholder="Search by serial (e.g. HEM1), karigar name, order / inv #..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs md:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
            />
          </form>

          {/* Sort Selector */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-gray-50 border border-gray-300 text-xs md:text-sm rounded-lg px-3 py-2 font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="newest">Newest Sent</option>
              <option value="oldest">Oldest Sent</option>
              <option value="karigar">Karigar Name (A-Z)</option>
              <option value="pieces">Most Pieces</option>
            </select>
          </div>
        </div>

        {/* Row 3: Karigar Filter Pills */}
        {karigarList.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar pt-1 border-t border-gray-100">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-1 flex-shrink-0">
              Karigar:
            </span>

            <button
              onClick={() => setSelectedKarigar('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition whitespace-nowrap ${
                selectedKarigar === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All Karigars
            </button>

            {karigarList.map((k) => (
              <button
                key={k.name}
                onClick={() => setSelectedKarigar(k.name)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition whitespace-nowrap flex items-center gap-1.5 ${
                  selectedKarigar.toLowerCase() === k.name.toLowerCase()
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>{k.name}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  selectedKarigar.toLowerCase() === k.name.toLowerCase()
                    ? 'bg-amber-700 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {k.activePieces}
                </span>
              </button>
            ))}
          </div>
        )}

      </div>

      {/* ERROR MESSAGE */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm flex items-center gap-2">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* LOADING SKELETON */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {[1, 2, 3, 4, 5, 6].map(n => (
            <div key={n} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3 animate-pulse">
              <div className="h-48 bg-gray-200 rounded-xl"></div>
              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
              <div className="h-6 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-100 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      )}

      {/* EMPTY STATE */}
      {!isLoading && repairs.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 text-center max-w-xl mx-auto space-y-4">
          <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <Hammer size={32} />
          </div>
          <h3 className="text-lg md:text-xl font-bold text-gray-900">
            {statusFilter === 'with_karigar' ? 'No Pieces Currently with Karigars' : 'No Repair Records Found'}
          </h3>
          <p className="text-sm text-gray-500">
            {statusFilter === 'with_karigar'
              ? 'All sent repair pieces have been returned to the showroom, or no pieces match your current filters.'
              : 'Try changing your search terms or filter selection.'}
          </p>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={() => {
                setStatusFilter('all');
                setSelectedKarigar('all');
                setSearchTerm('');
              }}
              className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 font-semibold text-xs rounded-xl transition"
            >
              Clear Filters
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white font-bold text-xs rounded-lg hover:bg-indigo-700 transition shadow"
            >
              + Log New Karigar Repair
            </button>
          </div>
        </div>
      )}

      {/* GALLERY CARDS GRID */}
      {!isLoading && repairs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {repairs.map(item => {
            const photos = item.photos || (item.photo_urls ? item.photo_urls.split(',') : []);
            const currentIdx = cardPhotoIndex[item.id] || 0;
            const currentPhotoUrl = photos[currentIdx] || photos[0];
            const isReturned = item.status === 'returned';

            return (
              <div
                key={item.id}
                className={`bg-white border rounded-lg overflow-hidden shadow hover:shadow-md transition-all duration-200 flex flex-col justify-between ${
                  isReturned
                    ? 'border-gray-200 opacity-90'
                    : 'border-gray-200 hover:border-indigo-300'
                }`}
              >
                <div>
                  {/* CARD HEADER */}
                  <div className="p-3.5 pb-2.5 flex items-center justify-between gap-2 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      {/* LUXURY METALLIC HALLMARK SERIAL BADGE */}
                      <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-bold tracking-wider bg-indigo-100 text-indigo-700 font-mono">
                        {item.serial_number}
                      </span>

                      {/* Karigar Name Badge */}
                      <div className="flex items-center gap-1 text-xs font-bold text-gray-800">
                        <User size={13} className="text-gray-400" />
                        <span className="truncate max-w-[120px]">{item.karigar_name}</span>
                      </div>
                    </div>

                    {/* STATUS PILL */}
                    {isReturned ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 size={11} />
                        <span>Returned</span>
                      </span>
                    ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-900">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                        <span>With Karigar</span>
                      </span>
                    )}
                  </div>

                  {/* PHOTO SHOWCASE (VIEWPORT) */}
                  <div className="relative aspect-[4/3] bg-gray-950 overflow-hidden group cursor-pointer"
                    onClick={() => {
                      if (photos.length > 0) {
                        setActiveLightboxPhotos(photos);
                        setActiveLightboxTitle(`${item.serial_number} - ${item.karigar_name}`);
                      }
                    }}
                  >
                    {currentPhotoUrl ? (
                      <img
                        src={currentPhotoUrl}
                        alt={`Piece ${currentIdx + 1} for ${item.serial_number}`}
                        className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-600">
                        <ImageIcon size={32} />
                        <span className="text-xs mt-1">No photo available</span>
                      </div>
                    )}

                    {/* Multi-photo overlay indicator */}
                    {photos.length > 1 && (
                      <div className="absolute top-2.5 right-2.5 px-2 py-0.5 bg-black/75 backdrop-blur-md rounded-full text-white text-[11px] font-bold shadow flex items-center gap-1">
                        <ImageIcon size={11} />
                        <span>{currentIdx + 1} / {photos.length}</span>
                      </div>
                    )}

                    {/* Quick Lightbox Zoom Icon on Hover */}
                    <div className="absolute bottom-2.5 right-2.5 p-1.5 bg-black/60 backdrop-blur-sm rounded-lg text-white opacity-0 group-hover:opacity-100 transition shadow">
                      <Eye size={15} />
                    </div>

                    {/* Carousel Navigation Buttons on Card */}
                    {photos.length > 1 && (
                      <>
                        <button
                          onClick={(e) => prevPhoto(e, item.id, photos.length)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/80 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition"
                          title="Previous piece photo"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          onClick={(e) => nextPhoto(e, item.id, photos.length)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/80 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition"
                          title="Next piece photo"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </>
                    )}
                  </div>

                  {/* CARD BODY DETAILS */}
                  <div className="p-3.5 space-y-2">

                    {/* Order / Invoice Number tag */}
                    {item.order_id && (
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded-md text-[11px] font-semibold text-gray-700">
                        <FileText size={12} className="text-amber-600" />
                        <span>Order / Inv: #{item.order_id}</span>
                      </div>
                    )}

                    {/* Notes */}
                    {item.notes && (
                      <p className="text-xs text-gray-600 line-clamp-2 italic">
                        "{item.notes}"
                      </p>
                    )}

                    {/* Dates */}
                    <div className="text-[11px] text-gray-500 space-y-0.5 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <Calendar size={11} className="text-gray-400" />
                          <span>Sent: {item.sent_date}</span>
                        </span>
                        {!isReturned && (
                          <span className="font-semibold text-amber-700">
                            {formatTimeAgo(item.sent_date)}
                          </span>
                        )}
                      </div>

                      {isReturned && item.returned_date && (
                        <div className="flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 size={11} />
                          <span>Returned: {item.returned_date}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* CARD FOOTER ACTIONS */}
                <div className="p-3 pt-0 border-t border-gray-100 bg-gray-50/50 mt-2 flex items-center justify-between gap-2">

                  {/* Mark Returned / Reopen Button */}
                  {!isReturned ? (
                    <button
                      onClick={() => handleMarkReturned(item.id, item.serial_number)}
                      className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition shadow-sm flex items-center justify-center gap-1.5"
                      title="Mark pieces as returned back to showroom"
                    >
                      <CheckCircle2 size={14} />
                      <span>Mark Returned</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleReopen(item.id)}
                      className="py-1.5 px-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold rounded-lg transition flex items-center gap-1"
                      title="Move back to with karigar"
                    >
                      <RotateCcw size={13} />
                      <span>Reopen</span>
                    </button>
                  )}

                  {/* Copy /kc command */}
                  <button
                    onClick={() => handleCopyCommand(item.serial_number)}
                    className="p-1.5 text-gray-500 hover:text-gray-800 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition"
                    title={`Copy /kc ${item.serial_number.toLowerCase()} to clipboard`}
                  >
                    {copiedSerial === item.serial_number ? (
                      <Check size={14} className="text-emerald-600" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => setDeleteConfirmId(item.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 bg-white border border-gray-200 rounded-lg hover:bg-red-50 transition"
                    title="Delete record"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* LIGHTBOX FULLSCREEN MODAL */}
      {activeLightboxPhotos && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4"
          onClick={() => setActiveLightboxPhotos(null)}
        >
          {/* Header Bar */}
          <div className="absolute top-4 left-6 right-6 flex items-center justify-between z-30 text-white">
            <span className="font-bold text-sm md:text-base font-serif">
              {activeLightboxTitle}
            </span>
            <button
              onClick={() => setActiveLightboxPhotos(null)}
              className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition"
            >
              <X size={20} />
            </button>
          </div>

          <div onClick={(e) => e.stopPropagation()}>
            <Gallery images={activeLightboxPhotos} />
          </div>
        </div>
      )}

      {/* LOG KARIGAR REPAIR MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-200">

            {/* Modal Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hammer size={18} />
                <h3 className="font-bold text-base md:text-lg">Log Pieces Sent to Karigar</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-amber-100 hover:text-white p-1 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateRepair} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Karigar Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Hemant, Babu, Suresh"
                  value={formKarigarName}
                  onChange={(e) => setFormKarigarName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  required
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Serial will be auto-generated with the first 3 letters (e.g. <strong>HEM1</strong>).
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Order / Invoice # (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 1042 or R-402"
                  value={formOrderId}
                  onChange={(e) => setFormOrderId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Attach Pieces Photos <span className="text-red-500">*</span>
                </label>
                <input
                  type="file"
                  multiple
                  accept="image/*,.heic,.heif"
                  onChange={handleFileChange}
                  className="w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-amber-100 file:text-amber-800 hover:file:bg-amber-200"
                  required
                />

                {/* Previews */}
                {formPreviews.length > 0 && (
                  <div className="flex gap-2 mt-3 overflow-x-auto pb-1 no-scrollbar">
                    {formPreviews.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`Preview ${i + 1}`}
                        className="w-16 h-16 object-cover rounded-lg border border-amber-300 flex-shrink-0"
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Repair Notes / Instructions
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Resize ring to 14, lock repair, polish necklace"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full px-3.5 py-2 bg-gray-50 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                />
              </div>

              <div className="pt-3 flex justify-end gap-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition shadow disabled:opacity-50"
                >
                  {isSubmitting ? 'Uploading & Creating...' : 'Save & Generate Serial'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h4 className="text-base font-bold text-gray-900">Confirm Deletion</h4>
            <p className="text-sm text-gray-600">
              Are you sure you want to delete this Karigar repair record? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
