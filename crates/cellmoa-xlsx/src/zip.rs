//! Reading and writing ZIP archives.
//!
//! An XLSX file is a ZIP of XML parts, so the container comes first. Only what
//! the format actually uses is implemented: stored and deflated entries, no
//! encryption, no spanning.
//!
//! Writing is deterministic. Timestamps are fixed rather than taken from the
//! clock, and entries are written in the order given, so saving the same
//! workbook twice produces byte-identical files. A fingerprint (D2) that
//! changed every time you saved would be worthless.

use flate2::write::DeflateEncoder;
use flate2::Compression;
use std::collections::BTreeMap;
use std::fmt;
use std::io::Write;

const LOCAL_HEADER: u32 = 0x0403_4b50;
const CENTRAL_HEADER: u32 = 0x0201_4b50;
const END_OF_CENTRAL_DIRECTORY: u32 = 0x0605_4b50;
const ZIP64_END_LOCATOR: u32 = 0x0706_4b50;

/// The MS-DOS timestamp written into every entry: 1980-01-01 00:00.
///
/// The earliest the format can express, and the same on every run — which is
/// what makes two saves of the same workbook compare equal.
const FIXED_DOS_TIME: u16 = 0;
const FIXED_DOS_DATE: u16 = 0x0021;

#[derive(Debug)]
pub enum ZipError {
    NotAnArchive,
    Truncated,
    UnsupportedCompression(u16),
    Corrupt(String),
}

impl fmt::Display for ZipError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ZipError::NotAnArchive => f.write_str("not a zip archive"),
            ZipError::Truncated => f.write_str("zip archive ends unexpectedly"),
            ZipError::UnsupportedCompression(method) => {
                write!(f, "unsupported zip compression method {method}")
            }
            ZipError::Corrupt(what) => write!(f, "corrupt zip archive: {what}"),
        }
    }
}

impl std::error::Error for ZipError {}

/// An archive read into memory, keyed by part name.
///
/// XLSX parts are small and cross-referencing, so they are all read up front
/// rather than streamed.
#[derive(Debug, Default, Clone)]
pub struct Archive {
    entries: BTreeMap<String, Vec<u8>>,
    /// The order the entries appeared in, so a re-save keeps it.
    order: Vec<String>,
}

