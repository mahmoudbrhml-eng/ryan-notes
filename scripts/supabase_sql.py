#!/usr/bin/env python3
"""Run SQL against the Supabase Management API (project hieqmpdvpfrxmcelphlw).

Usage: python3 supabase_sql.py "SELECT 1"
Tokens are read from /home/z/my-project/scripts/.env-tokens (export SB=...).
"""
import json
import os
import sys
import urllib.request

URL = "https://api.supabase.com/v1/projects/hieqmpdvpfrxmcelphlw/database/query"
TOKEN_FILE = "/home/z/my-project/scripts/.env-tokens"


def load_token():
    tok = os.environ.get("SB")
    if tok:
        return tok
    with open(TOKEN_FILE) as f:
        for line in f:
            line = line.strip()
            if line.startswith("export "):
                line = line[len("export "):]
            k, _, v = line.partition("=")
            if k == "SB":
                return v.strip().strip("'\"")
    raise SystemExit("no SB token")


def run(sql: str):
    data = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        URL, data=data, method="POST",
        headers={"Authorization": f"Bearer {load_token()}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read().decode()
    return json.loads(body) if body else []


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: supabase_sql.py '<sql>'   (or pass -f <file> / pipe SQL on stdin)")
    if sys.argv[1] == "-f":
        with open(sys.argv[2]) as fh:
            sql = fh.read()
    elif sys.argv[1] == "-":
        sql = sys.stdin.read()
    else:
        sql = sys.argv[1]
    try:
        out = run(sql)
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:2000])
        sys.exit(1)
    print(json.dumps(out, ensure_ascii=False, indent=1))
