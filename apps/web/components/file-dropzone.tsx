// "use client";

// import { useCallback, useRef, useState } from "react";
// import { formatBytes, truncateName } from "@/lib/format";

// interface FileDropzoneProps {
//   files: File[];
//   onFilesSelected: (files: File[]) => void;
//   onRemoveFile: (index: number) => void;
//   disabled?: boolean;
// }

// export function FileDropzone({
//   files,
//   onFilesSelected,
//   onRemoveFile,
//   disabled = false,
// }: FileDropzoneProps) {
//   const inputRef = useRef<HTMLInputElement>(null);
//   const [dragging, setDragging] = useState(false);

//   const handleFiles = useCallback(
//     (newFiles: File[]) => {
//       if (disabled || newFiles.length === 0) return;
//       onFilesSelected([...files, ...newFiles]);
//     },
//     [files, onFilesSelected, disabled]
//   );

//   const handleDrop = useCallback(
//     (e: React.DragEvent<HTMLButtonElement>) => {
//       e.preventDefault();
//       e.stopPropagation();
//       setDragging(false);
//       if (disabled) return;

//       const droppedFiles = Array.from(e.dataTransfer.files);
//       if (droppedFiles.length > 0) handleFiles(droppedFiles);
//     },
//     [disabled, handleFiles]
//   );

//   const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

//   return (
//     <div className="w-full font-sans">
//       {/* Drop Zone Box with Hand-drawn Loose Dashed Border */}
//       <button
//         type="button"
//         disabled={disabled}
//         onClick={() => !disabled && inputRef.current?.click()}
//         onDragEnter={(e) => {
//           e.preventDefault();
//           if (!disabled) setDragging(true);
//         }}
//         onDragOver={(e) => {
//           e.preventDefault();
//           if (!disabled) setDragging(true);
//         }}
//         onDragLeave={(e) => {
//           e.preventDefault();
//           setDragging(false);
//         }}
//         onDrop={handleDrop}
//         className={`group relative flex min-h-[175px] w-full flex-col items-center justify-center rounded-2xl border-[2.2px] p-5 text-center transition-all duration-200 ${
//           dragging
//             ? "border-[#1c1c1e] bg-white/60 shadow-sm"
//             : "border-[#1c1c1e]/40 bg-transparent hover:border-[#1c1c1e]/80 hover:bg-white/20"
//         } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
//         style={{
//           borderStyle: "dashed",
//           strokeDasharray: "10 12", // Custom wide dash spacing matching sketch art
//         }}
//       >
//         <div className="flex flex-col items-center justify-center space-y-1.5">
//           {/* Animated Blinking Cat with Paws on Cardboard Box */}
//           <div className="mb-0.5 transform transition-transform duration-200 group-hover:scale-105">
//             <BlinkingCatInBox />
//           </div>

//           <span className="text-base font-bold tracking-tight text-[#1c1c1e]">
//             Choose files
//           </span>
//           <span className="text-xs font-normal text-[#5e5e62]">
//             or drop them here
//           </span>
//         </div>
//       </button>

//       <input
//         ref={inputRef}
//         type="file"
//         multiple
//         disabled={disabled}
//         className="hidden"
//         onChange={(e) => {
//           const selected = Array.from(e.target.files ?? []);
//           if (selected.length > 0) handleFiles(selected);
//           e.target.value = "";
//         }}
//       />

//        {/* File summary bar */}

//       <div className="mt-2 flex items-center justify-between px-1 text-[11px] font-semibold text-[#6e6e73]">

//         <span>{files.length} {files.length === 1 ? "file" : "files"}</span>

//         <span>{formatBytes(totalBytes)}</span>

//       </div>



//       {/* File List */}

//       {files.length > 0 && (

//         <div className="mt-3 divide-y divide-[#2b2b2b]/10 rounded-md border border-[#2b2b2b]/20 bg-transparent px-3">

//           {files.map((file, index) => (

//             <div key={`${file.name}-${index}`} className="flex items-center justify-between py-2 text-xs font-medium">

//               <div className="flex items-center gap-2 overflow-hidden">

//                 <FileIcon />

//                 <span className="truncate text-[#1c1c1e]">{truncateName(file.name, 28)}</span>

//               </div>

//               <div className="flex shrink-0 items-center gap-3">

