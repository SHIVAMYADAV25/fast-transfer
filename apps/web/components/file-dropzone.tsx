"use client";

import { useCallback, useRef, useState } from "react";
import { formatBytes, truncateName } from "@/lib/format";

interface FileDropzoneProps {
  files: File[];
  onFilesSelected: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  disabled?: boolean;
}

export function FileDropzone({ files, onFilesSelected, onRemoveFile, disabled }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length) onFilesSelected([...files, ...dropped]);
    },
    [files, onFilesSelected, disabled],
  );

  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  return (
    <div>
      <button
        type="button"
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        disabled={disabled}
        className={`flex w-full flex-col items-center justify-center gap-1 border border-dashed py-10 text-center transition-colors ${
          dragging ? "border-ink bg-ink/5" : "border-line"
        } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-ink"}`}
      >
        <span className="text-base font-medium">Choose files</span>
        <span className="text-xs text-muted">or drop them here</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          if (selected.length) onFilesSelected([...files, ...selected]);
          e.target.value = "";
        }}
      />

      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>{files.length} {files.length === 1 ? "file" : "files"}</span>
        <span>{formatBytes(totalBytes)}</span>
      </div>

      {files.length > 0 && (
        <ul className="mt-1 divide-y divide-line border-t border-line">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 py-2 text-xs">
              <span className="flex items-center gap-2 truncate">
                <FileIcon />
                {truncateName(f.name)}
              </span>
              <span className="flex shrink-0 items-center gap-3 text-muted">
                {formatBytes(f.size)}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onRemoveFile(i)}
                    aria-label={`Remove ${f.name}`}
                    className="text-muted hover:text-ink"
                  >
                    <CloseIcon />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
