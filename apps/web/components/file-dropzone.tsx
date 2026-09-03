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

//   // ============================================================
//   // ADD FILES
//   // ============================================================

//   const handleFiles = useCallback(
//     (newFiles: File[]) => {
//       if (disabled || newFiles.length === 0) return;

//       onFilesSelected([...files, ...newFiles]);
//     },
//     [files, onFilesSelected, disabled]
//   );

//   // ============================================================
//   // DRAG & DROP
//   // ============================================================

//   const handleDrop = useCallback(
//     (e: React.DragEvent<HTMLButtonElement>) => {
//       e.preventDefault();
//       e.stopPropagation();

//       setDragging(false);

//       if (disabled) return;

//       const droppedFiles = Array.from(e.dataTransfer.files);

//       if (droppedFiles.length > 0) {
//         handleFiles(droppedFiles);
//       }
//     },
//     [disabled, handleFiles]
//   );

//   // ============================================================
//   // TOTAL FILE SIZE
//   // ============================================================

//   const totalBytes = files.reduce(
//     (sum, file) => sum + file.size,
//     0
//   );

//   return (
//     <div className="w-full">
//       {/* ========================================================
//           DROPZONE
//           ======================================================== */}

//       <button
//         type="button"
//         disabled={disabled}
//         onClick={() => {
//           if (!disabled) {
//             inputRef.current?.click();
//           }
//         }}
//         onDragEnter={(e) => {
//           e.preventDefault();
//           e.stopPropagation();

//           if (!disabled) {
//             setDragging(true);
//           }
//         }}
//         onDragOver={(e) => {
//           e.preventDefault();
//           e.stopPropagation();

//           if (!disabled) {
//             setDragging(true);
//           }
//         }}
//         onDragLeave={(e) => {
//           e.preventDefault();
//           e.stopPropagation();

//           setDragging(false);
//         }}
//         onDrop={handleDrop}
//         className={`
//           relative
//           w-full
//           h-[108px]
//           rounded-[12px]
//           border-2
//           border-dashed
//           flex
//           flex-col
//           items-center
//           justify-center
//           text-center
//           overflow-hidden
//           transition-colors
//           duration-150
//           ${
//             dragging
//               ? "border-gray-700 bg-white/60"
//               : "border-[#aeb4bb] bg-white/35"
//           }
//           ${
//             disabled
//               ? "cursor-not-allowed opacity-50"
//               : "cursor-pointer hover:bg-white/50"
//           }
//         `}
//       >
//         {/* ======================================================
//             DROPZONE CONTENT
//             ====================================================== */}

//         <div className="flex flex-col items-center justify-center">
//           {/* Cat + Box */}
//           <div className="h-[61px] flex items-center justify-center">
//             <HandDrawnCatInBox />
//           </div>

//           {/* Choose files */}
//           <span className="text-[18px] leading-[20px] font-bold text-black">
//             Choose files
//           </span>

//           {/* Drop hint */}
//           <span className="text-[11px] leading-[16px] font-bold text-gray-600">
//             or drop them here
//           </span>
//         </div>
//       </button>

//       {/* ========================================================
//           HIDDEN FILE INPUT
//           ======================================================== */}

//       <input
//         ref={inputRef}
//         type="file"
//         multiple
//         disabled={disabled}
//         className="hidden"
//         onChange={(e) => {
//           const selectedFiles = Array.from(
//             e.target.files ?? []
//           );

//           if (selectedFiles.length > 0) {
//             handleFiles(selectedFiles);
//           }

//           // Allows selecting the same file again
//           e.target.value = "";
//         }}
//       />

//       {/* ========================================================
//           FILE COUNT / TOTAL SIZE
//           ======================================================== */}

//       <div className="mt-2 flex items-center justify-between px-0.5 text-xs font-bold text-gray-900">
//         <span>
//           {files.length}{" "}
//           {files.length === 1 ? "file" : "files"}
//         </span>

//         <span>{formatBytes(totalBytes)}</span>
//       </div>

//       {/* ========================================================
//           FILE LIST
//           ======================================================== */}

//       {files.length > 0 && (
//         <div className="mt-1">
//           {files.map((file, index) => (
//             <div
//               key={`${file.name}-${index}`}
//               className="w-full"
//             >
//               {/* File row */}
//               <div className="flex items-center justify-between gap-3 py-2 px-0.5 text-xs font-bold text-gray-900">
//                 {/* File name */}
//                 <div className="flex min-w-0 items-center gap-2 overflow-hidden">
//                   <FileIcon />

//                   <span className="truncate">
//                     {truncateName(file.name)}
//                   </span>
//                 </div>

//                 {/* Size + Remove */}
//                 <div className="flex shrink-0 items-center gap-3 text-gray-800">
//                   <span>
//                     {formatBytes(file.size)}
//                   </span>

