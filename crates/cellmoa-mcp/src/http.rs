//! The remote transport: MCP over HTTP.
//!
//! A minimal HTTP/1.1 server, because the surface needed is one POST endpoint
//! and pulling in a web framework for that would be a heavier dependency than
//! the whole engine.
//!
//! Remote means shared, so two things are handled here that the stdio transport
//! does not have to think about: each session is a separate workbook keyed by a
//! session id, and a request may carry a bearer token that must match.

use crate::rpc::Server;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

/// How large a request body may be. A spreadsheet command is small; anything
/// past this is a mistake or an attack.
const MAX_BODY: usize = 8 * 1024 * 1024;

/// The sessions this server is holding, keyed by session id.
type Sessions = Arc<Mutex<HashMap<String, Server>>>;

pub struct HttpServer {
    listener: TcpListener,
    sessions: Sessions,
    /// When set, every request must carry this as a bearer token.
    token: Option<String>,
}

impl HttpServer {
    pub fn bind(address: &str, token: Option<String>) -> std::io::Result<HttpServer> {
        Ok(HttpServer {
            listener: TcpListener::bind(address)?,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            token,
        })
    }

    pub fn local_address(&self) -> std::io::Result<std::net::SocketAddr> {
        self.listener.local_addr()
    }

    /// Serves until the process ends.
    pub fn serve(&self) -> std::io::Result<()> {
        for stream in self.listener.incoming() {
            let stream = stream?;
            let sessions = Arc::clone(&self.sessions);
            let token = self.token.clone();
            // A thread per connection: a spreadsheet server handles a handful
            // of clients, not a hundred thousand.
            std::thread::spawn(move || {
                let _ = handle_connection(stream, sessions, token);
            });
        }
        Ok(())
    }

    /// Serves exactly one connection, for tests.
    pub fn serve_one(&self) -> std::io::Result<()> {
        let (stream, _) = self.listener.accept()?;
        handle_connection(stream, Arc::clone(&self.sessions), self.token.clone())
    }
}

/// A parsed request line and headers.
struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

fn handle_connection(
    mut stream: TcpStream,
    sessions: Sessions,
    token: Option<String>,
) -> std::io::Result<()> {
    let request = match read_request(&mut stream) {
        Ok(Some(request)) => request,
        Ok(None) => return Ok(()),
        Err(message) => return respond(&mut stream, 400, "text/plain", &message),
    };

    // CORS preflight, so a browser-based client can reach this.
    if request.method == "OPTIONS" {
        return respond(&mut stream, 204, "text/plain", "");
    }
    if request.path == "/health" {
        return respond(&mut stream, 200, "application/json", r#"{"ok":true}"#);
    }
    if request.method != "POST" {
        return respond(&mut stream, 405, "text/plain", "only POST is supported");
    }

    if let Some(expected) = &token {
        let presented = request
            .headers
            .get("authorization")
            .and_then(|value| value.strip_prefix("Bearer "))
            .unwrap_or("");
        // A constant-time comparison is not warranted for a local dev token,
        // but refusing loudly is.
        if presented != expected {
            return respond(
                &mut stream,
                401,
                "application/json",
                r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"unauthorised"}}"#,
            );
        }
    }

    // Each session id gets its own workbook, so two agents do not edit each
    // other's document by accident.
    let session_id =
        request.headers.get("mcp-session-id").cloned().unwrap_or_else(|| "default".to_string());

    let reply = {
        let mut sessions = sessions.lock().expect("the session map should not be poisoned");
        let server = sessions
            .entry(session_id.clone())
            .or_insert_with(|| Server::new(format!("mcp:{session_id}")));
        server.handle(&request.body)
    };

    match reply {
        Some(body) => respond(&mut stream, 200, "application/json", &body),
        // A notification has no reply, which HTTP expresses as 202.
        None => respond(&mut stream, 202, "text/plain", ""),
    }
}

fn read_request(stream: &mut TcpStream) -> Result<Option<HttpRequest>, String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut line = String::new();
    if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
        return Ok(None);
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            // Header names are case-insensitive, so they are stored folded.
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let length: usize =
        headers.get("content-length").and_then(|value| value.parse().ok()).unwrap_or(0);
    if length > MAX_BODY {
        return Err(format!("request body of {length} bytes is too large"));
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    let body = String::from_utf8(body).map_err(|_| "request body is not UTF-8".to_string())?;

    Ok(Some(HttpRequest { method, path, headers, body }))
}

fn respond(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Headers: content-type, authorization, mcp-session-id\r\n\
         Access-Control-Allow-Methods: POST, OPTIONS\r\n\
         Connection: close\r\n\
         \r\n{body}",
        body.len()
    )?;
    stream.flush()
}
