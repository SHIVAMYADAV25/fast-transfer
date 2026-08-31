"use client";

import { create } from "zustand";
import type { ErrorCode, TransferState } from "@fast-transfer/protocol";
import { ERROR_MESSAGES } from "@fast-transfer/protocol";

interface FileEntry {
  name: string;
  size: number;
}

interface TransferStore {
  // identity
  code: string | null;
  role: "sender" | "receiver" | null;

  // state machine (PRD §22)
  state: TransferState;
  errorCode: ErrorCode | null;
  errorMessage: string | null;

  // files (sender selection / receiver incoming list)
  files: FileEntry[];
  totalBytes: number;

  // live progress
  currentFileName: string;
  fileIndex: number;
  totalFiles: number;
  bytesTransferred: number;
  ratePerSec: number;
  etaSeconds: number;
  percent: number;

  // connection diagnostics
  connectionType: "direct" | "relayed" | "unknown";
  rttMs: number | null;

  // actions
  reset: () => void;
  setCode: (code: string) => void;
  setRole: (role: "sender" | "receiver") => void;
  setState: (state: TransferState) => void;
  setError: (code: ErrorCode, message?: string) => void;
  setFiles: (files: FileEntry[]) => void;
  updateProgress: (p: {
    bytesTransferred: number;
    totalBytes: number;
    fileName: string;
    fileIndex: number;
    totalFiles: number;
    ratePerSec: number;
    etaSeconds: number;
  }) => void;
  setConnectionInfo: (info: { type: "direct" | "relayed" | "unknown"; rttMs?: number }) => void;
}

const initial = {
  code: null,
  role: null,
  state: "CREATED" as TransferState,
  errorCode: null,
  errorMessage: null,
  files: [],
  totalBytes: 0,
  currentFileName: "",
  fileIndex: 0,
  totalFiles: 0,
  bytesTransferred: 0,
  ratePerSec: 0,
  etaSeconds: 0,
  percent: 0,
  connectionType: "unknown" as const,
  rttMs: null,
};

export const useTransferStore = create<TransferStore>((set) => ({
  ...initial,

  reset: () => set({ ...initial }),
  setCode: (code) => set({ code }),
  setRole: (role) => set({ role }),
  setState: (state) => set({ state }),
  setError: (code, message) =>
    set({ state: "FAILED", errorCode: code, errorMessage: message ?? ERROR_MESSAGES[code] }),
  setFiles: (files) =>
    set({ files, totalBytes: files.reduce((s, f) => s + f.size, 0) }),
  updateProgress: (p) =>
    set({
      bytesTransferred: p.bytesTransferred,
      totalBytes: p.totalBytes,
      currentFileName: p.fileName,
      fileIndex: p.fileIndex,
      totalFiles: p.totalFiles,
      ratePerSec: p.ratePerSec,
      etaSeconds: p.etaSeconds,
      percent: p.totalBytes > 0 ? (p.bytesTransferred / p.totalBytes) * 100 : 0,
    }),
  setConnectionInfo: (info) =>
    set({ connectionType: info.type, rttMs: info.rttMs ?? null }),
}));
