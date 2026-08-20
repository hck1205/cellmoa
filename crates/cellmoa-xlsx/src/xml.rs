//! A small XML reader and writer, sized for OOXML.
//!
//! OOXML uses a narrow slice of XML: elements, attributes, text, and the five
//! predefined entities. There are no namespaces to resolve (prefixes are part
//! of the tag name as far as this crate is concerned), no DTDs to honour and no
//! mixed content to speak of. A pull reader over that is a few hundred lines
//! and keeps the file format entirely in this crate's hands.

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum XmlError {
    Malformed { message: String, position: usize },
    NotUtf8,
}

impl fmt::Display for XmlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            XmlError::Malformed { message, position } => {
                write!(f, "malformed XML: {message} (at byte {position})")
            }
            XmlError::NotUtf8 => f.write_str("XML part is not valid UTF-8"),
        }
    }
}

impl std::error::Error for XmlError {}

/// One element's name and attributes.
#[derive(Debug, Clone, PartialEq)]
pub struct Element {
    pub name: String,
    attributes: Vec<(String, String)>,
}

impl Element {
    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
    }

    pub fn attributes(&self) -> impl Iterator<Item = (&str, &str)> {
        self.attributes.iter().map(|(k, v)| (k.as_str(), v.as_str()))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Start(Element),
    End(String),
    /// Character data between tags, with entities already decoded.
    Text(String),
    Eof,
}

/// A pull reader over an XML document.
pub struct Reader<'a> {
    source: &'a str,
    pos: usize,
    /// A self-closing tag produces two events, so the second is held here.
    pending_end: Option<String>,
}

impl<'a> Reader<'a> {
    pub fn new(source: &'a str) -> Reader<'a> {
        Reader { source, pos: 0, pending_end: None }
    }

    pub fn from_bytes(bytes: &'a [u8]) -> Result<Reader<'a>, XmlError> {
        std::str::from_utf8(bytes).map(Reader::new).map_err(|_| XmlError::NotUtf8)
    }

    /// The next event, or `Eof` at the end of the document.
    pub fn next_event(&mut self) -> Result<Event, XmlError> {
        if let Some(name) = self.pending_end.take() {
            return Ok(Event::End(name));
        }
        if self.pos >= self.source.len() {
            return Ok(Event::Eof);
        }
        if self.source[self.pos..].starts_with('<') {
            return self.read_tag();
        }
        // Character data runs up to the next tag.
        let end =
            self.source[self.pos..].find('<').map(|i| self.pos + i).unwrap_or(self.source.len());
        let raw = &self.source[self.pos..end];
        self.pos = end;
        Ok(Event::Text(decode_entities(raw)))
    }

    /// Skips everything up to and including the end of the current element.
    ///
    /// Nesting is counted, so an element containing others of the same name is
    /// skipped correctly.
    pub fn skip_element(&mut self, name: &str) -> Result<(), XmlError> {
        let mut depth = 1;
        loop {
            match self.next_event()? {
                Event::Start(e) if e.name == name => depth += 1,
                Event::End(e) if e == name => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(());
                    }
                }
                Event::Eof => return Ok(()),
                _ => {}
            }
        }
    }

    /// The concatenated text of the current element, up to its end tag.
    pub fn text_of(&mut self, name: &str) -> Result<String, XmlError> {
        let mut out = String::new();
        loop {
            match self.next_event()? {
                Event::Text(text) => out.push_str(&text),
                Event::End(e) if e == name => return Ok(out),
                Event::Eof => return Ok(out),
                _ => {}
            }
        }
    }

    fn read_tag(&mut self) -> Result<Event, XmlError> {
        let rest = &self.source[self.pos..];
        // Declarations, comments and processing instructions carry nothing this
        // reader needs.
        if let Some(after) = rest.strip_prefix("<!--") {
            let end = after.find("-->").ok_or_else(|| self.malformed("unterminated comment"))?;
            self.pos += 4 + end + 3;
            return self.next_event();
        }
        if rest.starts_with("<?") {
            let end = rest.find("?>").ok_or_else(|| self.malformed("unterminated declaration"))?;
            self.pos += end + 2;
            return self.next_event();
        }
        if let Some(after) = rest.strip_prefix("<![CDATA[") {
            let end = after.find("]]>").ok_or_else(|| self.malformed("unterminated CDATA"))?;
            let text = after[..end].to_string();
            self.pos += 9 + end + 3;
            // CDATA is literal, so entities are not decoded inside it.
            return Ok(Event::Text(text));
        }
        if rest.starts_with("<!") {
            let end = rest.find('>').ok_or_else(|| self.malformed("unterminated declaration"))?;
            self.pos += end + 1;
            return self.next_event();
        }

        let end = self.find_tag_end().ok_or_else(|| self.malformed("unterminated tag"))?;
        let inner = &self.source[self.pos + 1..end];
        self.pos = end + 1;

        if let Some(name) = inner.strip_prefix('/') {
            return Ok(Event::End(name.trim().to_string()));
        }
        let self_closing = inner.ends_with('/');
        let inner = inner.strip_suffix('/').unwrap_or(inner);
        let element = parse_element(inner)?;
        if self_closing {
            self.pending_end = Some(element.name.clone());
        }
        Ok(Event::Start(element))
    }

