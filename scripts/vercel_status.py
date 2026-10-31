#!/usr/bin/env python3
"""Print the latest Vercel production deployment status for Ryan Notes.

Usage: python3 vercel_status.py [--wait]
Tokens are read from scripts/.env-tokens (export VC=...).
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(HERE, ".env-tokens")
TEAM = "team_o8kAx4heEKQNsuI1ti1EhpN8"


def load_token():
    tok = os.environ.get("VC")
    if tok:
        return tok
    with open(TOKEN_FILE) as f:
        for line in f:
            line = line.strip()
            if line.startswith("export "):
                line = line[len("export "):]
            k, _, v = line.partition("=")
            if k == "VC":
                return v.strip().strip("'\"")
    raise SystemExit("no VC token")


def api(path: str):
    req = urllib.request.Request(
        f"https://api.vercel.com{path}",
        headers={"Authorization": f"Bearer {load_token()}"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def latest():
    d = api("/v6/deployments?limit=5&target=production&projectId=prj_cDwYcL1BNecbc8TJpqmZ6LeRBD51")
    for dep in d.get("deployments", []):
        return dep
    return None


def main():
    wait = "--wait" in sys.argv
    deadline = time.time() + 600
    while True:
        dep = latest()
        if dep:
            state = dep.get("readyState") or dep.get("state")
            print(f"{dep.get('uid')}  {state}  {dep.get('url')}  sha={str(dep.get('meta', {}).get('githubCommitSha', ''))[:7]}")
            if not wait or state in ("READY", "ERROR", "CANCELED"):
                return 0 if state == "READY" else 1
        if time.time() > deadline:
            print("timed out waiting for deployment")
            return 1
        time.sleep(15)


if __name__ == "__main__":
    sys.exit(main())
