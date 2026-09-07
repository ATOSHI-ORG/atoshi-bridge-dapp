"""找出组件里没走 i18n 的中文文案。

只报会显示给用户的：JSX 文本节点、字符串字面量、模板串。
排除注释（注释里的中文是给我们自己看的）和 i18n.tsx 本身。
"""
import re, pathlib, sys

CJK = re.compile(r'[一-鿿]')
root = pathlib.Path("src")

def strip_comments(text):
    """把注释替换成等长空白，保持行号不变。"""
    out = []
    i = 0
    n = len(text)
    while i < n:
        two = text[i:i+2]
        if two == "//":
            j = text.find("\n", i)
            j = n if j == -1 else j
            out.append(" " * (j - i)); i = j
        elif two == "/*":
            j = text.find("*/", i + 2)
            j = n if j == -1 else j + 2
            seg = text[i:j]
            out.append("".join(c if c == "\n" else " " for c in seg)); i = j
        elif text[i] in "'\"`":
            q = text[i]; j = i + 1
            while j < n:
                if text[j] == "\\": j += 2; continue
                if text[j] == q: j += 1; break
                j += 1
            out.append(text[i:j]); i = j
        else:
            out.append(text[i]); i += 1
    return "".join(out)

# 这些不算问题：
#   i18n.tsx        字典本身
#   bridgeApiMock   只在显式开启的演示模式下用，且文案里带具体金额
#   语言切换按钮     「中文」这个标签本来就该一直是中文
SKIP_FILES = {"i18n.tsx", "bridgeApiMock.ts"}

hits = []
for f in sorted(root.rglob("*.tsx")) + sorted(root.rglob("*.ts")):
    if f.name in SKIP_FILES:
        continue
    raw = f.read_text(encoding="utf-8")
    code = strip_comments(raw)
    lines = code.splitlines()
    raw_lines = raw.splitlines()
    for lineno, line in enumerate(lines, 1):
        if not CJK.search(line):
            continue
        orig = raw_lines[lineno - 1]

        # 已经是双语分支的不算：lang === 'zh' ? 中文 : English
        # 三元式常跨行，所以往前看两行。
        window = " ".join(lines[max(0, lineno - 3):lineno + 1])
        if "lang === 'zh'" in window or 'lang === "zh"' in window:
            continue
        # 语言切换器的按钮标签
        if orig.strip() in ("中文", "{'中文'}", "中文</button>"):
            continue

        hits.append((str(f), lineno, orig.strip()[:150]))

by_file = {}
for f, ln, txt in hits:
    by_file.setdefault(f, []).append((ln, txt))

print(f"没走 i18n 的中文：{len(hits)} 处，分布在 {len(by_file)} 个文件\n")
for f in sorted(by_file):
    print(f"[{f}]")
    for ln, txt in by_file[f]:
        print(f"  {ln:4}  {txt}")
    print()
sys.exit(1 if hits else 0)
