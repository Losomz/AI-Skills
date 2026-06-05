# Safe Patterns

Use these patterns when editing Chinese comments, strings, or Markdown.

## Pattern 1: Explicit UTF-8 Read/Write

```python
from pathlib import Path

path = Path('example.ts')
text = path.read_text(encoding='utf-8')
text = text.replace('old', '新的中文内容')
path.write_text(text, encoding='utf-8')
```

Use when Chinese content can be safely constructed inside the script.

## Pattern 2: ASCII-Safe Intermediate Transport

```python
def u(s: str) -> str:
    return s.encode('ascii').decode('unicode_escape')

comment = u(r"// \u8fd9\u662f\u4e2d\u6587\u6ce8\u91ca")
```

Use when Chinese text would otherwise need to cross unstable shell boundaries.

## Pattern 3: Whole-Content Assembly Before Write

```python
lines = [
    "import x from 'y';",
    "",
    "// 中文注释",
    "const value = 1;",
]
text = "\n".join(lines) + "\n"
```

Use when you want to reduce mid-stream conversions and write the file once.

## Pattern 4: Encoding-Level Verification

```python
from pathlib import Path

text = Path('example.ts').read_text(encoding='utf-8')
line = text.splitlines()[10]
print(line.encode('unicode_escape').decode('ascii'))
```

Use this to verify file content without trusting terminal-rendered Chinese.

## What To Avoid

- Passing large raw Chinese blocks through PowerShell heredoc without safeguards.
- Repeated `encode/decode` chains unless the transformation is deliberate and understood.
- Using terminal display alone as the success criterion.
