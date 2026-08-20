//! Rebuilding a formula tree with its references replaced.
//!
//! Two things rewrite references and they have nothing else in common:
//! [`crate::translate`] moves a formula and leaves the sheet alone, while
//! [`crate::adjust`] moves the sheet under every formula in the workbook. What
//! they share is the walk — every node reproduced, references handed to the
//! caller, everything else copied — and a walk that exists twice is a walk that
//! will grow a case in one copy and not the other the next time the syntax
//! gains a node.

use crate::ast::{Expr, Ref};

/// Rebuilds `expr`, passing every reference through `rewrite`.
///
/// A reference the rewriter wants to leave alone is returned unchanged; there
/// is no separate "skip" signal, because returning the input is one.
pub fn map_refs(expr: &Expr, rewrite: &mut impl FnMut(&Ref) -> Ref) -> Expr {
    match expr {
        Expr::Ref(reference) => Expr::Ref(rewrite(reference)),
        Expr::Unary { op, expr } => {
            Expr::Unary { op: *op, expr: Box::new(map_refs(expr, rewrite)) }
        }
        Expr::Binary { op, lhs, rhs } => Expr::Binary {
            op: *op,
            lhs: Box::new(map_refs(lhs, rewrite)),
            rhs: Box::new(map_refs(rhs, rewrite)),
        },
        Expr::Func { name, args } => Expr::Func {
            name: name.clone(),
            args: args.iter().map(|a| map_refs(a, rewrite)).collect(),
        },
        Expr::Paren(inner) => Expr::Paren(Box::new(map_refs(inner, rewrite))),
        Expr::Array(rows) => Expr::Array(
            rows.iter().map(|row| row.iter().map(|c| map_refs(c, rewrite)).collect()).collect(),
        ),
        // Numbers, text, booleans, error literals, defined names and omitted
        // arguments hold no reference to rewrite.
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::RefKind;
    use crate::parser::parse;
    use cellmoa_core::reference::CellRef;

    /// Replaces every reference with `A1`, so the walk itself is what is tested.
    fn flatten(source: &str) -> String {
        let expr = parse(source).unwrap();
        map_refs(&expr, &mut |reference| Ref {
            sheet: reference.sheet.clone(),
            kind: RefKind::Cell(CellRef::new(0, 0)),
        })
        .to_string()
    }

    #[test]
    fn every_node_that_can_hold_a_reference_is_walked() {
        assert_eq!(flatten("B2"), "A1");
        assert_eq!(flatten("-B2%"), "-A1%");
        assert_eq!(flatten("B2+C3"), "A1+A1");
        assert_eq!(flatten("SUM(B2,C3)"), "SUM(A1,A1)");
        assert_eq!(flatten("(B2)"), "(A1)");
        assert_eq!(flatten("Sheet2!B2"), "Sheet2!A1");
    }

    #[test]
    fn nodes_that_hold_none_are_copied_verbatim() {
        assert_eq!(flatten("{1,2;3,4}"), "{1,2;3,4}");
        assert_eq!(flatten("1+\"two\"&TRUE"), "1+\"two\"&TRUE");
        assert_eq!(flatten("#N/A"), "#N/A");
        assert_eq!(flatten("SUM(B2,,C3)"), "SUM(A1,,A1)");
        // A defined name is resolved at evaluation time, not here.
        assert_eq!(flatten("Taxes*B2"), "Taxes*A1");
    }
}
