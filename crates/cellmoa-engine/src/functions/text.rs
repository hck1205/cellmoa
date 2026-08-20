//! Text functions.
//!
//! Positions and lengths are counted in characters, not bytes, so a sheet in
//! Korean or with emoji behaves the way the user sees it rather than the way it
//! is encoded.

use super::args;
use super::*;
use crate::operand::Operand;

/// Takes a character slice, clamping to the string's real length.
fn slice(s: &str, start: usize, len: usize) -> String {
    s.chars().skip(start).take(len).collect()
}

fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// The byte offset of a character index, for converting search results back.
fn char_index_of_byte(s: &str, byte: usize) -> usize {
    s[..byte].chars().count()
}

pub const FUNCTIONS: &[Function] = &[
    f("LEN", 1, Some(1), |ctx, a| match arg_text(ctx, a, 0) {
        Ok(s) => Operand::number(char_len(&s) as f64),
        Err(e) => Operand::error(e),
    }),
    f("LEFT", 1, Some(2), |ctx, a| {
        args!(s = arg_text(ctx, a, 0), n = opt_num(ctx, a, 1, 1.0));
        if n < 0.0 {
            return Operand::error(CellError::Value);
        }
        Operand::text(slice(&s, 0, n.trunc() as usize))
    }),
    f("RIGHT", 1, Some(2), |ctx, a| {
        args!(s = arg_text(ctx, a, 0), n = opt_num(ctx, a, 1, 1.0));
        if n < 0.0 {
            return Operand::error(CellError::Value);
        }
        let take = (n.trunc() as usize).min(char_len(&s));
        Operand::text(slice(&s, char_len(&s) - take, take))
    }),
    f("MID", 3, Some(3), |ctx, a| {
        args!(s = arg_text(ctx, a, 0), start = arg_num(ctx, a, 1), len = arg_num(ctx, a, 2));
        if start < 1.0 || len < 0.0 {
            return Operand::error(CellError::Value);
        }
        Operand::text(slice(&s, start.trunc() as usize - 1, len.trunc() as usize))
    }),
    f("LOWER", 1, Some(1), |ctx, a| match arg_text(ctx, a, 0) {
        Ok(s) => Operand::text(s.to_lowercase()),
        Err(e) => Operand::error(e),
    }),
    f("UPPER", 1, Some(1), |ctx, a| match arg_text(ctx, a, 0) {
        Ok(s) => Operand::text(s.to_uppercase()),
        Err(e) => Operand::error(e),
    }),
    f("PROPER", 1, Some(1), |ctx, a| match arg_text(ctx, a, 0) {
        Ok(s) => {
            // A letter starts a word unless the character before it is one too.
            let mut out = String::with_capacity(s.len());
            let mut previous_was_letter = false;
            for c in s.chars() {
                if previous_was_letter {
                    out.extend(c.to_lowercase());
                } else {
                    out.extend(c.to_uppercase());
                }
                previous_was_letter = c.is_alphabetic();
            }
            Operand::text(out)
        }
        Err(e) => Operand::error(e),
    }),
    f("TRIM", 1, Some(1), |ctx, a| match arg_text(ctx, a, 0) {
        // TRIM collapses runs of interior spaces as well as stripping the ends.
        Ok(s) => Operand::text(s.split_whitespace().collect::<Vec<_>>().join(" ")),
        Err(e) => Operand::error(e),
    }),
    f("CLEAN", 1, Some(1), |ctx, a| match arg_text(ctx, a, 0) {
        Ok(s) => Operand::text(s.chars().filter(|c| !c.is_control()).collect::<String>()),
        Err(e) => Operand::error(e),
    }),
    f("REPT", 2, Some(2), |ctx, a| {
        args!(s = arg_text(ctx, a, 0), n = arg_num(ctx, a, 1));
        if n < 0.0 {
            return Operand::error(CellError::Value);
        }
        let count = n.trunc() as usize;
        // A cell holds at most 32767 characters; refuse rather than allocate.
        if char_len(&s).saturating_mul(count) > 32_767 {
            return Operand::error(CellError::Value);
        }
        Operand::text(s.repeat(count))
    }),
    f("CONCATENATE", 1, None, |ctx, a| {
        let mut out = String::new();
        for i in 0..a.len() {
            match arg_text(ctx, a, i) {
                Ok(s) => out.push_str(&s),
                Err(e) => return Operand::error(e),
            }
        }
        Operand::text(out)
    }),
    f("CONCAT", 1, None, |ctx, a| {
        // Unlike CONCATENATE, CONCAT flattens ranges.
        let mut out = String::new();
        let mut error = None;
        for operand in a {
            operand.for_each(ctx.wb, &mut |v| match v.coerce_text() {
                Ok(s) => out.push_str(&s),
                Err(e) if error.is_none() => error = Some(e),
                Err(_) => {}
            });
        }
        match error {
            Some(e) => Operand::error(e),
            None => Operand::text(out),
        }
    }),
    f("TEXTJOIN", 3, None, |ctx, a| {
        args!(sep = arg_text(ctx, a, 0), skip_empty = arg_bool(ctx, a, 1));
        let mut parts = Vec::new();
        let mut error = None;
        for operand in &a[2..] {
            operand.for_each(ctx.wb, &mut |v| {
                if error.is_some() {
                    return;
                }
                match v.coerce_text() {
                    Ok(s) if !skip_empty || !s.is_empty() => parts.push(s),
                    Ok(_) => {}
                    Err(e) => error = Some(e),
                }
            });
        }
        match error {
            Some(e) => Operand::error(e),
            None => Operand::text(parts.join(&sep)),
        }
    }),
    f("EXACT", 2, Some(2), |ctx, a| {
        args!(x = arg_text(ctx, a, 0), y = arg_text(ctx, a, 1));
        // EXACT is the one text comparison that is case-sensitive.
        Operand::bool(x == y)
    }),
    f("FIND", 2, Some(3), |ctx, a| {
        args!(
            needle = arg_text(ctx, a, 0),
            haystack = arg_text(ctx, a, 1),
            start = opt_num(ctx, a, 2, 1.0),
        );
        if start < 1.0 || start as usize > char_len(&haystack) + 1 {
            return Operand::error(CellError::Value);
        }
        let offset: usize = haystack.chars().take(start as usize - 1).map(char::len_utf8).sum();
        // FIND is case-sensitive and takes no wildcards.
        match haystack[offset..].find(&needle) {
            Some(byte) => {
                Operand::number(char_index_of_byte(&haystack, offset + byte) as f64 + 1.0)
            }
            None => Operand::error(CellError::Value),
        }
    }),
    f("SEARCH", 2, Some(3), |ctx, a| {
        args!(
            needle = arg_text(ctx, a, 0),
            haystack = arg_text(ctx, a, 1),
            start = opt_num(ctx, a, 2, 1.0),
        );
        if start < 1.0 || start as usize > char_len(&haystack) + 1 {
            return Operand::error(CellError::Value);
        }
        // SEARCH is the case-insensitive counterpart of FIND. Lower-casing can
        // change a character's byte length, so the start offset is measured in
        // the lower-cased string rather than carried over from the original.
        let (hay, pin) = (haystack.to_lowercase(), needle.to_lowercase());
        let offset: usize = hay.chars().take(start as usize - 1).map(char::len_utf8).sum();
        match hay[offset..].find(&pin) {
            Some(byte) => Operand::number(char_index_of_byte(&hay, offset + byte) as f64 + 1.0),
            None => Operand::error(CellError::Value),
        }
    }),
    f("SUBSTITUTE", 3, Some(4), |ctx, a| {
        args!(text = arg_text(ctx, a, 0), old = arg_text(ctx, a, 1), new = arg_text(ctx, a, 2));
        if old.is_empty() {
            return Operand::text(text);
        }
        match a.get(3) {
            None => Operand::text(text.replace(&old, &new)),
            Some(_) => {
                let Ok(nth) = arg_num(ctx, a, 3) else {
                    return Operand::error(CellError::Value);
                };
                if nth < 1.0 {
                    return Operand::error(CellError::Value);
                }
                // Replace only the nth occurrence, counting from one.
                let target = nth.trunc() as usize;
                let mut out = String::with_capacity(text.len());
                let mut rest = text.as_str();
                let mut seen = 0;
                while let Some(at) = rest.find(&old) {
                    seen += 1;
                    out.push_str(&rest[..at]);
                    if seen == target {
                        out.push_str(&new);
                        out.push_str(&rest[at + old.len()..]);
                        return Operand::text(out);
                    }
                    out.push_str(&old);
                    rest = &rest[at + old.len()..];
                }
                out.push_str(rest);
                Operand::text(out)
            }
        }
    }),
    f("REPLACE", 4, Some(4), |ctx, a| {
        args!(
            text = arg_text(ctx, a, 0),
            start = arg_num(ctx, a, 1),
            len = arg_num(ctx, a, 2),
            new = arg_text(ctx, a, 3),
        );
        if start < 1.0 || len < 0.0 {
            return Operand::error(CellError::Value);
        }
        let start = start.trunc() as usize - 1;
        let len = len.trunc() as usize;
        let mut out: String = text.chars().take(start).collect();
        out.push_str(&new);
        out.extend(text.chars().skip(start + len));
        Operand::text(out)
    }),
    f("T", 1, Some(1), |ctx, a| match arg(ctx, a, 0) {
        // T keeps text and discards everything else — errors included, which
        // pass straight through.
        Value::Text(s) => Operand::text(s),
        Value::Error(e) => Operand::error(e),
        _ => Operand::text(""),
    }),
    f("VALUE", 1, Some(1), |ctx, a| match arg_text(ctx, a, 0) {
        Ok(s) => match Value::Text(s).coerce_number() {
            Ok(n) => Operand::number(n),
            Err(_) => Operand::error(CellError::Value),
        },
        Err(e) => Operand::error(e),
    }),
    f("NUMBERVALUE", 1, Some(3), |ctx, a| {
        let Ok(text) = arg_text(ctx, a, 0) else {
            return Operand::error(CellError::Value);
        };
        let decimal = arg_text(ctx, a, 1).unwrap_or_default();
        let group = arg_text(ctx, a, 2).unwrap_or_default();
        let mut normalised = text.replace(char::is_whitespace, "");
        if !group.is_empty() {
            normalised = normalised.replace(&group, "");
        }
        if !decimal.is_empty() && decimal != "." {
            normalised = normalised.replace(&decimal, ".");
        }
        match Value::Text(normalised).coerce_number() {
            Ok(n) => Operand::number(n),
            Err(_) => Operand::error(CellError::Value),
        }
    }),
    f("CHAR", 1, Some(1), |ctx, a| match arg_num(ctx, a, 0) {
        Ok(n) if (1.0..256.0).contains(&n) => Operand::text((n.trunc() as u8 as char).to_string()),
        Ok(_) => Operand::error(CellError::Value),
        Err(e) => Operand::error(e),
    }),
    f("UNICHAR", 1, Some(1), |ctx, a| match arg_num(ctx, a, 0) {
        Ok(n) if n >= 1.0 => match char::from_u32(n.trunc() as u32) {
            Some(c) => Operand::text(c.to_string()),
            None => Operand::error(CellError::Value),
        },
        Ok(_) => Operand::error(CellError::Value),
        Err(e) => Operand::error(e),
    }),
    f("CODE", 1, Some(1), |ctx, a| match arg_text(ctx, a, 0) {
        Ok(s) => match s.chars().next() {
            Some(c) => Operand::number(c as u32 as f64),
            None => Operand::error(CellError::Value),
        },
        Err(e) => Operand::error(e),
    }),
    f("UNICODE", 1, Some(1), |ctx, a| match arg_text(ctx, a, 0) {
        Ok(s) => match s.chars().next() {
            Some(c) => Operand::number(c as u32 as f64),
            None => Operand::error(CellError::Value),
        },
        Err(e) => Operand::error(e),
    }),
];
