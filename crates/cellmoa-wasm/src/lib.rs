//! WebAssembly bindings for the engine.
//!
//! The surface is deliberately tiny: allocate a buffer, write a JSON command
//! into it, call `cellmoa_dispatch`, read the JSON answer back. There is no
//! wasm-bindgen here, and that is a choice rather than an omission — the
//! generated-glue approach couples the JavaScript to the exact version of a
//! Rust crate, and a grid that must load in any bundler is better served by
//! four C functions it can call directly.
//!
//! Memory rules, which the loader on the JavaScript side implements:
//!
//! * `cellmoa_alloc(len)` returns a pointer the caller owns and must free with
//!   `cellmoa_free(ptr, len)`.
//! * `cellmoa_dispatch(session, ptr, len)` returns a pointer to a length-
//!   prefixed reply: four little-endian bytes of length, then that many bytes
//!   of UTF-8. The caller frees it with `cellmoa_free_reply`.

use cellmoa_api::Session;
use std::ffi::c_void;

/// An opaque handle to a session.
///
/// Sessions are boxed and handed out as raw pointers rather than kept in a
/// table: the host holds exactly one workbook per handle, and a table would add
/// a lookup and a failure mode for nothing.
pub struct SessionHandle(Session);

/// Creates a session holding an empty workbook.
///
/// # Safety
/// The returned pointer must be released with [`cellmoa_session_free`].
#[no_mangle]
pub extern "C" fn cellmoa_session_new() -> *mut SessionHandle {
    Box::into_raw(Box::new(SessionHandle(Session::new())))
}

/// Releases a session.
///
/// # Safety
/// `session` must come from [`cellmoa_session_new`] and must not be used again.
#[no_mangle]
pub unsafe extern "C" fn cellmoa_session_free(session: *mut SessionHandle) {
    if !session.is_null() {
        drop(Box::from_raw(session));
    }
}

/// Allocates `len` bytes for the caller to write a request into.
///
/// # Safety
/// The block must be released with [`cellmoa_free`], passing the same length.
#[no_mangle]
pub extern "C" fn cellmoa_alloc(len: usize) -> *mut c_void {
    if len == 0 {
        // A zero-length allocation has no valid pointer to hand back, and the
        // caller has nothing to write anyway.
        return std::ptr::null_mut();
    }
    let mut buffer = Vec::<u8>::with_capacity(len);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer as *mut c_void
}

/// Releases a block from [`cellmoa_alloc`].
///
/// # Safety
/// `ptr` and `len` must be exactly what `cellmoa_alloc` returned and was given.
#[no_mangle]
pub unsafe extern "C" fn cellmoa_free(ptr: *mut c_void, len: usize) {
    if !ptr.is_null() && len > 0 {
        drop(Vec::from_raw_parts(ptr as *mut u8, 0, len));
    }
}