    /// Finds the `>` that closes the current tag, ignoring any inside a quoted
    /// attribute value.
    fn find_tag_end(&self) -> Option<usize> {
        let bytes = self.source.as_bytes();
        let mut quote: Option<u8> = None;
        for (offset, &byte) in bytes[self.pos + 1..].iter().enumerate() {
            match (quote, byte) {
                (Some(q), c) if c == q => quote = None,
                (Some(_), _) => {}
                (None, c @ (b'"' | b'\'')) => quote = Some(c),
                (None, b'>') => return Some(self.pos + 1 + offset),
                (None, _) => {}
            }
        }
        None
    }

    fn malformed(&self, message: &str) -> XmlError {
        XmlError::Malformed { message: message.to_string(), position: self.pos }
    }
}

fn parse_element(inner: &str) -> Result<Element, XmlError> {
    let inner = inner.trim();
    let name_end = inner.find(char::is_whitespace).unwrap_or(inner.len());
    let name = inner[..name_end].to_string();
    if name.is_empty() {
        return Err(XmlError::Malformed { message: "empty tag name".into(), position: 0 });
    }
    let mut attributes = Vec::new();
    let mut rest = inner[name_end..].trim_start();
    while !rest.is_empty() {
        let Some(equals) = rest.find('=') else { break };
        let key = rest[..equals].trim().to_string();
        let after = rest[equals + 1..].trim_start();
        let Some(quote) = after.chars().next().filter(|c| *c == '"' || *c == '\'') else {
            return Err(XmlError::Malformed {
                message: format!("attribute `{key}` is not quoted"),
                position: 0,
            });
        };
        let value_start = quote.len_utf8();
        let Some(close) = after[value_start..].find(quote) else {
            return Err(XmlError::Malformed {
                message: format!("attribute `{key}` is not terminated"),
                position: 0,
            });
        };
        attributes.push((key, decode_entities(&after[value_start..value_start + close])));
        rest = after[value_start + close + quote.len_utf8()..].trim_start();
    }
    Ok(Element { name, attributes })
}

/// Expands the entities OOXML uses, including numeric character references.
pub fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let after = &rest[start..];
        let Some(end) = after.find(';') else {
            // A stray ampersand is kept rather than swallowed.
            out.push_str(after);
            return out;
        };
        let entity = &after[1..end];
        match entity {
            "amp" => out.push('&'),
            "lt" => out.push('<'),
            "gt" => out.push('>'),
            "quot" => out.push('"'),
            "apos" => out.push('\''),
            _ => {
                let decoded = entity
                    .strip_prefix('#')
                    .and_then(|number| match number.strip_prefix(['x', 'X']) {
                        Some(hex) => u32::from_str_radix(hex, 16).ok(),
                        None => number.parse().ok(),
                    })
                    .and_then(char::from_u32);
                match decoded {
                    Some(c) => out.push(c),
                    // An entity this reader does not know is left as written.
                    None => out.push_str(&after[..=end]),
                }
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

/// Escapes text for use in an element body or attribute value.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // Control characters are not representable in XML 1.0 at all, not
            // even as numeric references, so they are dropped rather than
            // producing a file that will not open.
            c if (c as u32) < 0x20 && c != '\t' && c != '\n' && c != '\r' => {}
            c => out.push(c),
        }
    }
    out
}

/// Builds an XML document.
#[derive(Default)]
pub struct Writer {
    out: String,
    open: Vec<String>,
}

impl Writer {
    /// A writer that has already emitted the XML declaration OOXML parts start
    /// with.
    pub fn new() -> Writer {
        Writer {
            out: String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n"),
            open: Vec::new(),
        }
    }

    /// Opens an element with attributes.
    pub fn start(&mut self, name: &str, attributes: &[(&str, &str)]) -> &mut Writer {
        self.out.push('<');
        self.out.push_str(name);
        self.write_attributes(attributes);
        self.out.push('>');
        self.open.push(name.to_string());
        self
    }

    /// Writes a childless element.
    pub fn empty(&mut self, name: &str, attributes: &[(&str, &str)]) -> &mut Writer {
        self.out.push('<');
        self.out.push_str(name);
        self.write_attributes(attributes);
        self.out.push_str("/>");
        self
    }

    /// Writes an element containing only text.
    pub fn text_element(
        &mut self,
        name: &str,
        attributes: &[(&str, &str)],
        text: &str,
    ) -> &mut Writer {
        self.start(name, attributes);
        self.out.push_str(&escape(text));
        self.end()
    }

    pub fn text(&mut self, text: &str) -> &mut Writer {
        self.out.push_str(&escape(text));
        self
    }

    /// Closes the innermost open element.
    pub fn end(&mut self) -> &mut Writer {
        if let Some(name) = self.open.pop() {
            self.out.push_str("</");
            self.out.push_str(&name);
            self.out.push('>');
        }
        self
    }

    fn write_attributes(&mut self, attributes: &[(&str, &str)]) {
        for (key, value) in attributes {
            self.out.push(' ');
            self.out.push_str(key);
            self.out.push_str("=\"");
            self.out.push_str(&escape(value));
            self.out.push('"');
        }
    }