//                 <span className="text-[11px] text-[#6e6e73]">{formatBytes(file.size)}</span>

//                 {!disabled && (

//                   <button

//                     type="button"

//                     onClick={() => onRemoveFile(index)}

//                     aria-label={`Remove ${file.name}`}

//                     className="p-0.5 text-gray-500 hover:text-black"

//                   >

//                     <CloseIcon />

//                   </button>

//                 )}

//               </div>

//             </div>

//           ))}

//         </div>

//       )}
//     </div>
//   );
// }

// function BlinkingCatInBox() {
//   return (
//     <svg
//       width="135"
//       height="90"
//       viewBox="0 0 220 170"
//       fill="none"
//       xmlns="http://www.w3.org/2000/svg"
//       className="select-none"
//       style={{ strokeDasharray: "none" }}
//     >
//       <defs>
//         {/* Organic Hand-Drawn Pencil Filter */}
//         <filter id="pencilSketchFilter" x="-10%" y="-10%" width="120%" height="120%">
//           <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" result="noise" />
//           <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.1" xChannelSelector="R" yChannelSelector="G" />
//         </filter>

//         {/* Pencil Shading Pattern */}
//         <pattern id="pencilHatchPattern" width="5" height="5" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
//           <line x1="0" y1="0" x2="0" y2="5" stroke="#2c2c2e" strokeWidth="0.8" opacity="0.3" style={{ strokeDasharray: "none" }} />
//         </pattern>

//         <style>{`
//           @keyframes catBlink {
//             0%, 90%, 100% { transform: scaleY(1); }
//             95% { transform: scaleY(0.08); }
//           }
//           .cat-blinking-eye {
//             animation: catBlink 4.2s infinite ease-in-out;
//             transform-origin: 110px 75px;
//           }
//         `}</style>
//       </defs>

//       {/* --- GROUND SHADOW --- */}
//       <g filter="url(#pencilSketchFilter)">
//         <ellipse cx="110" cy="162" rx="70" ry="4" fill="url(#pencilHatchPattern)" style={{ strokeDasharray: "none" }} />
//       </g>

//       {/* --- CAT & BOX ASSEMBLY --- */}
//       <g filter="url(#pencilSketchFilter)">
//         {/* Dark Inner Box Interior Behind Cat */}
//         <path 
//           d="M 42 92 L 178 92 L 178 104 L 42 104 Z" 
//           fill="url(#pencilHatchPattern)" 
//           style={{ strokeDasharray: "none" }} 
//         />

//         {/* --- CAT HEAD & EARS --- */}
//         <g id="cat-head">
//           {/* Outer Ears */}
//           <path d="M 68 68 C 60 45 52 22 68 18 C 80 24 85 48 88 56" fill="#faf8f5" stroke="#1c1c1e" strokeWidth="2.2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
//           <path d="M 152 68 C 160 45 168 22 152 18 C 140 24 135 48 132 56" fill="#faf8f5" stroke="#1c1c1e" strokeWidth="2.2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />

//           {/* Inner Ear Hatching */}
//           <path d="M 70 60 L 68 28 L 83 50" fill="url(#pencilHatchPattern)" stroke="#1c1c1e" strokeWidth="1" style={{ strokeDasharray: "none" }} />
//           <path d="M 150 60 L 152 28 L 137 50" fill="url(#pencilHatchPattern)" stroke="#1c1c1e" strokeWidth="1" style={{ strokeDasharray: "none" }} />

//           {/* Head Shape */}
//           <path
//             d="M 70 62 
//                C 60 68, 58 82, 62 90 
//                C 68 100, 88 104, 110 104 
//                C 132 104, 152 100, 158 90 
//                C 162 82, 160 68, 150 62 
//                C 135 50, 85 50, 70 62 Z"
//             fill="#F5F3F1"
//             stroke="#1c1c1e"
//             strokeWidth="2.4"
//             strokeLinejoin="round"
//             style={{ strokeDasharray: "none" }}
//           />

//           {/* Forehead Stripes */}
//           <path d="M 104 54 L 110 66 L 110 55" stroke="#1c1c1e" strokeWidth="2" strokeLinecap="round" fill="none" style={{ strokeDasharray: "none" }} />
//           <path d="M 98 56 L 104 67" stroke="#1c1c1e" strokeWidth="1.6" strokeLinecap="round" style={{ strokeDasharray: "none" }} />
//           <path d="M 122 56 L 116 67" stroke="#1c1c1e" strokeWidth="1.6" strokeLinecap="round" style={{ strokeDasharray: "none" }} />

