//! Reads a workbook and prints what it found.

use cellmoa_xlsx::Package;

fn main() {
    let path = std::env::args().nth(1).expect("usage: dump <file.xlsx>");
    let package = Package::open(&path).expect("should open");
    for sheet in package.workbook.sheets() {
        println!("sheet {:?}", sheet.name);
        for (col, row, cell) in sheet.iter() {
            let reference = format!("{}{}", cellmoa_core::reference::col_to_letters(col), row + 1);
            println!(
                "  {reference:<4} content={:?} value={:?} style={:?}",
                cell.content, cell.value, cell.style
            );
        }
    }
    for name in package.workbook.names() {
        println!("name {:?} -> {:?}", name.name, name.refers_to);
    }
    println!("preserved parts: {:?}", package.preserved().names().collect::<Vec<_>>());
}