//                   {!disabled && (
//                     <button
//                       type="button"
//                       onClick={(e) => {
//                         e.preventDefault();
//                         e.stopPropagation();

//                         onRemoveFile(index);
//                       }}
//                       aria-label={`Remove ${file.name}`}
//                       className="
//                         p-0.5
//                         transition-opacity
//                         hover:opacity-50
//                       "
//                     >
//                       <CloseIcon />
//                     </button>
//                   )}
//                 </div>
//               </div>

//               {/* Hand-drawn divider */}
//               <SketchDivider />
//             </div>
//           ))}
//         </div>
//       )}
//     </div>
//   );
// }

// /* ========================================================================
//    HAND-DRAWN CAT IN BOX
//    ======================================================================== */

// function HandDrawnCatInBox() {
//   return (
//     <svg
//       width="72"
//       height="61"
//       viewBox="0 0 100 85"
//       fill="none"
//       stroke="#1a1a1a"
//       strokeLinecap="round"
//       strokeLinejoin="round"
//       className="block"
//       aria-hidden="true"
//     >
//       {/* Left ear */}
//       <path
//         d="M 32,32 Q 30,15 37,13 C 41,12 43,23 45,26"
//         strokeWidth="1.8"
//         fill="#ffffff"
//       />

//       {/* Left ear inner */}
//       <path
//         d="M 34,26 Q 34,18 38,16"
//         strokeWidth="1.2"
//       />

//       {/* Right ear */}
//       <path
//         d="M 68,32 Q 70,15 63,13 C 59,12 57,23 55,26"
//         strokeWidth="1.8"
//         fill="#ffffff"
//       />

//       {/* Right ear inner */}
//       <path
//         d="M 66,26 Q 66,18 62,16"
//         strokeWidth="1.2"
//       />

//       {/* Cat head */}
//       <path
//         d="
//           M 32,32
//           Q 50,22 68,32
//           C 73,42 70,52 64,54
//           Q 48,55 36,53
//           C 31,46 30,38 32,32
//           Z
//         "
//         strokeWidth="1.8"
//         fill="#ffffff"
//       />

//       {/* Left eye */}
//       <ellipse
//         cx="42"
//         cy="35"
//         rx="2"
//         ry="2.5"
//         fill="#1a1a1a"
//       />

//       {/* Right eye */}
//       <ellipse
//         cx="58"
//         cy="35"
//         rx="2"
//         ry="2.5"
//         fill="#1a1a1a"
//       />

//       {/* Nose */}
//       <path
//         d="M 49,39 L 51,39 L 50,41 Z"
//         fill="#1a1a1a"
//       />

//       {/* Mouth */}
//       <path
//         d="
//           M 50,41
//           Q 47,44 45,43
//           M 50,41
//           Q 53,44 55,43
//         "
//         strokeWidth="1.4"
//       />

//       {/* Whiskers */}
//       <path
//         d="
//           M 36,37 L 27,36
//           M 35,40 L 26,41
//           M 64,37 L 73,36
//           M 65,40 L 74,41
//         "
//         strokeWidth="1.2"
//       />

//       {/* Left paw */}
//       <path
//         d="M 35,51 C 33,43 43,43 43,51"
//         strokeWidth="1.6"
//         fill="#ffffff"
//       />

//       {/* Right paw */}
//       <path
//         d="M 57,51 C 55,43 65,43 65,51"
//         strokeWidth="1.6"
//         fill="#ffffff"
//       />

//       {/* Left box flap */}
//       <path
//         d="M 20,53 L 10,41 L 30,48 Z"
//         strokeWidth="1.6"
//         fill="#ffffff"
//       />

//       {/* Right box flap */}
//       <path
//         d="M 80,53 L 90,41 L 70,48 Z"
//         strokeWidth="1.6"
//         fill="#ffffff"
//       />

//       {/* Left box upper flap */}
//       <path
//         d="M 20,53 L 28,63 L 50,53 L 20,53 Z"
//         strokeWidth="1.6"
//         fill="#ffffff"
//       />

//       {/* Right box upper flap */}
//       <path
//         d="M 80,53 L 72,63 L 50,53 L 80,53 Z"
//         strokeWidth="1.6"
//         fill="#ffffff"
//       />

//       {/* Main box */}
//       <path
//         d="
//           M 20,53
//           L 50,60
//           L 80,53
//           L 80,78
//           L 50,83
//           L 20,78
//           Z
//         "
//         strokeWidth="2"
//         fill="#ffffff"
//       />

//       {/* Box center */}
//       <path
//         d="M 50,60 L 50,83"
//         strokeWidth="1.8"
//       />

//       {/* Upload arrow */}
//       <path
//         d="
//           M 50,74 V 66
//           M 46,69 L 50,65 L 54,69
//         "
//         strokeWidth="2"
//       />