//           {/* Whiskers */}
//           <path d="M 62 80 L 78 78 M 61 85 L 76 83 M 64 90 L 77 87" stroke="#1c1c1e" strokeWidth="1.5" strokeLinecap="round" style={{ strokeDasharray: "none" }} />
//           <path d="M 158 80 L 142 78 M 159 85 L 144 83 M 156 90 L 143 87" stroke="#1c1c1e" strokeWidth="1.5" strokeLinecap="round" style={{ strokeDasharray: "none" }} />

//           {/* Animated Blinking Eyes */}
//           <g className="cat-blinking-eye">
//             <ellipse cx="90" cy="76" rx="6.5" ry="8" fill="#1c1c1e" style={{ strokeDasharray: "none" }} />
//             <circle cx="87.5" cy="73" r="2.2" fill="#ffffff" style={{ strokeDasharray: "none" }} />
//             <circle cx="92" cy="78" r="1" fill="#ffffff" style={{ strokeDasharray: "none" }} />

//             <ellipse cx="130" cy="76" rx="6.5" ry="8" fill="#1c1c1e" style={{ strokeDasharray: "none" }} />
//             <circle cx="127.5" cy="73" r="2.2" fill="#ffffff" style={{ strokeDasharray: "none" }} />
//             <circle cx="132" cy="78" r="1" fill="#ffffff" style={{ strokeDasharray: "none" }} />
//           </g>

//           {/* Nose & Mouth */}
//           <polygon points="107,82 113,82 110,85" fill="#1c1c1e" stroke="#1c1c1e" strokeWidth="0.8" style={{ strokeDasharray: "none" }} />
//           <path d="M 106 88 C 108 91, 110 90, 110 87 C 110 90, 112 91, 114 88" stroke="#1c1c1e" strokeWidth="1.8" strokeLinecap="round" fill="none" style={{ strokeDasharray: "none" }} />
//         </g>

//         {/* --- CARDBOARD BOX --- */}
//         {/* Back Flaps */}
//         <polygon points="16,74 42,92 54,92 24,70" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
//         <path d="M 20 74 L 46 88" stroke="#1c1c1e" strokeWidth="0.8" fill="url(#pencilHatchPattern)" opacity="0.4" style={{ strokeDasharray: "none" }} />

//         <polygon points="204,74 178,92 166,92 196,70" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
//         <path d="M 200 74 L 174 88" stroke="#1c1c1e" strokeWidth="0.8" fill="url(#pencilHatchPattern)" opacity="0.4" style={{ strokeDasharray: "none" }} />

//         {/* Front Open Top Flaps */}
//         <polygon points="42,92 110,104 110,92 42,92" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
//         <polygon points="178,92 110,104 110,92 178,92" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />

//         {/* Box Front Main Body */}
//         <rect x="42" y="92" width="136" height="64" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2.4" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />

//         {/* Side Shading */}
//         <path d="M 43 93 L 58 93 L 58 155 L 43 155 Z" fill="url(#pencilHatchPattern)" style={{ strokeDasharray: "none" }} />

//         {/* Printed Upload Arrow */}
//         <g id="pencil-upload" transform="translate(100, 120)">
//           <path d="M 10 20 L 10 6 M 10 6 L 4 11 M 10 6 L 16 11" stroke="#1c1c1e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
//           <path d="M 2 16 L 2 23 C 2 24, 4 25, 6 25 L 14 25 C 16 25, 18 24, 18 23 L 18 16" stroke="#1c1c1e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ strokeDasharray: "none" }} />
//         </g>

//         {/* --- FOREGROUND PAWS --- */}
//         {/* Left Paw */}
//         <g id="left-paw">
//           <path d="M 78 86 C 74 86, 74 100, 84 100 C 90 100, 93 96, 94 86 Z" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
//           <path d="M 82 93 L 82 98 M 87 93 L 87 98" stroke="#1c1c1e" strokeWidth="1.5" strokeLinecap="round" style={{ strokeDasharray: "none" }} />
//         </g>

