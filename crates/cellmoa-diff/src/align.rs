//! Aligning two sequences of rows.
//!
//! A diff that compares row 5 with row 5 reports every row below an insertion
//! as changed, which is useless on a spreadsheet where inserting a row is an
//! everyday act. Aligning the rows first means an insertion is reported as one
//! insertion.
//!
//! The alignment is the patience algorithm: rows that appear exactly once on
//! each side are unambiguous anchors, the longest increasing run of those
//! anchors is kept, and the gaps between them are aligned the same way again.
//! Its output is stable and its worst case is well behaved on the long runs of
//! identical rows a spreadsheet is full of.

use std::collections::HashMap;

/// How one row on each side lines up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Alignment {
    /// Present on both sides, at these indices.
    Matched { before: usize, after: usize },
    /// Present only in the old version.
    Removed(usize),
    /// Present only in the new version.
    Added(usize),
}

/// Aligns two sequences by their keys.
pub fn align<K: Eq + std::hash::Hash + Clone>(before: &[K], after: &[K]) -> Vec<Alignment> {
    let mut out = Vec::new();
    align_range(before, after, 0, before.len(), 0, after.len(), &mut out);
    out
}

fn align_range<K: Eq + std::hash::Hash + Clone>(
    before: &[K],
    after: &[K],
    before_start: usize,
    before_end: usize,
    after_start: usize,
    after_end: usize,
    out: &mut Vec<Alignment>,
) {
    // Trim the matching head and tail first: most edits touch the middle, and
    // this makes the anchor search work on a much smaller window.
    let (mut b0, mut a0) = (before_start, after_start);
    while b0 < before_end && a0 < after_end && before[b0] == after[a0] {
        out.push(Alignment::Matched { before: b0, after: a0 });
        b0 += 1;
        a0 += 1;
    }
    let (mut b1, mut a1) = (before_end, after_end);
    let mut tail = Vec::new();
    while b1 > b0 && a1 > a0 && before[b1 - 1] == after[a1 - 1] {
        b1 -= 1;
        a1 -= 1;
        tail.push(Alignment::Matched { before: b1, after: a1 });
    }

    if b0 == b1 || a0 == a1 {
        // One side is empty, so everything left on the other is an insertion
        // or a deletion.
        out.extend((b0..b1).map(Alignment::Removed));
        out.extend((a0..a1).map(Alignment::Added));
    } else {
        match longest_common_anchors(&before[b0..b1], &after[a0..a1]) {
            // No unique row in common: nothing can be aligned with confidence,
            // so the whole window is a replacement.
            anchors if anchors.is_empty() => {
                out.extend((b0..b1).map(Alignment::Removed));
                out.extend((a0..a1).map(Alignment::Added));
            }
            anchors => {
                let (mut b, mut a) = (b0, a0);
                for (anchor_before, anchor_after) in anchors {
                    let (anchor_before, anchor_after) = (b0 + anchor_before, a0 + anchor_after);
                    align_range(before, after, b, anchor_before, a, anchor_after, out);
                    out.push(Alignment::Matched { before: anchor_before, after: anchor_after });
                    b = anchor_before + 1;
                    a = anchor_after + 1;
                }
                align_range(before, after, b, b1, a, a1, out);
            }
        }
    }
    out.extend(tail.into_iter().rev());
}

/// The longest increasing sequence of rows that occur exactly once on each
/// side, as `(before index, after index)` pairs.
fn longest_common_anchors<K: Eq + std::hash::Hash + Clone>(
    before: &[K],
    after: &[K],
) -> Vec<(usize, usize)> {
    let mut counts: HashMap<&K, (usize, usize, usize, usize)> = HashMap::new();
    for (i, key) in before.iter().enumerate() {
        let entry = counts.entry(key).or_insert((0, 0, 0, 0));
        entry.0 += 1;
        entry.1 = i;
    }
    for (i, key) in after.iter().enumerate() {
        let entry = counts.entry(key).or_insert((0, 0, 0, 0));
        entry.2 += 1;
        entry.3 = i;
    }

    // Candidates in `after` order, so the longest increasing subsequence over
    // their `before` indices is the alignment we want.
    let mut candidates: Vec<(usize, usize)> = counts
        .values()
        .filter(|(before_count, _, after_count, _)| *before_count == 1 && *after_count == 1)
        .map(|(_, before_index, _, after_index)| (*after_index, *before_index))
        .collect();
    candidates.sort_unstable();

    longest_increasing(&candidates)
}

