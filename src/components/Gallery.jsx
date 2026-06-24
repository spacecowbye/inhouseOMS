import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Gallery({ images }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const containerRef = useRef(null);
  const isScrollingRef = useRef(false);

  useEffect(() => {
    // Keyboard arrow keys listener
    const handleKeyDown = (e) => {
      if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, images]);

  if (!images || images.length === 0) return null;

  const scrollToImage = (index) => {
    if (!containerRef.current) return;
    isScrollingRef.current = true;
    const container = containerRef.current;
    const width = container.clientWidth;
    container.scrollTo({
      left: index * width,
      behavior: "smooth"
    });
    setCurrentIndex(index);
    // Release scroll listener lock after smooth transition completes
    setTimeout(() => {
      isScrollingRef.current = false;
    }, 450);
  };

  const handlePrev = () => {
    const nextIdx = currentIndex === 0 ? images.length - 1 : currentIndex - 1;
    scrollToImage(nextIdx);
  };

  const handleNext = () => {
    const nextIdx = currentIndex === images.length - 1 ? 0 : currentIndex + 1;
    scrollToImage(nextIdx);
  };

  const handleScroll = () => {
    if (!containerRef.current || isScrollingRef.current) return;
    const container = containerRef.current;
    const scrollLeft = container.scrollLeft;
    const width = container.clientWidth;
    if (width === 0) return;
    const index = Math.round(scrollLeft / width);
    if (index !== currentIndex && index >= 0 && index < images.length) {
      setCurrentIndex(index);
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center select-none max-w-[90vw] max-h-[85vh]">
      {/* Native scrollbar hiding styles */}
      <style dangerouslySetInnerHTML={{__html: `
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />

      {/* Top Counter Header */}
      <div className="absolute top-4 left-4 z-20 px-3 py-1 bg-black bg-opacity-75 backdrop-blur-md rounded-full text-white text-xs font-semibold tracking-wider shadow">
        {currentIndex + 1} / {images.length}
      </div>

      {/* Main Image Viewport (Horizontal Scroll-Snap) */}
      <div className="relative flex items-center justify-center rounded-xl shadow-2xl border border-gray-800 bg-black min-w-[300px] min-h-[300px] w-full max-w-[85vw] max-h-[65vh]">
        
        {/* Scrollable Container */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar w-full max-w-[85vw] max-h-[65vh]"
          style={{ scrollBehavior: "auto" }}
        >
          {images.map((img, idx) => (
            <div
              key={idx}
              className="w-full flex-shrink-0 flex items-center justify-center snap-center snap-always max-h-[65vh]"
            >
              <img
                src={img}
                alt={`Jewelry view ${idx + 1}`}
                className="max-w-[85vw] max-h-[65vh] object-contain"
              />
            </div>
          ))}
        </div>

        {/* Navigation Buttons */}
        {images.length > 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              className="absolute left-3 p-2 rounded-full bg-white bg-opacity-15 hover:bg-opacity-35 active:bg-opacity-50 text-white hover:scale-105 active:scale-95 transition-all duration-150 backdrop-blur-sm z-10"
              title="Previous Image (Left Arrow)"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="absolute right-3 p-2 rounded-full bg-white bg-opacity-15 hover:bg-opacity-35 active:bg-opacity-50 text-white hover:scale-105 active:scale-95 transition-all duration-150 backdrop-blur-sm z-10"
              title="Next Image (Right Arrow)"
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}
      </div>

      {/* Horizontal Scrollable Thumbnails Tray */}
      {images.length > 1 && (
        <div className="flex gap-2.5 mt-4 max-w-[85vw] overflow-x-auto no-scrollbar py-1 px-2 bg-black bg-opacity-20 backdrop-blur-sm rounded-xl">
          {images.map((img, idx) => (
            <button
              key={idx}
              onClick={(e) => {
                e.stopPropagation();
                scrollToImage(idx);
              }}
              className={`w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-all duration-200 ${
                idx === currentIndex
                  ? "border-amber-400 scale-105 shadow-md shadow-amber-500/20"
                  : "border-gray-800 hover:border-gray-600 opacity-60 hover:opacity-100"
              }`}
            >
              <img
                src={img}
                alt={`Thumb ${idx + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
