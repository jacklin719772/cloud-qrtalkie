from pathlib import Path

text = Path('src/Plans.jsx').read_text(encoding='utf-8')
stack = []
quote_char = None
escape = False
for idx, ch in enumerate(text):
    if quote_char:
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == quote_char:
            quote_char = None
        continue
    if ch in ('"', "'"):
        quote_char = ch
        continue
    if ch in '({[':
        stack.append((ch, idx))
    elif ch in ')}]':
        if not stack:
            print('unmatched close', ch, 'at', idx)
            break
        o, oi = stack.pop()
        if {'(': ')', '{': '}', '[': ']'}[o] != ch:
            print('mismatch', o, ch, 'opened at', oi, 'closed at', idx)
            break
else:
    if stack:
        o, oi = stack[-1]
        print('unmatched open', o, 'at', oi)
    else:
        print('balanced')