/// The longest increasing subsequence by the second element, returned as
/// `(before, after)` pairs in order.
fn longest_increasing(candidates: &[(usize, usize)]) -> Vec<(usize, usize)> {
    if candidates.is_empty() {
        return Vec::new();
    }
    // Patience sorting: `tails[k]` is the index of the candidate ending the
    // best increasing run of length k+1 found so far.
    let mut tails: Vec<usize> = Vec::new();
    let mut previous = vec![usize::MAX; candidates.len()];
    for (i, &(_, before_index)) in candidates.iter().enumerate() {
        let position = tails.partition_point(|&t| candidates[t].1 < before_index);
        if position > 0 {
            previous[i] = tails[position - 1];
        }
        if position == tails.len() {
            tails.push(i);
        } else {
            tails[position] = i;
        }
    }

    let mut chain = Vec::with_capacity(tails.len());
    let mut cursor = *tails.last().expect("candidates were not empty");
    while cursor != usize::MAX {
        let (after_index, before_index) = candidates[cursor];
        chain.push((before_index, after_index));
        cursor = previous[cursor];
    }
    chain.reverse();
    chain
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(text: &str) -> Vec<char> {
        text.chars().collect()
    }

    /// Renders an alignment compactly: `=` matched, `-` removed, `+` added.
    fn render(before: &str, after: &str) -> String {
        align(&keys(before), &keys(after))
            .into_iter()
            .map(|a| match a {
                Alignment::Matched { .. } => '=',
                Alignment::Removed(_) => '-',
                Alignment::Added(_) => '+',
            })
            .collect()
    }

    #[test]
    fn identical_sequences_align_completely() {
        assert_eq!(render("abcde", "abcde"), "=====");
    }

    #[test]
    fn an_insertion_in_the_middle_is_one_addition() {
        // This is the case a naive index-by-index comparison gets wrong: it
        // would report every row after the insertion as changed.
        assert_eq!(render("abcd", "abXcd"), "==+==");
    }

    #[test]
    fn a_deletion_in_the_middle_is_one_removal() {
        assert_eq!(render("abXcd", "abcd"), "==-==");
    }

    #[test]
    fn an_insertion_at_each_end() {
        assert_eq!(render("abc", "Xabc"), "+===");
        assert_eq!(render("abc", "abcX"), "===+");
    }

    #[test]
    fn an_empty_side() {
        assert_eq!(render("", "abc"), "+++");
        assert_eq!(render("abc", ""), "---");
        assert_eq!(render("", ""), "");
    }

    #[test]
    fn a_wholesale_replacement_matches_nothing() {
        assert_eq!(render("abc", "xyz"), "---+++");
    }

    #[test]
    fn matched_pairs_carry_the_indices_on_both_sides() {
        let aligned = align(&keys("ac"), &keys("abc"));
        assert_eq!(
            aligned,
            vec![
                Alignment::Matched { before: 0, after: 0 },
                Alignment::Added(1),
                Alignment::Matched { before: 1, after: 2 },
            ]
        );
    }

    #[test]
    fn repeated_rows_do_not_confuse_the_anchors() {
        // Only `x` and `y` are unique, so they anchor the alignment and the
        // runs of `a` around them fall into place.
        let before = keys("aaaxaaa");
        let after = keys("aaayaaa");
        let aligned = align(&before, &after);
        let removed = aligned.iter().filter(|a| matches!(a, Alignment::Removed(_))).count();
        let added = aligned.iter().filter(|a| matches!(a, Alignment::Added(_))).count();
        assert_eq!((removed, added), (1, 1));
    }

    #[test]
    fn a_moved_block_is_reported_as_a_removal_and_an_addition() {
        // Alignment does not claim to detect moves; it just refuses to smear
        // the change across everything after it.
        let aligned = align(&keys("abcdef"), &keys("defabc"));
        let matched = aligned.iter().filter(|a| matches!(a, Alignment::Matched { .. })).count();
        assert_eq!(matched, 3);
    }

    #[test]
    fn every_index_appears_exactly_once() {
        let (before, after) = (keys("abcXdefY"), keys("abcdZefY"));
        let aligned = align(&before, &after);
        let mut before_seen: Vec<usize> = aligned
            .iter()
            .filter_map(|a| match a {
                Alignment::Matched { before, .. } => Some(*before),
                Alignment::Removed(i) => Some(*i),
                Alignment::Added(_) => None,
            })
            .collect();
        before_seen.sort_unstable();
        assert_eq!(before_seen, (0..before.len()).collect::<Vec<_>>());

        let mut after_seen: Vec<usize> = aligned
            .iter()
            .filter_map(|a| match a {
                Alignment::Matched { after, .. } => Some(*after),
                Alignment::Added(i) => Some(*i),
                Alignment::Removed(_) => None,
            })
            .collect();
        after_seen.sort_unstable();
        assert_eq!(after_seen, (0..after.len()).collect::<Vec<_>>());
    }

    #[test]
    fn a_long_sequence_aligns_quickly() {
        // Ten thousand rows with one inserted in the middle.
        let before: Vec<usize> = (0..10_000).collect();
        let mut after = before.clone();
        after.insert(5_000, 999_999);
        let aligned = align(&before, &after);
        assert_eq!(aligned.iter().filter(|a| matches!(a, Alignment::Added(_))).count(), 1);
        assert_eq!(aligned.iter().filter(|a| matches!(a, Alignment::Removed(_))).count(), 0);
    }
}
