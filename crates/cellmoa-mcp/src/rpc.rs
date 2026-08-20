//! JSON-RPC 2.0 and the MCP methods on top of it.

use crate::tools::{self, TOOLS};
use cellmoa_api::Session;
use serde_json::{json, Value};

/// The protocol revision this server implements.
const PROTOCOL_VERSION: &str = "2025-06-18";

/// Error codes from the JSON-RPC specification.
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

/// A server holding one workbook.
pub struct Server {
    pub session: Session,
    /// Names the agent's edits in the audit trail, and scopes its undo.
    pub agent: String,
    initialised: bool,
}

impl Default for Server {
    fn default() -> Self {
        Server::new("agent")
    }
}

impl Server {
    pub fn new(agent: impl Into<String>) -> Server {
        Server { session: Session::new(), agent: agent.into(), initialised: false }
    }

    /// Handles one line of JSON-RPC, returning the reply to write back.
    ///
    /// A notification — a request with no `id` — produces no reply, which is
    /// what `None` means here.
    pub fn handle(&mut self, line: &str) -> Option<String> {
        let request: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(e) => return Some(error_response(Value::Null, PARSE_ERROR, &e.to_string())),
        };
        // A batch is a JSON array of requests.
        if let Some(batch) = request.as_array() {
            let replies: Vec<String> =
                batch.iter().filter_map(|request| self.handle_one(request)).collect();
            return (!replies.is_empty()).then(|| format!("[{}]", replies.join(",")));
        }
        self.handle_one(&request)
    }

    fn handle_one(&mut self, request: &Value) -> Option<String> {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let is_notification = request.get("id").is_none();

        let Some(method) = request.get("method").and_then(Value::as_str) else {
            return (!is_notification)
                .then(|| error_response(id, INVALID_REQUEST, "no method given"));
        };
        let params = request.get("params").cloned().unwrap_or(json!({}));

        let outcome = match method {
            "initialize" => {
                self.initialised = true;
                Ok(json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "cellmoa", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "A spreadsheet engine. Read and write cells, evaluate \
                                     formulas, and check results. Every response carries a \
                                     `revision`; pass it back with the next write and the write \
                                     is refused rather than overwriting an edit you did not see.",
                }))
            }
            // Sent after initialize; there is nothing to answer.
            "notifications/initialized" | "initialized" => return None,
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({
                "tools": TOOLS.iter().map(|tool| json!({
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": (tool.schema)(),
                })).collect::<Vec<_>>()
            })),
            "tools/call" => self.call_tool(&params),
            "resources/list" => Ok(json!({ "resources": [] })),
            "prompts/list" => Ok(json!({ "prompts": [] })),
            other => Err((METHOD_NOT_FOUND, format!("unknown method `{other}`"))),
        };

        if is_notification {
            return None;
        }
        Some(match outcome {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string(),
            Err((code, message)) => error_response(id, code, &message),
        })
    }

    fn call_tool(&mut self, params: &Value) -> Result<Value, (i64, String)> {
        let Some(name) = params.get("name").and_then(Value::as_str) else {
            return Err((INVALID_PARAMS, "no tool name given".into()));
        };
        let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
        let answer = tools::call(&mut self.session, name, &arguments, &self.agent);

        // MCP reports a tool's own failure in the result with `isError`, not as
        // a protocol error: the call reached the tool, and the model needs to
        // see what it said.
        let failed = answer.get("ok") == Some(&json!(false));
        let text = serde_json::to_string_pretty(&answer).unwrap_or_else(|_| answer.to_string());
        Ok(json!({
            "content": [{ "type": "text", "text": text }],
            "structuredContent": answer,
            "isError": failed,
        }))
    }
}

