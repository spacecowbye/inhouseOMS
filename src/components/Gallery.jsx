import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Gallery({ images }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    // Add keyboard listener for left/right arrow keys
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

  const handlePrev = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
    setTimeout(() => setIsTransitioning(false), 200);
  };

  const handleNext = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
    setTimeout(() => setIsTransitioning(false), 200);
  };

  return (
    <div className="relative flex flex-col items-center justify-center select-none max-w-[90vw] max-h-[80vh]">
      {/* Top Counter Header */}
      <div className="absolute top-4 left-4 z-10 px-3 py-1 bg-black bg-opacity-65 backdrop-blur-md rounded-full text-white text-xs font-semibold tracking-wider shadow">
        {currentIndex + 1} / {images.length}
      </div>

      {/* Image Container */}
      <div className="relative flex items-center justify-center overflow-hidden rounded-xl shadow-2xl border border-gray-800 bg-black min-w-[300px] min-h-[300px]">
        <img
          src={images[currentIndex]}
          alt={`Jewelry view ${currentIndex + 1}`}
          className={`max-w-[85vw] max-h-[70vh] object-contain transition-all duration-200 ${
            isTransitioning ? "opacity-40 scale-95" : "opacity-100 scale-100"
          }`}
        />

        {/* Navigation Buttons */}
        {images.length > 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              className="absolute left-3 p-2 rounded-full bg-white bg-opacity-20 hover:bg-opacity-40 active:bg-opacity-50 text-white hover:scale-105 active:scale-95 transition-all duration-150 backdrop-blur-sm"
              title="Previous Image (Left Arrow)"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="absolute right-3 p-2 rounded-full bg-white bg-opacity-20 hover:bg-opacity-40 active:bg-opacity-50 text-white hover:scale-105 active:scale-95 transition-all duration-150 backdrop-blur-sm"
              title="Next Image (Right Arrow)"
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}
      </div>

      {/* Indicators/Dots */}
      {images.length > 1 && (
        <div className="flex gap-2 mt-4 px-4 py-1.5 bg-black bg-opacity-40 backdrop-blur-md rounded-full">
          {images.map((_, idx) => (
            <button
              key={idx}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(idx);
              }}
              className={`h-2 rounded-full transition-all duration-300 ${
                idx === currentIndex ? "w-6 bg-yellow-400" : "w-2 bg-gray-500 hover:bg-gray-300"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