/// Handles a request and returns a length-prefixed reply.
///
/// The reply is four little-endian bytes of length followed by that many bytes
/// of UTF-8 JSON. Length-prefixing rather than a separate call for the size
/// keeps the exchange to one crossing of the boundary.
///
/// # Safety
/// `session` must be live, and `ptr`/`len` must describe readable UTF-8.
#[no_mangle]
pub unsafe extern "C" fn cellmoa_dispatch(
    session: *mut SessionHandle,
    ptr: *const c_void,
    len: usize,
) -> *mut c_void {
    let request = match session.as_mut() {
        Some(_) if !ptr.is_null() || len == 0 => {
            std::str::from_utf8(std::slice::from_raw_parts(ptr as *const u8, len))
        }
        _ => return reply(r#"{"ok":false,"code":"bad_handle","message":"no session"}"#),
    };
    let Ok(request) = request else {
        return reply(r#"{"ok":false,"code":"bad_request","message":"request is not UTF-8"}"#);
    };
    let handle = &mut *session;
    let answer = handle.0.dispatch_json(request);
    reply(&answer)
}

/// Releases a reply from [`cellmoa_dispatch`].
///
/// # Safety
/// `ptr` must be a reply pointer that has not already been released.
#[no_mangle]
pub unsafe extern "C" fn cellmoa_free_reply(ptr: *mut c_void) {
    if ptr.is_null() {
        return;
    }
    let header = ptr as *const u8;
    let mut length = [0u8; 4];
    std::ptr::copy_nonoverlapping(header, length.as_mut_ptr(), 4);
    let length = u32::from_le_bytes(length) as usize;
    drop(Vec::from_raw_parts(ptr as *mut u8, 4 + length, 4 + length));
}

/// Loads a workbook from the bytes of an `.xlsx` file.
///
/// Separate from `cellmoa_dispatch` so that a file crosses the boundary as
/// bytes rather than as base64 inside JSON, which would cost a third of its
/// size again on every open.
///
/// # Safety
/// `session` must be live and `ptr`/`len` must describe readable bytes.
#[no_mangle]
pub unsafe extern "C" fn cellmoa_open_bytes(
    session: *mut SessionHandle,
    ptr: *const c_void,
    len: usize,
) -> *mut c_void {
    let Some(handle) = session.as_mut() else {
        return reply(r#"{"ok":false,"code":"bad_handle","message":"no session"}"#);
    };
    let bytes = if ptr.is_null() { &[][..] } else { std::slice::from_raw_parts(ptr as *const u8, len) };
    match handle.0.open_bytes(bytes) {
        Ok(()) => reply(&handle.0.dispatch_json(r#"{"op":"sheets"}"#)),
        Err(message) => {
            let escaped = message.replace('\\', "\\\\").replace('"', "\\\"");
            reply(&format!(r#"{{"ok":false,"code":"cannot_open","message":"{escaped}"}}"#))
        }
    }
}

/// Serialises the workbook as an `.xlsx` file, as a length-prefixed block.
///
/// # Safety
/// `session` must be live. The result is released with `cellmoa_free_reply`.
#[no_mangle]
pub unsafe extern "C" fn cellmoa_save_bytes(session: *mut SessionHandle) -> *mut c_void {
    let Some(handle) = session.as_mut() else {
        return reply_bytes(&[]);
    };
    reply_bytes(&handle.0.to_bytes())
}

/// The version of the engine behind these bindings, as a length-prefixed reply.
#[no_mangle]
pub extern "C" fn cellmoa_version() -> *mut c_void {
    reply(env!("CARGO_PKG_VERSION"))
}

/// Packs a string into a length-prefixed block the caller owns.
fn reply(text: &str) -> *mut c_void {
    reply_bytes(text.as_bytes())
}

/// Packs bytes into a length-prefixed block the caller owns.
fn reply_bytes(bytes: &[u8]) -> *mut c_void {
    let mut buffer = Vec::with_capacity(4 + bytes.len());
    buffer.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    buffer.extend_from_slice(bytes);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer as *mut c_void
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads a length-prefixed reply and releases it, the way the loader does.
    unsafe fn take_reply(pointer: *mut c_void) -> String {
        let header = pointer as *const u8;
        let mut length = [0u8; 4];
        std::ptr::copy_nonoverlapping(header, length.as_mut_ptr(), 4);
        let length = u32::from_le_bytes(length) as usize;
        let body = std::slice::from_raw_parts(header.add(4), length);
        let text = String::from_utf8(body.to_vec()).expect("the reply should be UTF-8");
        cellmoa_free_reply(pointer);
        text
    }

    /// Sends a request the way the loader does: allocate, copy, dispatch, free.
    unsafe fn send(session: *mut SessionHandle, request: &str) -> String {
        let bytes = request.as_bytes();
        let buffer = cellmoa_alloc(bytes.len());
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), buffer as *mut u8, bytes.len());
        let answer = take_reply(cellmoa_dispatch(session, buffer, bytes.len()));
        cellmoa_free(buffer, bytes.len());
        answer
    }

    #[test]
    fn a_session_round_trips_a_command() {
        unsafe {
            let session = cellmoa_session_new();
            let answer =
                send(session, r#"{"op":"write","cells":[{"cell":"A1","input":"=6*7"}]}"#);
            assert!(answer.contains(r#""ok":true"#), "{answer}");

            let answer = send(session, r#"{"op":"read","range":"A1"}"#);
            assert!(answer.contains(r#""text":"42""#), "{answer}");
            cellmoa_session_free(session);
        }
    }

    #[test]
    fn a_null_session_is_answered_rather_than_dereferenced() {
        unsafe {
            let answer = take_reply(cellmoa_dispatch(std::ptr::null_mut(), std::ptr::null(), 0));
            assert!(answer.contains("bad_handle"), "{answer}");
        }
    }

    #[test]
    fn malformed_input_comes_back_as_an_error_not_a_trap() {
        unsafe {
            let session = cellmoa_session_new();
            let answer = send(session, "not json");
            assert!(answer.contains(r#""ok":false"#), "{answer}");
            cellmoa_session_free(session);
        }
    }

    #[test]
    fn a_reply_survives_multi_byte_text() {
        unsafe {
            let session = cellmoa_session_new();
            send(session, r#"{"op":"write","cells":[{"cell":"A1","input":"한국어 🎉"}]}"#);
            let answer = send(session, r#"{"op":"read","range":"A1"}"#);
            assert!(answer.contains("한국어"), "{answer}");
            cellmoa_session_free(session);
        }
    }

    #[test]
    fn allocating_nothing_hands_back_nothing() {
        assert!(cellmoa_alloc(0).is_null());
        // Freeing it is still safe.
        unsafe { cellmoa_free(std::ptr::null_mut(), 0) };
    }

    #[test]
    fn a_workbook_crosses_the_boundary_as_bytes() {
        unsafe {
            let session = cellmoa_session_new();
            send(session, r#"{"op":"write","cells":[{"cell":"A1","input":"=6*7"}]}"#);

            // Save, then load the same bytes into a fresh session.
            let saved = cellmoa_save_bytes(session);
            let header = saved as *const u8;
            let mut length = [0u8; 4];
            std::ptr::copy_nonoverlapping(header, length.as_mut_ptr(), 4);
            let length = u32::from_le_bytes(length) as usize;
            let bytes = std::slice::from_raw_parts(header.add(4), length).to_vec();
            cellmoa_free_reply(saved);
            assert!(length > 0, "the workbook should have been written");

            let reopened = cellmoa_session_new();
            let buffer = cellmoa_alloc(bytes.len());
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), buffer as *mut u8, bytes.len());
            let answer = take_reply(cellmoa_open_bytes(reopened, buffer, bytes.len()));
            cellmoa_free(buffer, bytes.len());
            assert!(answer.contains(r#""ok":true"#), "{answer}");

            let answer = send(reopened, r#"{"op":"read","range":"A1"}"#);
            assert!(answer.contains(r#""text":"42""#), "{answer}");

            cellmoa_session_free(session);
            cellmoa_session_free(reopened);
        }
    }

    #[test]
    fn opening_rubbish_is_reported_rather_than_trapping() {
        unsafe {
            let session = cellmoa_session_new();
            let rubbish = b"not a workbook";
            let buffer = cellmoa_alloc(rubbish.len());
            std::ptr::copy_nonoverlapping(rubbish.as_ptr(), buffer as *mut u8, rubbish.len());
            let answer = take_reply(cellmoa_open_bytes(session, buffer, rubbish.len()));
            cellmoa_free(buffer, rubbish.len());
            assert!(answer.contains("cannot_open"), "{answer}");
            cellmoa_session_free(session);
        }
    }

    #[test]
    fn the_version_is_reported() {
        unsafe {
            let version = take_reply(cellmoa_version());
            assert_eq!(version, env!("CARGO_PKG_VERSION"));
        }
    }
}
