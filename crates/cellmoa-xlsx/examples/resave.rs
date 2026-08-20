//! Opens a workbook and writes it back out, for checking that a file survives
//! a trip through this crate.

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(input), Some(output)) = (args.next(), args.next()) else {
        eprintln!("usage: resave <input.xlsx> <output.xlsx>");
        std::process::exit(2);
    };
    let package = cellmoa_xlsx::Package::open(&input).expect("input should open");
    package.save(&output).expect("output should save");
    println!("{input} -> {output}");
}
