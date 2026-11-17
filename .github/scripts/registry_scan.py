#!/usr/bin/env python3
"""Pre-publish check for the Comfy Registry.

The Registry scans every uploaded version and flags it when a rule matches, which
hides the version from ComfyUI Manager. Its rules match on the text of the code, in
any file type, so harmless JavaScript can trip a rule written for Python (0.2.0 and
0.3.0 were flagged because LiteGraph's node.connect() looked like a socket call).

This script looks through the files that would be uploaded for the patterns those
rules are known to match, and for what the Registry standards forbid (eval/exec,
installing packages at run time, obfuscated code). The Registry's rule list is not
public, so a clean result here is not a guarantee; it catches the known cases.

Usage: python3 .github/scripts/registry_scan.py [path ...]
With no paths it checks every tracked file that .comfyignore does not exclude.
A line can be exempted with a trailing comment containing "registry-scan: allow",
but the Registry will still see that line, so prefer rewording it.
Exit status is 1 when anything is found.
"""
import fnmatch
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CODE_SUFFIXES = {".py", ".js", ".mjs", ".cjs", ".ts", ".json", ".html", ".sh", ".bat", ".ps1", ".toml", ".yaml", ".yml"}
ALLOW = "registry-scan: allow"

# (rule the Registry reports or the standard it comes from, what it means, pattern)
RULES = [
    # python_network_operations: sockets and HTTP clients. Matched in any file type.
    ("network", "socket-style call (the Registry reads .connect( as a network socket)", r"\.connect\s*\("),
    ("network", "socket-style call", r"\.(?:sendall|sendto|recvfrom|recv)\s*\("),
    ("network", "socket module", r"\bsocket\.(?:socket|create_connection|gethostbyname)\b|\bimport\s+socket\b"),
    ("network", "Python HTTP client", r"\b(?:urllib\.request|urllib2|urlopen|http\.client|httpx|aiohttp|ftplib|smtplib|paramiko|telnetlib)\b"),
    ("network", "Python HTTP client", r"\brequests\.(?:get|post|put|patch|delete|head|request|Session)\b|\bimport\s+requests\b"),
    ("network", "browser network request", r"\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bEventSource\s*\(|\bsendBeacon\s*\("),
    # Registry standards: no eval/exec, no run-time installs.
    ("code-execution", "eval or exec", r"(?<![\w.])(?:eval|exec)\s*\("),
    ("code-execution", "code built from a string", r"\bnew\s+Function\s*\(|\bsetTimeout\s*\(\s*['\"`]|\bsetInterval\s*\(\s*['\"`]"),
    ("code-execution", "dynamic import or compile", r"\b__import__\s*\(|\bimportlib\.import_module\b|(?<![\w.])compile\s*\("),
    ("code-execution", "running other programs", r"\bsubprocess\b|\bos\.(?:system|popen|exec[lv]p?e?|spawn\w*)\b|\bchild_process\b"),
    ("code-execution", "installing packages at run time", r"\bpip\s+install\b|\bpip\.main\b"),
    ("code-execution", "unsafe deserialization", r"\b(?:pickle|cPickle|marshal|dill)\.loads?\b|\byaml\.load\s*\("),
    # Obfuscation.
    ("obfuscation", "decoding hidden text", r"\bbase64\.(?:b64decode|b32decode|decodebytes)\b|\batob\s*\(|\bString\.fromCharCode\b|\bcodecs\.decode\b|\bbytes\.fromhex\b|\bunescape\s*\("),
    ("obfuscation", "long encoded string", r"['\"`][A-Za-z0-9+/=]{200,}['\"`]|(?:\\x[0-9a-fA-F]{2}){16,}"),
    # python_environment_manipulation.
    ("environment", "reading or changing environment variables", r"\bos\.(?:environ|getenv|putenv)\b|\bprocess\.env\b"),
    # contains_blacklisted_url, and other places data could be sent to.
    ("url", "host the Registry treats as suspicious", r"https?://(?:raw\.githubusercontent\.com|gist\.githubusercontent\.com|pastebin\.com|hastebin\.com|transfer\.sh|bit\.ly|tinyurl\.com|[\w.-]*ngrok[\w.-]*|discord(?:app)?\.com/api/webhooks|api\.telegram\.org|[\w.-]+\.onion)"),
    ("url", "URL with a bare IP address", r"https?://\d{1,3}(?:\.\d{1,3}){3}"),
    # Things a browser extension has no reason to touch here.
    ("data-access", "cookies or stored credentials", r"\bdocument\.cookie\b|\bkeyring\b"),
]
COMPILED = [(name, why, re.compile(rx)) for name, why, rx in RULES]


def ignored_patterns():
    f = ROOT / ".comfyignore"
    if not f.exists():
        return []
    return [line.strip() for line in f.read_text().splitlines() if line.strip() and not line.startswith("#")]


def is_ignored(rel, patterns):
    for p in patterns:
        if p.endswith("/"):
            if rel.startswith(p) or ("/" + p) in ("/" + rel):
                return True
        elif fnmatch.fnmatch(rel, p) or fnmatch.fnmatch(Path(rel).name, p):
            return True
    return False


def shipped_files():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout  # registry-scan: allow
    patterns = ignored_patterns()
    return [ROOT / rel for rel in out.splitlines() if rel and not is_ignored(rel, patterns)]


def scan(path):
    findings = []
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return findings
    for no, line in enumerate(text.splitlines(), 1):
        if ALLOW in line:
            continue
        for name, why, rx in COMPILED:
            m = rx.search(line)
            if m:
                findings.append((no, name, why, line.strip()[:160]))
    return findings


def main(argv):
    files = [Path(a).resolve() for a in argv] if argv else shipped_files()
    files = [f for f in files if f.suffix.lower() in CODE_SUFFIXES and f.is_file()]
    total = 0
    for f in files:
        try:
            shown = f.relative_to(ROOT)
        except ValueError:
            shown = f
        for no, name, why, line in scan(f):
            total += 1
            print(f"{shown}:{no}: [{name}] {why}\n    {line}")
            print(f"::error file={shown},line={no}::Registry scan [{name}]: {why}")
    if total:
        print(f"\n{total} finding(s) in {len(files)} file(s). The Registry is likely to flag this version; reword these lines before publishing.")
        return 1
    print(f"Registry scan: {len(files)} file(s) checked, nothing found.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
