//! Kimo desktop shell.
//!
//! The UI, WebRTC signaling, peer connection, chunking, encryption and
//! transfer logic all live in `apps/web` (the Next.js app) and run
//! unmodified inside the OS webview. This Rust layer only adds native
//! desktop capabilities the browser sandbox can't provide on its own:
//!
//! 1. A native "Save As" dialog + direct filesystem write for completed
//!    transfers (`save_file_to_path` / `pick_save_path`), used instead of
//!    the browser's `<a download>` click-simulation trick.
//! 2. Primitives for writing a file to disk incrementally, chunk by
//!    chunk, keyed by an opaque transfer id (`open_write_sink`,
//!    `write_chunk`, `finalize_write_sink`, `abort_write_sink`). These are
//!    intentionally offset-addressed (`seek` + `write_all`) so chunks can
//!    land in any order — which matches how `FileReceiver` already
//!    receives them over parallel WebRTC data channels.
//!
//! (2) is exposed for the web app to opt into but is not required — the
//! existing in-memory `Blob` reassembly in `lib/webrtc/transfer.ts`
//! keeps working exactly as before if the frontend never calls these
//! commands. See the repo's ARCHITECTURE.md / README "Known limitations"
//! for the honest status of wiring this all the way through.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

#[derive(Default)]
pub struct WriteSinks(Mutex<HashMap<String, WriteSink>>);

struct WriteSink {
    file: File,
    path: PathBuf,
}

#[derive(Serialize)]
pub struct SinkOpened {
    path: String,
}

#[derive(Serialize)]
pub struct SinkFinished {
    path: String,
    sha256: String,
    bytes_written: u64,
}

fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Show a native "Save As" dialog pre-filled with `suggested_name`.
/// Returns `None` if the user cancels.
#[tauri::command]
async fn pick_save_path(
    app: tauri::AppHandle,
    suggested_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_file_name(&suggested_name)
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let picked = rx.recv().map_err(to_err)?;
    Ok(picked.and_then(|p| p.as_path().map(|p| p.to_string_lossy().to_string())))
}

/// Write a complete, already-assembled file to `path` in one call.
/// Used for the common case: the transfer engine already built a full
/// `File`/`Blob` in the webview and just needs it on disk.
#[tauri::command]
async fn save_file_to_path(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let mut f = File::create(&path).map_err(to_err)?;
    f.write_all(&bytes).map_err(to_err)?;
    f.flush().map_err(to_err)
}

/// Open (creating if needed) a file for out-of-order, offset-addressed
/// writes, keyed by `transfer_id`. Pre-allocates `total_size` bytes when
/// the OS supports it so writes never need to grow the file mid-transfer.
#[tauri::command]
async fn open_write_sink(
    sinks: State<'_, WriteSinks>,
    transfer_id: String,
    path: String,
    total_size: u64,
) -> Result<SinkOpened, String> {
    let path_buf = PathBuf::from(&path);
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path_buf)
        .map_err(to_err)?;

    if total_size > 0 {
        let _ = file.set_len(total_size);
    }

    let mut guard = sinks.0.lock().map_err(|e| to_err(e))?;
    guard.insert(
        transfer_id,
        WriteSink {
            file,
            path: path_buf,
        },
    );

    Ok(SinkOpened { path })
}

/// Write one chunk at a specific byte offset. Order-independent by
/// design — matches `FileReceiver`'s index-addressed chunk storage.
#[tauri::command]
async fn write_chunk(
    sinks: State<'_, WriteSinks>,
    transfer_id: String,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let mut guard = sinks.0.lock().map_err(|e| to_err(e))?;
    let sink = guard
        .get_mut(&transfer_id)
        .ok_or_else(|| "unknown transfer_id".to_string())?;

    sink.file.seek(SeekFrom::Start(offset)).map_err(to_err)?;
    sink.file.write_all(&bytes).map_err(to_err)
}

/// Flush, hash the completed file from disk (so the caller can compare
/// against the sender's SHA-256 without ever holding the whole file in
/// memory on the JS side), and drop the sink.
#[tauri::command]
async fn finalize_write_sink(
    sinks: State<'_, WriteSinks>,
    transfer_id: String,
) -> Result<SinkFinished, String> {
    let (path, bytes_written) = {
        let mut guard = sinks.0.lock().map_err(|e| to_err(e))?;
        let mut sink = guard
            .remove(&transfer_id)
            .ok_or_else(|| "unknown transfer_id".to_string())?;
        sink.file.flush().map_err(to_err)?;
        let len = sink.file.metadata().map_err(to_err)?.len();
        (sink.path, len)
    };

    let mut file = File::open(&path).map_err(to_err)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(to_err)?;
    let sha256 = format!("{:x}", hasher.finalize());

    Ok(SinkFinished {
        path: path.to_string_lossy().to_string(),
        sha256,
        bytes_written,
    })
}

/// Abandon a partial transfer: drop the open handle and delete the
/// partial file so a cancelled/failed transfer doesn't leave debris.
#[tauri::command]
async fn abort_write_sink(sinks: State<'_, WriteSinks>, transfer_id: String) -> Result<(), String> {
    let removed = {
        let mut guard = sinks.0.lock().map_err(|e| to_err(e))?;
        guard.remove(&transfer_id)
    };

    if let Some(sink) = removed {
        drop(sink.file);
        let _ = std::fs::remove_file(sink.path);
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WriteSinks::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            pick_save_path,
            save_file_to_path,
            open_write_sink,
            write_chunk,
            finalize_write_sink,
            abort_write_sink,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Kimo");
}
