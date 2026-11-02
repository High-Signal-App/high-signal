"""Parse test HTML with the standard HTML5 character-reference decoder."""

import json
import re
import sys
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


class ContractParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.main = None
        self.stack = []
        self.title = ""
        self.in_title = False
        self.in_script = False
        self.script_text = ""
        self.unsafe_scripts = []
        self.meta = {}
        self.canonical = None

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if tag == "title":
            self.in_title = True
        if tag == "script":
            self.in_script = True
            self.script_text = ""
        if tag == "meta":
            self.meta[attrs.get("name") or attrs.get("property")] = attrs.get("content")
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonical = attrs.get("href")
        if tag == "main" or self.stack:
            kept = {key: value for key, value in attrs.items() if not key.startswith("data-record-")}
            # React replaces javascript hrefs with a throwing URL; the native reader removes them.
            if (kept.get("href") or "").lower().startswith("javascript:"):
                kept.pop("href")
            node = {"tag": tag, "attrs": sorted(kept.items()), "children": []}
            if self.stack:
                self.stack[-1]["children"].append(node)
            else:
                self.main = node
            if tag not in VOID:
                self.stack.append(node)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag == "script":
            if "alert(1)" in self.script_text:
                self.unsafe_scripts.append(self.script_text)
            self.in_script = False
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                break

    def handle_data(self, text):
        if self.in_title:
            self.title += text
        if self.in_script:
            self.script_text += text
        if self.stack:
            children = self.stack[-1]["children"]
            if children and isinstance(children[-1], str):
                children[-1] += text
            else:
                children.append(text)


def normalize(node, pre=False):
    if node is None:
        return None
    pre = pre or node["tag"] == "pre"
    children = []
    for child in node["children"]:
        if isinstance(child, str):
            value = child if pre else re.sub(r"\s+", " ", child).strip()
            if value:
                children.append(value)
        else:
            children.append(normalize(child, pre))
    return {**node, "children": children}


def inspect(source):
    parser = ContractParser()
    parser.feed(source)
    parser.close()
    return {"main": normalize(parser.main), "title": parser.title, "meta": parser.meta,
            "canonical": parser.canonical, "unsafeScripts": parser.unsafe_scripts}


print(json.dumps([inspect(source) for source in json.load(sys.stdin)]))
