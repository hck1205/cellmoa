//! Coverage of the function catalogue against the reference implementation.

use cellmoa_engine::catalogue;

#[test]
fn report_catalogue_size() {
    let all = catalogue();
    println!("functions implemented: {}", all.len());
    // HyperFormula's catalogue is the benchmark. This asserts the floor
    // reached so far so that a regression is caught; raise it as more land.
    assert!(all.len() >= 400, "catalogue shrank to {}", all.len());
}
