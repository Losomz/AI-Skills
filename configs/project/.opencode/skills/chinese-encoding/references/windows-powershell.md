# Windows PowerShell Notes

Use this reference when the task runs through Windows PowerShell, Codex CLI, or inline scripts launched from PowerShell.

## Why Windows Is Risky

- Terminal code page and file encoding are often not the same thing.
- PowerShell display乱码 may happen even when the file itself is still correct.
- Inline heredoc-style content and shell-passed Chinese text are common corruption points.
- A `PowerShell -> Python -> file write -> PowerShell read` chain can mix encodings if not controlled.

## High-Risk Scenarios

- Passing multiline Chinese directly inside PowerShell command strings.
- Using inline scripts that embed large Chinese blocks without a safe transport format.
- Re-reading a file in terminal output and treating the display as the source of truth.
- Applying extra `encode/decode` conversions without a precise reason.

## Recommended Behavior

- Explicitly set `encoding='utf-8'` when reading and writing in Python.
- Prefer building file content inside the script instead of passing raw Chinese through shell boundaries.
- If shell transport is unavoidable, use `\uXXXX` or another ASCII-safe intermediate form.
- Validate the written file via escaped Unicode or byte-oriented inspection.

## Mental Model

Treat PowerShell display, script runtime, and file bytes as three different layers. Verify the file layer, not just the display layer.
