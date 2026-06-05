---
name: chinese-encoding
description: Stabilize Chinese text handling on Windows PowerShell and CLI workflows. Use when editing Chinese comments, Chinese strings, Markdown docs, or diagnosing garbled text and encoding problems. Distinguishes terminal display issues from actual file corruption and prescribes UTF-8-safe read/write, ASCII-safe transfer, and verification steps.
---

# Chinese Encoding

Use this skill when the task involves Chinese comments, Chinese strings, Chinese Markdown, or any garbled-text diagnosis in a Windows PowerShell + CLI environment.

## Goals

- Keep Chinese text files stable in PowerShell-driven workflows.
- Distinguish terminal display problems from actual file corruption.
- Standardize UTF-8 read/write, safe transfer, and verification.

## Default Rules

- Default all Chinese-containing text files to `UTF-8`.
- Do not trust terminal-rendered Chinese as the only signal.
- If Chinese must cross shell boundaries, prefer ASCII-safe transfer such as `\uXXXX`.
- After writing, verify file content at the encoding level before concluding success.

## Workflow

1. Decide whether the issue is display-only or the file is actually corrupted.
2. Read and write the file explicitly with `UTF-8`.
3. If the command path includes PowerShell heredoc, inline multiline script, or direct shell-passed Chinese, switch to an ASCII-safe transfer pattern.
4. Validate by reading the file back and checking escaped Unicode output or equivalent byte-safe evidence.
5. Use normal text viewing only as a secondary confirmation.

## When To Read References

- Read `references/windows-powershell.md` when the task runs through PowerShell or Windows terminal tooling.
- Read `references/verification.md` when you need to distinguish display乱码 from actual file corruption.
- Read `references/safe-patterns.md` when you need concrete, repeatable write/verify patterns.

## Guardrails

- Do not assume terminal乱码 means the file is broken.
- Do not mix unspecified local encodings with UTF-8 reads and writes.
- Do not pass large Chinese blocks through unstable shell boundaries if an ASCII-safe or in-script construction path is available.
- Do not rely on a single visual check; always verify the file content after write.