//       {/* Box bottom detail */}
//       <path
//         d="M 45,75 H 55"
//         strokeWidth="1.8"
//       />
//     </svg>
//   );
// }

// /* ========================================================================
//    FILE ICON
//    ======================================================================== */

// function FileIcon() {
//   return (
//     <svg
//       width="16"
//       height="18"
//       viewBox="0 0 18 20"
//       fill="none"
//       stroke="#1a1a1a"
//       strokeWidth="1.8"
//       strokeLinecap="round"
//       strokeLinejoin="round"
//       className="shrink-0"
//       aria-hidden="true"
//     >
//       <path
//         d="
//           M 3,2
//           C 7,1.8 11,2 11,2
//           L 16,7
//           C 16,7 16,14 15.8,17.5
//           C 15.6,18.8 14.5,19 13,19
//           C 9,19.2 5,19 3,19
//           C 1.8,19 1.5,18 1.5,16.5
//           L 1.5,4.5
//           C 1.5,3 2,2.2 3,2
//           Z
//         "
//         fill="#ffffff"
//       />

//       <path d="M 11,2 L 11,7 L 16,7" />
//     </svg>
//   );
// }

// /* ========================================================================
//    CLOSE ICON
//    ======================================================================== */

// function CloseIcon() {
//   return (
//     <svg
//       width="12"
//       height="12"
//       viewBox="0 0 12 12"
//       fill="none"
//       stroke="#1a1a1a"
//       strokeWidth="2"
//       strokeLinecap="round"
//       aria-hidden="true"
//     >
//       <path d="M 2,2 L 10,10" />
//       <path d="M 10,2 L 2,10" />
//     </svg>
//   );
// }

// /* ========================================================================
//    HAND-DRAWN DIVIDER
//    ======================================================================== */

// function SketchDivider() {
//   return (
//     <svg
//       width="100%"
//       height="7"
//       viewBox="0 0 100 7"
//       preserveAspectRatio="none"
//       className="block"
//       aria-hidden="true"
//     >
//       <path
//         d="M 1,3.5 Q 25,2.7 50,3.6 Q 75,4.2 99,3.2"
//         fill="none"
//         stroke="#1a1a1a"
//         strokeWidth="0.8"
//         strokeLinecap="round"
//         vectorEffect="non-scaling-stroke"
//         opacity="0.55"
//       />
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
    <div className="w-full">
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
        className={`relative flex min-h-[140px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed p-4 text-center transition-all ${
          dragging
            ? "border-black bg-white/80"
            : "border-[#2b2b2b]/30 bg-white/20 hover:border-[#2b2b2b]/60 hover:bg-white/40"
        } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      >
        <div className="flex flex-col items-center justify-center">
          <div className="mb-1">
            <HandDrawnCrocodileInBox />
          </div>
          <span className="text-sm font-bold text-[#1c1c1e]">Choose files</span>
          <span className="text-[11px] font-medium text-[#6e6e73]">or drop them here</span>
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

function HandDrawnCrocodileInBox() {
  return (
    <svg width="68" height="56" viewBox="0 0 100 85" fill="none" stroke="#1a1a1a" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 32,32 Q 30,15 37,13 C 41,12 43,23 45,26" strokeWidth="1.8" fill="#ffffff" />
      <path d="M 68,32 Q 70,15 63,13 C 59,12 57,23 55,26" strokeWidth="1.8" fill="#ffffff" />
      <path d="M 32,32 Q 50,22 68,32 C 73,42 70,52 64,54 Q 48,55 36,53 C 31,46 30,38 32,32 Z" strokeWidth="1.8" fill="#ffffff" />
      <ellipse cx="42" cy="35" rx="2" ry="2.5" fill="#1a1a1a" />
      <ellipse cx="58" cy="35" rx="2" ry="2.5" fill="#1a1a1a" />
      <path d="M 20,53 L 50,60 L 80,53 L 80,78 L 50,83 L 20,78 Z" strokeWidth="2" fill="#ffffff" />
      <path d="M 50,60 L 50,83" strokeWidth="1.8" />
      <path d="M 50,74 V 66 M 46,69 L 50,65 L 54,69" strokeWidth="2" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="15" height="17" viewBox="0 0 18 20" fill="none" stroke="#2b2b2b" strokeWidth="1.8" strokeLinecap="round">
      <path d="M 3,2 L 11,2 L 16,7 L 16,17 C 16,18 15,19 14,19 L 4,19 C 3,19 2,18 2,17 L 2,3 C 2,2 3,2 3,2 Z" />
      <path d="M 11,2 L 11,7 L 16,7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M 2,2 L 10,10 M 10,2 L 2,10" />
    </svg>
  );
}