fn error_response(id: Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(server: &mut Server, request: Value) -> Value {
        let reply = server.handle(&request.to_string()).expect("a reply was expected");
        serde_json::from_str(&reply).expect("the reply should be JSON")
    }

    /// Calls a tool and returns the structured answer.
    fn tool(server: &mut Server, name: &str, arguments: Value) -> Value {
        let reply = call(
            server,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                    "params": { "name": name, "arguments": arguments } }),
        );
        reply["result"]["structuredContent"].clone()
    }

    #[test]
    fn initialize_reports_the_protocol_and_the_server() {
        let mut server = Server::default();
        let reply = call(&mut server, json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }));
        assert_eq!(reply["result"]["protocolVersion"], json!(PROTOCOL_VERSION));
        assert_eq!(reply["result"]["serverInfo"]["name"], json!("cellmoa"));
        assert!(reply["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn a_notification_gets_no_reply() {
        let mut server = Server::default();
        assert!(server
            .handle(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
            .is_none());
        // Any notification, not just that one.
        assert!(server.handle(r#"{"jsonrpc":"2.0","method":"ping"}"#).is_none());
    }

    #[test]
    fn every_tool_is_listed_with_a_schema() {
        let mut server = Server::default();
        let reply = call(&mut server, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
        let tools = reply["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), TOOLS.len());
        for tool in tools {
            assert!(tool["name"].is_string());
            assert!(!tool["description"].as_str().unwrap().is_empty());
            assert_eq!(tool["inputSchema"]["type"], json!("object"));
        }
    }

    #[test]
    fn writing_and_reading_through_the_tools() {
        let mut server = Server::default();
        let written = tool(
            &mut server,
            "write_cells",
            json!({ "cells": [{ "cell": "A1", "input": "10" }, { "cell": "B1", "input": "=A1*2" }] }),
        );
        assert_eq!(written["ok"], json!(true));

        let read = tool(&mut server, "read_cells", json!({ "range": "A1:B1" }));
        assert_eq!(read["cells"][1]["text"], json!("20"));
        assert_eq!(read["cells"][1]["formula"], json!("=A1*2"));
    }

    #[test]
    fn a_stale_write_is_refused_through_the_tools_too() {
        let mut server = Server::default();
        tool(&mut server, "write_cells", json!({ "cells": [{ "cell": "A1", "input": "1" }] }));
        let seen = server.session.revision();
        // The user edits while the agent was thinking.
        tool(&mut server, "write_cells", json!({ "cells": [{ "cell": "A1", "input": "2" }] }));

        let refused = tool(
            &mut server,
            "write_cells",
            json!({ "revision": seen, "cells": [{ "cell": "A1", "input": "999" }] }),
        );
        assert_eq!(refused["code"], json!("revision_conflict"));
    }

    #[test]
    fn a_tools_own_failure_is_reported_in_the_result_not_as_a_protocol_error() {
        let mut server = Server::default();
        let reply = call(
            &mut server,
            json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call",
                    "params": { "name": "read_cells", "arguments": { "range": "not a range" } } }),
        );
        // The model has to be able to see what went wrong.
        assert!(reply["error"].is_null(), "{reply}");
        assert_eq!(reply["result"]["isError"], json!(true));
        assert_eq!(reply["result"]["structuredContent"]["code"], json!("bad_range"));
        assert!(reply["result"]["content"][0]["text"].as_str().unwrap().contains("bad_range"));
    }

    #[test]
    fn the_agents_edits_can_be_undone_on_their_own() {
        let mut server = Server::new("agent-7");
        // A change the agent did not make.
        server.session.dispatch_json(
            &json!({ "op": "write", "who": { "kind": "human", "id": "u1" },
                                    "cells": [{ "cell": "A1", "input": "1" }] })
            .to_string(),
        );
        tool(&mut server, "write_cells", json!({ "cells": [{ "cell": "B1", "input": "99" }] }));

        tool(&mut server, "undo", json!({ "only_mine": true }));

        let read = tool(&mut server, "read_cells", json!({ "range": "A1:B1" }));
        let cells = read["cells"].as_array().unwrap();
        assert_eq!(cells.len(), 1, "only the user's cell should remain");
        assert_eq!(cells[0]["cell"], json!("A1"));
    }

    #[test]
    fn the_audit_trail_names_the_agent() {
        let mut server = Server::new("agent-7");
        tool(
            &mut server,
            "write_cells",
            json!({ "cells": [{ "cell": "A1", "input": "1" }], "label": "forecast" }),
        );
        let history = tool(&mut server, "cell_history", json!({ "cell": "A1" }));
        assert_eq!(history["history"][0]["actor"]["id"], json!("agent-7"));
        assert_eq!(history["history"][0]["actor"]["kind"], json!("agent"));
        assert_eq!(history["history"][0]["label"], json!("forecast"));
    }

    #[test]
    fn evaluate_and_verify_and_fingerprint() {
        let mut server = Server::default();
        tool(&mut server, "write_cells", json!({ "cells": [{ "cell": "A1", "input": "10" }] }));

        assert_eq!(
            tool(&mut server, "evaluate", json!({ "formula": "=A1*4" }))["value"],
            json!(40.0)
        );
        assert_eq!(
            tool(&mut server, "verify", json!({ "expect": [{ "cell": "A1", "equals": 10 }] }))
                ["passed"],
            json!(true)
        );
        assert_eq!(
            tool(&mut server, "fingerprint", json!({}))["fingerprint"]["workbook"]
                .as_str()
                .unwrap()
                .len(),
            64
        );
    }

    #[test]
    fn an_unknown_method_is_a_protocol_error() {
        let mut server = Server::default();
        let reply = call(&mut server, json!({ "jsonrpc": "2.0", "id": 1, "method": "nope" }));
        assert_eq!(reply["error"]["code"], json!(METHOD_NOT_FOUND));
    }

    #[test]
    fn malformed_input_is_answered_rather_than_crashing() {
        let mut server = Server::default();
        let reply: Value =
            serde_json::from_str(&server.handle("not json").unwrap()).expect("a reply");
        assert_eq!(reply["error"]["code"], json!(PARSE_ERROR));

        let reply: Value =
            serde_json::from_str(&server.handle(r#"{"jsonrpc":"2.0","id":1}"#).unwrap()).unwrap();
        assert_eq!(reply["error"]["code"], json!(INVALID_REQUEST));
    }

    #[test]
    fn a_batch_is_answered_as_a_batch() {
        let mut server = Server::default();
        let reply = server
            .handle(
                &json!([
                    { "jsonrpc": "2.0", "id": 1, "method": "ping" },
                    { "jsonrpc": "2.0", "method": "notifications/initialized" },
                    { "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
                ])
                .to_string(),
            )
            .expect("a reply");
        let replies: Vec<Value> = serde_json::from_str(&reply).expect("an array");
        // The notification in the middle contributes nothing.
        assert_eq!(replies.len(), 2);
        assert_eq!(replies[0]["id"], json!(1));
        assert_eq!(replies[1]["id"], json!(2));
    }
}