//         {/* Right Paw */}
//         <g id="right-paw">
//           <path d="M 126 86 C 127 96, 130 100, 136 100 C 146 100, 146 86, 142 86 Z" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
//           <path d="M 132 93 L 132 98 M 137 93 L 137 98" stroke="#1c1c1e" strokeWidth="1.5" strokeLinecap="round" style={{ strokeDasharray: "none" }} />
//         </g>
//       </g>
//     </svg>
//   );
// }



// function FileIcon() {
//   return (
//     <svg
//       width="16"
//       height="18"
//       viewBox="0 0 18 20"
//       fill="none"
//       stroke="#1c1c1e"
//       strokeWidth="2"
//       strokeLinecap="round"
//       strokeLinejoin="round"
//     >
//       <path d="M 3,2 L 11,2 L 16,7 L 16,17 C 16,18 15,19 14,19 L 4,19 C 3,19 2,18 2,17 L 2,3 C 2,2 3,2 3,2 Z" />
//       <path d="M 11,2 L 11,7 L 16,7" />
//     </svg>
//   );
// }

// function CloseIcon() {
//   return (
//     <svg
//       width="13"
//       height="13"
//       viewBox="0 0 12 12"
//       fill="none"
//       stroke="currentColor"
//       strokeWidth="2"
//       strokeLinecap="round"
//     >
//       <path d="M 2,2 L 10,10 M 10,2 L 2,10" />
//     </svg>
//   );
// }

"use client";

import { useCallback, useRef, useState } from "react";
import { formatBytes, truncateName } from "@/lib/format";

interface FileDropzoneProps {
  files: File[];
  onFilesSelected: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  disabled?: boolean;
}

