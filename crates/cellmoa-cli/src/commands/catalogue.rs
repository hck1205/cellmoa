//! Listing what the engine can do.
use super::*;

/// Prints the built-in functions, one name per line, sorted — a list a shell
/// can grep and count. The tally goes to stderr so that `| wc -l` returns the
/// number of functions rather than the number of functions plus one.
pub(super) fn list_functions(args: &Args) -> Outcome {
    args.reject_unknown(&["json", "quiet"]).map_err(|e| Fault::Usage(e.to_string()))?;
    let mut all = catalogue();
    all.sort_by(|a, b| a.name.cmp(b.name));

    if args.has("json") {
        let entries: Vec<serde_json::Value> = all
            .iter()
            .map(|f| {
                serde_json::json!({
                    "name": f.name,
                    "min_args": f.min_args,
                    "max_args": f.max_args,
                    "volatile": f.volatile,
                })
            })
            .collect();
        out!("{}", serde_json::json!({ "count": entries.len(), "functions": entries }));
    } else {
        for function in &all {
            out!("{}", function.name);
        }
        note!(args, "{} function(s)", all.len());
    }
    ok()
}
