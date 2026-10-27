# -*- coding: utf-8 -*-
"""
从 Obsidian 知识库生成网站数据：data/notes.js 和 data/exams.js

用法：
    python tools/build_data.py [知识库路径]

默认知识库路径：F:\\Obsidian_vault\\Train_dispatch\\Train_dispatch

只收录 20-Concepts（概念）、10-Sources（资料）和 MOC/术语表。
不收录：PDF 附件、首页、问题清单、岗位要求对照、公司与产品、日记、模板。
"""
import json
import os
import re
import sys
from urllib.parse import quote

VAULT = sys.argv[1] if len(sys.argv) > 1 else r"F:\Obsidian_vault\Train_dispatch\Train_dispatch"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")

EXAMS = {
    "w1": "30-Practice/第1周测验.md",
    "w2": "30-Practice/第2周 阶段考一 运输组织基础.md",
    "w3": "30-Practice/第3周测验.md",
    "w4": "30-Practice/第4周 阶段考二 调度指挥.md",
    "w5": "30-Practice/第5周测验.md",
    "w6": "30-Practice/第6周 结业考.md",
}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read().replace("\r\n", "\n")


def split_frontmatter(text):
    meta = {}
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            for line in text[4:end].split("\n"):
                m = re.match(r"^(\w+):\s*(.*)$", line)
                if m:
                    meta[m.group(1)] = m.group(2).strip()
            text = text[end + 4:].lstrip("\n")
    return meta, text


def parse_list(value):
    value = (value or "").strip()
    if value.startswith("[") and value.endswith("]"):
        return [v.strip().strip('"') for v in value[1:-1].split(",") if v.strip()]
    return []


def collect_notes():
    notes = {}
    for folder, kind in (("20-Concepts", "概念"), ("10-Sources", "资料")):
        base = os.path.join(VAULT, folder)
        for root, _, files in os.walk(base):
            for fn in files:
                if fn.endswith(".md"):
                    notes[fn[:-3]] = (os.path.join(root, fn), kind)
    notes["术语表"] = (os.path.join(VAULT, "MOC", "术语表.md"), "索引")
    return notes


def convert_links(md, names):
    # 嵌入（原文 PDF）删掉
    md = re.sub(r"!\[\[[^\]]+\]\]", "（原文 PDF 只在本地知识库）", md)

    def repl(m):
        inner = m.group(1).replace("\\|", "|")
        if "|" in inner:
            target, alias = inner.split("|", 1)
        else:
            target, alias = inner, None
        name = target.split("#")[0].strip()
        label = (alias or name).strip()
        if name.lower().endswith(".pdf"):
            return alias.strip() if alias else "原书"
        if name in names:
            return "[%s](#/note/%s)" % (label, quote(name, safe=""))
        return label

    return re.sub(r"\[\[([^\]]+?)\]\]", repl, md)


def build_notes():
    notes = collect_notes()
    names = set(notes)
    data = {}
    for name, (path, kind) in sorted(notes.items()):
        meta, body = split_frontmatter(read(path))
        data[name] = {
            "kind": kind,
            "aliases": parse_list(meta.get("aliases")),
            "status": meta.get("status", ""),
            "md": convert_links(body, names),
        }
    return data, names


def parse_exam(path, names):
    meta, body = split_frontmatter(read(path))
    lines = body.split("\n")
    title = ""
    duration = ""
    questions = []
    section = ""
    default_pts = 0
    bonus = False
    q = None
    mode = None  # body / answer

    def finish():
        if q:
            q["body"] = convert_links("\n".join(q.pop("_body")).strip(), names)
            q["answer"] = convert_links("\n".join(q.pop("_ans")).strip(), names)
            questions.append(q)

    for line in lines:
        if line.startswith("# ") and not title:
            title = line[2:].strip()
            continue
        m = re.search(r"时长\*?\*?\s*(\d+)\s*分钟", line)
        if m and not duration:
            duration = m.group(1)
        if line.startswith("## "):
            finish()
            q = None
            mode = None
            section = line[3:].strip()
            m = re.search(r"每题\s*(\d+)\s*分", section)
            default_pts = int(m.group(1)) if m else 0
            bonus = "附加题" in section
            continue
        if section.startswith("成绩"):
            continue
        if line.startswith("### "):
            finish()
            heading = line[4:].strip()
            m = re.search(r"(\d+)\s*分", heading)
            pts = 0 if bonus else (int(m.group(1)) if m else default_pts)
            label = re.match(r"^([^（.]+)", heading).group(1).strip(". ")
            kind = re.search(r"（([^，）]+)", heading)
            q = {
                "id": label,
                "heading": heading,
                "kind": kind.group(1) if kind else "",
                "section": section,
                "points": pts,
                "bonus": bonus,
                "_body": [],
                "_ans": [],
            }
            mode = "body"
            continue
        if q is None:
            continue
        if line.strip().startswith("**作答"):
            mode = "answer"
            continue
        if mode == "body":
            if line.strip() == "---":
                continue
            q["_body"].append(line)
        elif mode == "answer":
            if line.startswith(">"):
                text = line[1:]
                if text.startswith(" "):
                    text = text[1:]
                if re.match(r"^\[!success\]", text):
                    continue
                q["_ans"].append(text)
            elif line.strip() == "" and not q["_ans"]:
                continue
            elif line.strip() == "---" or line.strip() == "":
                mode = "done"
    finish()
    return {
        "title": title,
        "topic": meta.get("topic", ""),
        "date": meta.get("exam_date", ""),
        "duration": duration,
        "questions": questions,
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    notes, names = build_notes()
    with open(os.path.join(OUT, "notes.js"), "w", encoding="utf-8") as f:
        f.write("// 由 tools/build_data.py 从 Obsidian 知识库生成，请勿手动修改\n")
        f.write("window.NOTES = " + json.dumps(notes, ensure_ascii=False) + ";\n")
    exams = {}
    for key, rel in EXAMS.items():
        exams[key] = parse_exam(os.path.join(VAULT, rel), names)
    with open(os.path.join(OUT, "exams.js"), "w", encoding="utf-8") as f:
        f.write("// 由 tools/build_data.py 从 Obsidian 知识库生成，请勿手动修改\n")
        f.write("window.EXAMS = " + json.dumps(exams, ensure_ascii=False) + ";\n")
    print("notes:", len(notes))
    for key, ex in exams.items():
        total = sum(q["points"] for q in ex["questions"] if not q["bonus"])
        bonus = sum(1 for q in ex["questions"] if q["bonus"])
        print(key, ex["title"], "questions:", len(ex["questions"]), "total:", total, "bonus:", bonus)


if __name__ == "__main__":
    main()