    /// Finishes the document, closing anything still open.
    pub fn finish(mut self) -> Vec<u8> {
        while !self.open.is_empty() {
            self.end();
        }
        self.out.into_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn events(source: &str) -> Vec<Event> {
        let mut reader = Reader::new(source);
        let mut out = Vec::new();
        loop {
            match reader.next_event().expect("should parse") {
                Event::Eof => return out,
                event => out.push(event),
            }
        }
    }

    #[test]
    fn elements_attributes_and_text() {
        let events = events(r#"<c r="A1" t="s"><v>3</v></c>"#);
        let Event::Start(cell) = &events[0] else { panic!("expected a start event") };
        assert_eq!(cell.name, "c");
        assert_eq!(cell.attribute("r"), Some("A1"));
        assert_eq!(cell.attribute("t"), Some("s"));
        assert_eq!(cell.attribute("missing"), None);
        assert_eq!(events[2], Event::Text("3".into()));
        assert_eq!(events[3], Event::End("v".into()));
    }

    #[test]
    fn a_self_closing_tag_produces_both_events() {
        assert_eq!(
            events(r#"<sheetData/>"#),
            vec![
                Event::Start(Element { name: "sheetData".into(), attributes: vec![] }),
                Event::End("sheetData".into()),
            ]
        );
    }

    #[test]
    fn declarations_comments_and_doctypes_are_skipped() {
        let source = "<?xml version=\"1.0\"?><!-- a note --><!DOCTYPE x><a/>";
        assert_eq!(events(source).len(), 2);
    }

    #[test]
    fn entities_decode_including_numeric_references() {
        assert_eq!(decode_entities("a &amp; b"), "a & b");
        assert_eq!(decode_entities("&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_entities("&#65;&#x42;"), "AB");
        assert_eq!(decode_entities("plain"), "plain");
        // Something that is not an entity is left alone rather than eaten.
        assert_eq!(decode_entities("a & b"), "a & b");
        assert_eq!(decode_entities("&unknown;"), "&unknown;");
    }

    #[test]
    fn a_greater_than_sign_inside_an_attribute_does_not_end_the_tag() {
        let events = events(r#"<f t="normal">A1&gt;5</f>"#);
        let Event::Start(element) = &events[0] else { panic!("expected a start event") };
        assert_eq!(element.name, "f");
        assert_eq!(events[1], Event::Text("A1>5".into()));
    }

    #[test]
    fn quotes_inside_attributes_survive() {
        let events = events(r#"<f>CONCAT(&quot;a&quot;,&quot;b&quot;)</f>"#);
        assert_eq!(events[1], Event::Text(r#"CONCAT("a","b")"#.into()));
    }

    #[test]
    fn cdata_is_taken_literally() {
        assert_eq!(events("<a><![CDATA[x &amp; <y>]]></a>")[1], Event::Text("x &amp; <y>".into()));
    }

    #[test]
    fn skipping_an_element_counts_nesting() {
        let mut reader = Reader::new("<a><a><b/></a></a><c/>");
        let Event::Start(_) = reader.next_event().unwrap() else { panic!() };
        reader.skip_element("a").unwrap();
        let Event::Start(element) = reader.next_event().unwrap() else { panic!() };
        assert_eq!(element.name, "c");
    }

    #[test]
    fn text_of_gathers_everything_up_to_the_end_tag() {
        let mut reader = Reader::new("<t>one<x/>two</t>");
        let Event::Start(_) = reader.next_event().unwrap() else { panic!() };
        assert_eq!(reader.text_of("t").unwrap(), "onetwo");
    }

    #[test]
    fn writing_and_reading_come_back_to_the_same_text() {
        let mut writer = Writer::new();
        writer
            .start("worksheet", &[("xmlns", "http://example")])
            .start("sheetData", &[])
            .start("row", &[("r", "1")])
            .text_element("f", &[], r#"IF(A1>2,"a & b","c")"#)
            .end()
            .end();
        let bytes = writer.finish();

        let text = String::from_utf8(bytes).unwrap();
        let mut reader = Reader::new(&text);
        let mut formula = None;
        while let Ok(event) = reader.next_event() {
            match event {
                Event::Start(e) if e.name == "f" => formula = Some(reader.text_of("f").unwrap()),
                Event::Eof => break,
                _ => {}
            }
        }
        assert_eq!(formula.as_deref(), Some(r#"IF(A1>2,"a & b","c")"#));
    }

    #[test]
    fn unrepresentable_control_characters_are_dropped() {
        // A file containing a raw 0x01 cannot be opened at all, so it must not
        // be written in the first place.
        assert_eq!(escape("a\u{1}b"), "ab");
        assert_eq!(escape("a\tb\nc"), "a\tb\nc");
    }

    #[test]
    fn malformed_input_is_reported_rather_than_looping() {
        let mut reader = Reader::new("<a");
        assert!(reader.next_event().is_err());
        let mut reader = Reader::new("<!-- unterminated");
        assert!(reader.next_event().is_err());
    }
}
