//! The cellmoa MCP server.
//!
//! Two transports over the same tools: stdio for a client that launches the
//! server itself, and HTTP for one that connects to it.

use cellmoa_mcp::{http, rpc};
use std::io::{BufRead, Write};

const USAGE: &str = "\
cellmoa-mcp — a Model Context Protocol server for cellmoa

usage:
  cellmoa-mcp [--agent <name>] [--open <file.xlsx>]
      Serve over stdio, one JSON-RPC message per line.

  cellmoa-mcp --http <address> [--token <secret>] [--agent <name>]
      Serve over HTTP. Each `Mcp-Session-Id` header gets its own workbook.

  --agent <name>   How this server's edits are recorded, and what an
                   agent-scoped undo rolls back. Defaults to `agent`.
  --token <secret> Require `Authorization: Bearer <secret>` on every request.
";

fn main() -> std::process::ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.iter().any(|a| a == "--help" || a == "-h") {
        print!("{USAGE}");
        return std::process::ExitCode::SUCCESS;
    }

    let value = |name: &str| -> Option<String> {
        arguments.iter().position(|a| a == name).and_then(|i| arguments.get(i + 1)).cloned()
    };
    let agent = value("--agent").unwrap_or_else(|| "agent".to_string());

    if let Some(address) = value("--http") {
        return match http::HttpServer::bind(&address, value("--token")) {
            Ok(server) => {
                eprintln!("cellmoa-mcp listening on http://{address}");
                if let Err(e) = server.serve() {
                    eprintln!("cellmoa-mcp: {e}");
                    return std::process::ExitCode::from(1);
                }
                std::process::ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("cellmoa-mcp: cannot listen on {address}: {e}");
                std::process::ExitCode::from(2)
            }
        };
    }

    let mut server = rpc::Server::new(agent);
    if let Some(path) = value("--open") {
        let request = serde_json::json!({ "op": "open", "path": path }).to_string();
        let answer = server.session.dispatch_json(&request);
        if answer.contains(r#""ok":false"#) {
            eprintln!("cellmoa-mcp: {answer}");
            return std::process::ExitCode::from(2);
        }
    }

    // stdio transport: one JSON-RPC message per line, replies likewise.
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        if let Some(reply) = server.handle(&line) {
            if writeln!(stdout, "{reply}").is_err() || stdout.flush().is_err() {
                break;
            }
        }
    }
    std::process::ExitCode::SUCCESS
}