impl Archive {
    pub fn new() -> Archive {
        Archive::default()
    }

    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.entries.get(name).map(Vec::as_slice)
    }

    pub fn contains(&self, name: &str) -> bool {
        self.entries.contains_key(name)
    }

    /// Part names, in the order they were read or added.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.order.iter().map(String::as_str)
    }

    pub fn insert(&mut self, name: impl Into<String>, data: Vec<u8>) {
        let name = name.into();
        if !self.entries.contains_key(&name) {
            self.order.push(name.clone());
        }
        self.entries.insert(name, data);
    }

    pub fn remove(&mut self, name: &str) -> Option<Vec<u8>> {
        self.order.retain(|n| n != name);
        self.entries.remove(name)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Reads an archive from bytes.
    ///
    /// The central directory is the authority on what the archive contains —
    /// scanning local headers would also work until an entry uses a data
    /// descriptor, where the sizes in the local header are zero.
    pub fn read(bytes: &[u8]) -> Result<Archive, ZipError> {
        let eocd = find_end_of_central_directory(bytes).ok_or(ZipError::NotAnArchive)?;
        let entry_count = read_u16(bytes, eocd + 10)? as usize;
        let mut offset = read_u32(bytes, eocd + 16)? as usize;

        let mut archive = Archive::new();
        for _ in 0..entry_count {
            if read_u32(bytes, offset)? != CENTRAL_HEADER {
                return Err(ZipError::Corrupt("central directory entry expected".into()));
            }
            let method = read_u16(bytes, offset + 10)?;
            let compressed_size = read_u32(bytes, offset + 20)? as usize;
            let uncompressed_size = read_u32(bytes, offset + 24)? as usize;
            let name_len = read_u16(bytes, offset + 28)? as usize;
            let extra_len = read_u16(bytes, offset + 30)? as usize;
            let comment_len = read_u16(bytes, offset + 32)? as usize;
            let local_offset = read_u32(bytes, offset + 42)? as usize;
            let name = read_string(bytes, offset + 46, name_len)?;

            let data =
                read_local_entry(bytes, local_offset, method, compressed_size, uncompressed_size)?;
            archive.insert(name, data);
            offset += 46 + name_len + extra_len + comment_len;
        }
        Ok(archive)
    }

    /// Writes the archive out.
    pub fn write(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let mut directory = Vec::new();

        for name in &self.order {
            let data = &self.entries[name];
            let offset = out.len() as u32;
            let crc = crc32(data);
            // Deflate unless it makes the part bigger, which it does for very
            // short parts.
            let compressed = deflate(data);
            let (method, payload): (u16, &[u8]) =
                if compressed.len() < data.len() { (8, &compressed) } else { (0, data) };

            push_u32(&mut out, LOCAL_HEADER);
            push_u16(&mut out, 20); // version needed
            push_u16(&mut out, 0); // flags
            push_u16(&mut out, method);
            push_u16(&mut out, FIXED_DOS_TIME);
            push_u16(&mut out, FIXED_DOS_DATE);
            push_u32(&mut out, crc);
            push_u32(&mut out, payload.len() as u32);
            push_u32(&mut out, data.len() as u32);
            push_u16(&mut out, name.len() as u16);
            push_u16(&mut out, 0); // extra length
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(payload);

            push_u32(&mut directory, CENTRAL_HEADER);
            push_u16(&mut directory, 20); // version made by
            push_u16(&mut directory, 20); // version needed
            push_u16(&mut directory, 0); // flags
            push_u16(&mut directory, method);
            push_u16(&mut directory, FIXED_DOS_TIME);
            push_u16(&mut directory, FIXED_DOS_DATE);
            push_u32(&mut directory, crc);
            push_u32(&mut directory, payload.len() as u32);
            push_u32(&mut directory, data.len() as u32);
            push_u16(&mut directory, name.len() as u16);
            push_u16(&mut directory, 0); // extra
            push_u16(&mut directory, 0); // comment
            push_u16(&mut directory, 0); // disk number
            push_u16(&mut directory, 0); // internal attributes
            push_u32(&mut directory, 0); // external attributes
            push_u32(&mut directory, offset);
            directory.extend_from_slice(name.as_bytes());
        }

        let directory_offset = out.len() as u32;
        let directory_size = directory.len() as u32;
        out.extend_from_slice(&directory);

        push_u32(&mut out, END_OF_CENTRAL_DIRECTORY);
        push_u16(&mut out, 0); // disk number
        push_u16(&mut out, 0); // directory start disk
        push_u16(&mut out, self.order.len() as u16);
        push_u16(&mut out, self.order.len() as u16);
        push_u32(&mut out, directory_size);
        push_u32(&mut out, directory_offset);
        push_u16(&mut out, 0); // comment length
        out
    }
}

/// Reads one entry's data through its local header.
fn read_local_entry(
    bytes: &[u8],
    offset: usize,
    method: u16,
    compressed_size: usize,
    uncompressed_size: usize,
) -> Result<Vec<u8>, ZipError> {
    if read_u32(bytes, offset)? != LOCAL_HEADER {
        return Err(ZipError::Corrupt("local header expected".into()));
    }
    // The local header repeats the name and extra lengths, and they can differ
    // from the central directory's, so they are read again here.
    let name_len = read_u16(bytes, offset + 26)? as usize;
    let extra_len = read_u16(bytes, offset + 28)? as usize;
    let start = offset + 30 + name_len + extra_len;
    let end = start.checked_add(compressed_size).ok_or(ZipError::Truncated)?;
    let payload = bytes.get(start..end).ok_or(ZipError::Truncated)?;
    match method {
        0 => Ok(payload.to_vec()),
        8 => inflate(payload, uncompressed_size),
        other => Err(ZipError::UnsupportedCompression(other)),
    }
}

fn deflate(data: &[u8]) -> Vec<u8> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data).expect("writing to a Vec cannot fail");
    encoder.finish().expect("writing to a Vec cannot fail")
}

fn inflate(payload: &[u8], expected: usize) -> Result<Vec<u8>, ZipError> {
    let mut decoder = flate2::write::DeflateDecoder::new(Vec::with_capacity(expected));
    decoder
        .write_all(payload)
        .and_then(|()| decoder.finish())
        .map_err(|e| ZipError::Corrupt(e.to_string()))
}