export function FileDropzone({
  files,
  onFilesSelected,
  onRemoveFile,
  disabled = false,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (newFiles: File[]) => {
      if (disabled || newFiles.length === 0) return;
      onFilesSelected([...files, ...newFiles]);
    },
    [files, onFilesSelected, disabled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      if (disabled) return;

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) handleFiles(droppedFiles);
    },
    [disabled, handleFiles]
  );

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="w-full font-sans">
      {/* Drop Zone Box with Hand-drawn Loose Dashed Border */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={handleDrop}
        className={`group relative flex min-h-[135px] w-full flex-col items-center justify-center rounded-2xl border-[2.2px] p-3 text-center transition-all duration-200 ${
          dragging
            ? "border-[#1c1c1e] bg-white/60 shadow-sm"
            : "border-[#1c1c1e]/40 bg-transparent hover:border-[#1c1c1e]/80 hover:bg-white/20"
        } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
        style={{
          borderStyle: "dashed",
          strokeDasharray: "10 12", // Custom wide dash spacing matching sketch art
        }}
      >
        <div className="flex flex-col items-center justify-center space-y-1">
          {/* Animated Blinking Cat with Paws on Cardboard Box */}
          <div className="mb-0 transform transition-transform duration-200 group-hover:scale-105">
            <BlinkingCatInBox />
          </div>

          <span className="text-sm font-bold tracking-tight text-[#1c1c1e]">
            Choose files
          </span>
          <span className="text-[11px] font-normal text-[#5e5e62]">
            or drop them here
          </span>
        </div>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          if (selected.length > 0) handleFiles(selected);
          e.target.value = "";
        }}
      />

      {/* File summary bar */}
      <div className="mt-2 flex items-center justify-between px-1 text-[11px] font-semibold text-[#6e6e73]">
        <span>{files.length} {files.length === 1 ? "file" : "files"}</span>
        <span>{formatBytes(totalBytes)}</span>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="mt-3 divide-y divide-[#2b2b2b]/10 rounded-md border border-[#2b2b2b]/20 bg-transparent px-3">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex items-center justify-between py-2 text-xs font-medium">
              <div className="flex items-center gap-2 overflow-hidden">
                <FileIcon />
                <span className="truncate text-[#1c1c1e]">{truncateName(file.name, 28)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[11px] text-[#6e6e73]">{formatBytes(file.size)}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onRemoveFile(index)}
                    aria-label={`Remove ${file.name}`}
                    className="p-0.5 text-gray-500 hover:text-black"
                  >
                    <CloseIcon />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BlinkingCatInBox() {
  return (
    <svg
      width="105"
      height="70"
      viewBox="0 0 220 170"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="select-none"
      style={{ strokeDasharray: "none" }}
    >
      <defs>
        {/* Organic Hand-Drawn Pencil Filter */}
        <filter id="pencilSketchFilter" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.1" xChannelSelector="R" yChannelSelector="G" />
        </filter>

        {/* Pencil Shading Pattern */}
        <pattern id="pencilHatchPattern" width="5" height="5" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="5" stroke="#2c2c2e" strokeWidth="0.8" opacity="0.3" style={{ strokeDasharray: "none" }} />
        </pattern>

        <style>{`
          @keyframes catBlink {
            0%, 90%, 100% { transform: scaleY(1); }
            95% { transform: scaleY(0.08); }
          }
          .cat-blinking-eye {
            animation: catBlink 4.2s infinite ease-in-out;
            transform-origin: 110px 75px;
          }
        `}</style>
      </defs>

      {/* --- GROUND SHADOW --- */}
      <g filter="url(#pencilSketchFilter)">
        <ellipse cx="110" cy="162" rx="70" ry="4" fill="url(#pencilHatchPattern)" style={{ strokeDasharray: "none" }} />
      </g>

      {/* --- CAT & BOX ASSEMBLY --- */}
      <g filter="url(#pencilSketchFilter)">
        {/* Dark Inner Box Interior Behind Cat */}
        <path 
          d="M 42 92 L 178 92 L 178 104 L 42 104 Z" 
          fill="url(#pencilHatchPattern)" 
          style={{ strokeDasharray: "none" }} 
        />

        {/* --- CAT HEAD & EARS --- */}
        <g id="cat-head">
          {/* Outer Ears */}
          <path d="M 68 68 C 60 45 52 22 68 18 C 80 24 85 48 88 56" fill="#faf8f5" stroke="#1c1c1e" strokeWidth="2.2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
          <path d="M 152 68 C 160 45 168 22 152 18 C 140 24 135 48 132 56" fill="#faf8f5" stroke="#1c1c1e" strokeWidth="2.2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />

          {/* Inner Ear Hatching */}
          <path d="M 70 60 L 68 28 L 83 50" fill="url(#pencilHatchPattern)" stroke="#1c1c1e" strokeWidth="1" style={{ strokeDasharray: "none" }} />
          <path d="M 150 60 L 152 28 L 137 50" fill="url(#pencilHatchPattern)" stroke="#1c1c1e" strokeWidth="1" style={{ strokeDasharray: "none" }} />

          {/* Head Shape */}
          <path
            d="M 70 62 
               C 60 68, 58 82, 62 90 
               C 68 100, 88 104, 110 104 
               C 132 104, 152 100, 158 90 
               C 162 82, 160 68, 150 62 
               C 135 50, 85 50, 70 62 Z"
            fill="#F5F3F1"
            stroke="#1c1c1e"
            strokeWidth="2.4"
            strokeLinejoin="round"
            style={{ strokeDasharray: "none" }}
          />

          {/* Forehead Stripes */}
          <path d="M 104 54 L 110 66 L 110 55" stroke="#1c1c1e" strokeWidth="2" strokeLinecap="round" fill="none" style={{ strokeDasharray: "none" }} />
          <path d="M 98 56 L 104 67" stroke="#1c1c1e" strokeWidth="1.6" strokeLinecap="round" style={{ strokeDasharray: "none" }} />
          <path d="M 122 56 L 116 67" stroke="#1c1c1e" strokeWidth="1.6" strokeLinecap="round" style={{ strokeDasharray: "none" }} />

          {/* Whiskers */}
          <path d="M 62 80 L 78 78 M 61 85 L 76 83 M 64 90 L 77 87" stroke="#1c1c1e" strokeWidth="1.5" strokeLinecap="round" style={{ strokeDasharray: "none" }} />
          <path d="M 158 80 L 142 78 M 159 85 L 144 83 M 156 90 L 143 87" stroke="#1c1c1e" strokeWidth="1.5" strokeLinecap="round" style={{ strokeDasharray: "none" }} />

          {/* Animated Blinking Eyes */}
          <g className="cat-blinking-eye">
            <ellipse cx="90" cy="76" rx="6.5" ry="8" fill="#1c1c1e" style={{ strokeDasharray: "none" }} />
            <circle cx="87.5" cy="73" r="2.2" fill="#ffffff" style={{ strokeDasharray: "none" }} />
            <circle cx="92" cy="78" r="1" fill="#ffffff" style={{ strokeDasharray: "none" }} />

            <ellipse cx="130" cy="76" rx="6.5" ry="8" fill="#1c1c1e" style={{ strokeDasharray: "none" }} />
            <circle cx="127.5" cy="73" r="2.2" fill="#ffffff" style={{ strokeDasharray: "none" }} />
            <circle cx="132" cy="78" r="1" fill="#ffffff" style={{ strokeDasharray: "none" }} />
          </g>

          {/* Nose & Mouth */}
          <polygon points="107,82 113,82 110,85" fill="#1c1c1e" stroke="#1c1c1e" strokeWidth="0.8" style={{ strokeDasharray: "none" }} />
          <path d="M 106 88 C 108 91, 110 90, 110 87 C 110 90, 112 91, 114 88" stroke="#1c1c1e" strokeWidth="1.8" strokeLinecap="round" fill="none" style={{ strokeDasharray: "none" }} />
        </g>

        {/* --- CARDBOARD BOX --- */}
        {/* Back Flaps */}
        <polygon points="16,74 42,92 54,92 24,70" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
        <path d="M 20 74 L 46 88" stroke="#1c1c1e" strokeWidth="0.8" fill="url(#pencilHatchPattern)" opacity="0.4" style={{ strokeDasharray: "none" }} />

        <polygon points="204,74 178,92 166,92 196,70" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
        <path d="M 200 74 L 174 88" stroke="#1c1c1e" strokeWidth="0.8" fill="url(#pencilHatchPattern)" opacity="0.4" style={{ strokeDasharray: "none" }} />

        {/* Front Open Top Flaps */}
        <polygon points="42,92 110,104 110,92 42,92" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
        <polygon points="178,92 110,104 110,92 178,92" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />

        {/* Box Front Main Body */}
        <rect x="42" y="92" width="136" height="64" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2.4" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />

        {/* Side Shading */}
        <path d="M 43 93 L 58 93 L 58 155 L 43 155 Z" fill="url(#pencilHatchPattern)" style={{ strokeDasharray: "none" }} />

        {/* Printed Upload Arrow */}
        <g id="pencil-upload" transform="translate(100, 120)">
          <path d="M 10 20 L 10 6 M 10 6 L 4 11 M 10 6 L 16 11" stroke="#1c1c1e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
          <path d="M 2 16 L 2 23 C 2 24, 4 25, 6 25 L 14 25 C 16 25, 18 24, 18 23 L 18 16" stroke="#1c1c1e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ strokeDasharray: "none" }} />
        </g>

        {/* --- FOREGROUND PAWS --- */}
        {/* Left Paw */}
        <g id="left-paw">
          <path d="M 78 86 C 74 86, 74 100, 84 100 C 90 100, 93 96, 94 86 Z" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
          <path d="M 82 93 L 82 98 M 87 93 L 87 98" stroke="#1c1c1e" strokeWidth="1.5" strokeLinecap="round" style={{ strokeDasharray: "none" }} />
        </g>

        {/* Right Paw */}
        <g id="right-paw">
          <path d="M 126 86 C 127 96, 130 100, 136 100 C 146 100, 146 86, 142 86 Z" fill="#F5F3F1" stroke="#1c1c1e" strokeWidth="2" strokeLinejoin="round" style={{ strokeDasharray: "none" }} />
          <path d="M 132 93 L 132 98 M 137 93 L 137 98" stroke="#1c1c1e" strokeWidth="1.5" strokeLinecap="round" style={{ strokeDasharray: "none" }} />
        </g>
      </g>
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="16"
      height="18"
      viewBox="0 0 18 20"
      fill="none"
      stroke="#1c1c1e"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M 3,2 L 11,2 L 16,7 L 16,17 C 16,18 15,19 14,19 L 4,19 C 3,19 2,18 2,17 L 2,3 C 2,2 3,2 3,2 Z" />
      <path d="M 11,2 L 11,7 L 16,7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M 2,2 L 10,10 M 10,2 L 2,10" />
    </svg>
  );
}