# Verification

Use this reference after writing or diagnosing Chinese content.

## Core Principle

Always separate these two questions:

1. Is the terminal displaying Chinese incorrectly?
2. Is the file content itself actually corrupted?

## Reliable Verification Steps

- Read the file explicitly as `UTF-8`.
- Inspect key lines using `unicode_escape` or an equivalent escaped representation.
- Confirm the target Chinese sentence appears as valid Unicode escapes rather than broken byte fragments.
- Optionally inspect the raw bytes if corruption is still unclear.

## Good Signals

- The file can be read as UTF-8 without decode errors.
- Escaped output corresponds to the intended Chinese characters.
- The same content stays stable across repeated read/write cycles.

## Bad Signals

- UTF-8 decode fails.
- Escaped output shows obviously broken byte fragments or truncated sequences.
- The terminal and the escaped verification disagree after a write.

## Decision Rule

If escaped verification is correct but the terminal looks wrong, treat it as a display problem first.
If escaped verification is wrong, treat it as a file write or conversion problem.
