//! The two transports, end to end.
//!
//! The stdio path is tested by driving the binary; the HTTP path by speaking
//! HTTP to a real socket. Both go through the same tools, so what these check
//! is the transport itself: framing, session isolation and authorisation.

use cellmoa_mcp::http::HttpServer;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Command, Stdio};

/// Speaks one HTTP POST and returns the status and body.
fn post(address: &str, body: &str, headers: &[(&str, &str)]) -> (u16, String) {
    let mut stream = TcpStream::connect(address).expect("the server should be listening");
    let mut request = format!(
        "POST /mcp HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (name, value) in headers {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str("\r\n");
    request.push_str(body);
    stream.write_all(request.as_bytes()).expect("the request should send");
    stream.flush().unwrap();

    let mut response = String::new();
    stream.read_to_string(&mut response).expect("the response should arrive");
    let status: u16 = response
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .expect("a status line");
    let body = response.split_once("\r\n\r\n").map(|(_, body)| body).unwrap_or("").to_string();
    (status, body)
}

/// Starts an HTTP server on a free port and runs a test against it.
fn with_http_server(token: Option<&str>, test: impl FnOnce(&str)) {
    let server = HttpServer::bind("127.0.0.1:0", token.map(String::from)).expect("should bind");
    let address = server.local_address().expect("an address").to_string();
    // One connection per request, so the server thread serves in a loop until
    // the test finishes and the process moves on.
    std::thread::spawn(move || {
        for _ in 0..32 {
            if server.serve_one().is_err() {
                break;
            }
        }
    });
    test(&address);
}

#[test]
fn the_stdio_transport_answers_one_message_per_line() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_cellmoa-mcp"))
        .arg("--agent")
        .arg("tester")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("the server should start");

    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = BufReader::new(child.stdout.take().expect("stdout"));
    let mut lines = stdout.lines();

    let mut exchange = |request: Value| -> Value {
        writeln!(stdin, "{request}").expect("the request should send");
        stdin.flush().unwrap();
        let line = lines.next().expect("a reply").expect("a readable reply");
        serde_json::from_str(&line).expect("the reply should be JSON")
    };

    let reply = exchange(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }));
    assert_eq!(reply["result"]["serverInfo"]["name"], json!("cellmoa"));

    let reply = exchange(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
        "name": "write_cells",
        "arguments": { "cells": [{ "cell": "A1", "input": "6" }, { "cell": "B1", "input": "=A1*7" }] }
    }}));
    assert_eq!(reply["result"]["isError"], json!(false));

    let reply = exchange(json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
        "name": "read_cells", "arguments": { "range": "B1" }
    }}));
    assert_eq!(reply["result"]["structuredContent"]["cells"][0]["text"], json!("42"));

    drop(stdin);
    let _ = child.wait();
}

#[test]
fn the_stdio_transport_can_open_a_workbook_on_startup() {
    use cellmoa_core::model::{Cell, Workbook};
    use cellmoa_core::value::Value as CellValue;

    let directory = std::env::temp_dir().join(format!("cellmoa-mcp-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("book.xlsx");

    let mut workbook = Workbook::new();
    let id = workbook.add_sheet("Data");
    workbook.sheet_mut(id).unwrap().set(0, 0, Cell::literal(CellValue::Number(123.0)));
    cellmoa_xlsx::Package::new(workbook).save(&path).unwrap();

    let mut child = Command::new(env!("CARGO_BIN_EXE_cellmoa-mcp"))
        .arg("--open")
        .arg(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("the server should start");
    let mut stdin = child.stdin.take().unwrap();
    let stdout = BufReader::new(child.stdout.take().unwrap());
    let mut lines = stdout.lines();

    writeln!(
        stdin,
        "{}",
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": { "name": "read_cells", "arguments": { "range": "A1" } } })
    )
    .unwrap();
    stdin.flush().unwrap();
    let reply: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
    assert_eq!(reply["result"]["structuredContent"]["cells"][0]["text"], json!("123"));

    drop(stdin);
    let _ = child.wait();
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn the_http_transport_answers_json_rpc() {
    with_http_server(None, |address| {
        let (status, body) = post(
            address,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }).to_string(),
            &[],
        );
        assert_eq!(status, 200);
        let reply: Value = serde_json::from_str(&body).expect("the reply should be JSON");
        assert_eq!(reply["result"]["serverInfo"]["name"], json!("cellmoa"));
    });
}

#[test]
fn each_session_id_gets_its_own_workbook() {
    with_http_server(None, |address| {
        let write = |session: &str, value: &str| {
            post(
                address,
                &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
                    "name": "write_cells",
                    "arguments": { "cells": [{ "cell": "A1", "input": value }] } }})
                .to_string(),
                &[("Mcp-Session-Id", session)],
            )
        };
        let read = |session: &str| -> String {
            let (_, body) = post(
                address,
                &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
                    "name": "read_cells", "arguments": { "range": "A1" } }})
                .to_string(),
                &[("Mcp-Session-Id", session)],
            );
            let reply: Value = serde_json::from_str(&body).expect("JSON");
            reply["result"]["structuredContent"]["cells"][0]["text"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        };

        write("alice", "111");
        write("bob", "222");
        // Two agents must not be editing each other's document by accident.
        assert_eq!(read("alice"), "111");
        assert_eq!(read("bob"), "222");
    });
}

#[test]
fn a_token_is_required_when_one_is_configured() {
    with_http_server(Some("s3cret"), |address| {
        let request = json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }).to_string();

        let (status, _) = post(address, &request, &[]);
        assert_eq!(status, 401, "an unauthenticated request must be refused");

        let (status, _) = post(address, &request, &[("Authorization", "Bearer wrong")]);
        assert_eq!(status, 401);

        let (status, body) = post(address, &request, &[("Authorization", "Bearer s3cret")]);
        assert_eq!(status, 200);
        assert!(body.contains("\"result\""));
    });
}

#[test]
fn a_notification_over_http_is_accepted_with_no_body() {
    with_http_server(None, |address| {
        let (status, body) = post(
            address,
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
            &[],
        );
        assert_eq!(status, 202);
        assert!(body.is_empty());
    });
}
