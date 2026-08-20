//! Coverage of the function catalogue against the reference implementation.

use cellmoa_engine::catalogue;

#[test]
fn report_catalogue_size() {
    let all = catalogue();
    println!("functions implemented: {}", all.len());
    // The target is HyperFormula's 400-plus. This asserts the floor reached so
    // far so that a regression is caught; raise it as categories land.
    assert!(all.len() >= 100, "catalogue shrank to {}", all.len());
}
