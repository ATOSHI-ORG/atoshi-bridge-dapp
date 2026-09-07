import re, pathlib, json

src = pathlib.Path("src")

# 字典里定义的键：i18n.tsx 里形如  'a.b': '...'  或  "a.b": "..."
dict_text = (src / "i18n.tsx").read_text(encoding="utf-8")
defined = set(re.findall(r"['\"]([a-z0-9_]+\.[a-z0-9_.]+)['\"]\s*:", dict_text))

# 组件里用到的键：t('a.b')  /  t("a.b")
used = {}
for f in sorted(src.rglob("*.tsx")) + sorted(src.rglob("*.ts")):
    if f.name == "i18n.tsx":
        continue
    txt = f.read_text(encoding="utf-8")
    for m in re.finditer(r"\bt\(\s*['\"]([a-z0-9_]+\.[a-z0-9_.]+)['\"]", txt):
        used.setdefault(m.group(1), []).append(f.name)

missing = sorted(k for k in used if k not in defined)
unused = sorted(k for k in defined if k not in used)

print(f"字典里定义: {len(defined)}   组件里使用: {len(used)}")
print(f"\n缺失（会原样显示成 key）: {len(missing)}")
by_file = {}
for k in missing:
    for f in set(used[k]):
        by_file.setdefault(f, []).append(k)
for f in sorted(by_file):
    print(f"\n  [{f}]")
    for k in sorted(by_file[f]):
        print(f"    {k}")
print(f"\n字典里有但没用到: {len(unused)}")