/// Finds the end-of-central-directory record, which sits at the very end
/// unless there is an archive comment.
fn find_end_of_central_directory(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 22 {
        return None;
    }
    // The comment is at most 64 KiB, so the record cannot be further back.
    let earliest = bytes.len().saturating_sub(22 + 0xFFFF);
    (earliest..=bytes.len() - 22)
        .rev()
        .find(|&i| read_u32(bytes, i).is_ok_and(|tag| tag == END_OF_CENTRAL_DIRECTORY))
        .filter(|&i| {
            // A ZIP64 locator immediately before means the counts here are
            // placeholders, and this reader does not handle that.
            i < 20 || !read_u32(bytes, i - 20).is_ok_and(|tag| tag == ZIP64_END_LOCATOR)
        })
}

fn read_u16(bytes: &[u8], at: usize) -> Result<u16, ZipError> {
    let slice = bytes.get(at..at + 2).ok_or(ZipError::Truncated)?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32(bytes: &[u8], at: usize) -> Result<u32, ZipError> {
    let slice = bytes.get(at..at + 4).ok_or(ZipError::Truncated)?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_string(bytes: &[u8], at: usize, len: usize) -> Result<String, ZipError> {
    let slice = bytes.get(at..at + len).ok_or(ZipError::Truncated)?;
    String::from_utf8(slice.to_vec())
        .map_err(|_| ZipError::Corrupt("part name is not UTF-8".into()))
}

fn push_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

/// The CRC-32 the ZIP format checks entries with.
pub fn crc32(data: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut table = [0u32; 256];
        for (i, entry) in table.iter_mut().enumerate() {
            let mut value = i as u32;
            for _ in 0..8 {
                value = if value & 1 != 0 { 0xEDB8_8320 ^ (value >> 1) } else { value >> 1 };
            }
            *entry = value;
        }
        table
    });
    let mut crc = u32::MAX;
    for &byte in data {
        crc = table[((crc ^ byte as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ u32::MAX
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_matches_the_known_check_value() {
        // The standard check value for "123456789".
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    #[test]
    fn an_archive_round_trips() {
        let mut archive = Archive::new();
        archive.insert("[Content_Types].xml", b"<Types/>".to_vec());
        // Long enough that deflating it actually helps.
        archive.insert("xl/worksheets/sheet1.xml", "<c>".repeat(500).into_bytes());
        archive.insert("empty.bin", Vec::new());

        let bytes = archive.write();
        let read = Archive::read(&bytes).expect("archive should read back");

        assert_eq!(read.len(), 3);
        assert_eq!(read.get("[Content_Types].xml").unwrap(), b"<Types/>");
        assert_eq!(read.get("xl/worksheets/sheet1.xml").unwrap().len(), 1500);
        assert_eq!(read.get("empty.bin").unwrap(), b"");
    }

    #[test]
    fn part_order_survives_a_round_trip() {
        let mut archive = Archive::new();
        for name in ["z.xml", "a.xml", "m.xml"] {
            archive.insert(name, b"<x/>".to_vec());
        }
        let read = Archive::read(&archive.write()).unwrap();
        assert_eq!(read.names().collect::<Vec<_>>(), vec!["z.xml", "a.xml", "m.xml"]);
    }

    #[test]
    fn writing_the_same_archive_twice_gives_identical_bytes() {
        // Without this, every save would change the file's fingerprint.
        let mut archive = Archive::new();
        archive.insert("a.xml", b"hello".to_vec());
        archive.insert("b.xml", "x".repeat(1000).into_bytes());
        assert_eq!(archive.write(), archive.write());
    }

    #[test]
    fn a_large_part_is_actually_compressed() {
        let mut archive = Archive::new();
        let data = "the same line over and over\n".repeat(1000).into_bytes();
        let original = data.len();
        archive.insert("big.xml", data);
        assert!(archive.write().len() < original / 4);
    }

    #[test]
    fn rubbish_is_rejected_rather_than_misread() {
        assert!(matches!(Archive::read(b"not a zip"), Err(ZipError::NotAnArchive)));
        assert!(Archive::read(&[]).is_err());
        // A truncated archive must not panic.
        let mut archive = Archive::new();
        archive.insert("a.xml", b"hello".to_vec());
        let bytes = archive.write();
        assert!(Archive::read(&bytes[..bytes.len() / 2]).is_err());
    }

    #[test]
    fn removing_a_part_removes_it_from_the_order_too() {
        let mut archive = Archive::new();
        archive.insert("a.xml", b"1".to_vec());
        archive.insert("b.xml", b"2".to_vec());
        archive.remove("a.xml");
        assert_eq!(archive.names().collect::<Vec<_>>(), vec!["b.xml"]);
        assert!(!archive.contains("a.xml"));
    }
}
