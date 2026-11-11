#!/usr/bin/env python3
"""Web control panel for the Roland QUAD-CAPTURE.

A small HTTP server that serves the static panel and forwards requests to the
qcctl daemon over its Unix socket.  Standard library only.
"""

import argparse
import json
import os
import socket
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

SOCKET_PATH = "/run/qcctl.sock"
STATIC_CANDIDATES = (
    Path("/usr/share/qc-web"),
    Path(__file__).resolve().parent / "static",
)
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json",
}


def static_dir():
    for candidate in STATIC_CANDIDATES:
        if (candidate / "index.html").is_file():
            return candidate
    raise SystemExit("qc-web: static files not found")


def rpc(req, timeout=2.0):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(SOCKET_PATH)
        sock.sendall((json.dumps(req) + "\n").encode())
        line = sock.makefile("rb").readline()
    finally:
        sock.close()
    if not line:
        raise OSError("empty reply from qcctl")
    return json.loads(line)


class Handler(BaseHTTPRequestHandler):
    server_version = "qc-web/1.0"

    def log_message(self, fmt, *args):
        if os.environ.get("QC_WEB_VERBOSE"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- helpers ------------------------------------------------------
    def send_json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_index(self):
        path = static_dir() / "index.html"
        try:
            html = path.read_text(encoding="utf-8")
        except OSError:
            return self.send_error(HTTPStatus.NOT_FOUND)
        try:
            status = rpc({"cmd": "status"}, timeout=1.5)
            extra = {}
            for name, addr in (("digital_in", "00 02 00 04"),
                               ("autosens_mode", "00 02 01 00"),
                               ("meter", "00 0a 00 00")):
                try:
                    r = rpc({"cmd": "read", "addr": addr, "size": 1},
                            timeout=0.8)
                    extra[name] = int(r["data"].split()[0], 16)
                except Exception:
                    pass
            if extra:
                status["extra"] = extra
            initial = json.dumps(status)
        except Exception:
            initial = "null"
        html = html.replace("null;/*QC_INITIAL*/",
                            initial + ";/*QC_INITIAL*/", 1)
        body = html.encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        try:
            data = path.read_bytes()
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type",
                         MIME.get(path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 65536:
            return {}
        return json.loads(self.rfile.read(length).decode() or "{}")

    def daemon(self, req, timeout=2.0):
        try:
            return self.send_json(rpc(req, timeout))
        except (FileNotFoundError, ConnectionRefusedError):
            self.send_json({"error": "qc-daemon is not running"},
                           HTTPStatus.SERVICE_UNAVAILABLE)
        except (OSError, ValueError) as exc:
            self.send_json({"error": str(exc)},
                           HTTPStatus.BAD_GATEWAY)

    # -- routes -------------------------------------------------------
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/status":
            return self.daemon({"cmd": "status"})
        if url.path == "/api/params":
            return self.daemon({"cmd": "params"})
        if url.path == "/api/read":
            query = parse_qs(url.query)
            addr = (query.get("addr") or [""])[0]
            size = int((query.get("size") or ["1"])[0])
            if not addr:
                return self.send_json({"error": "addr required"},
                                      HTTPStatus.BAD_REQUEST)
            return self.daemon({"cmd": "read", "addr": addr, "size": size})
        if url.path in ("/", "/index.html"):
            return self.send_index()
        rel = url.path.lstrip("/")
        if not rel or ".." in Path(rel).parts:
            return self.send_error(HTTPStatus.NOT_FOUND)
        return self.send_file(static_dir() / rel)

    def do_POST(self):
        url = urlparse(self.path)
        try:
            body = self.read_body()
        except (ValueError, UnicodeDecodeError):
            return self.send_json({"error": "invalid JSON"},
                                  HTTPStatus.BAD_REQUEST)
        if url.path == "/api/param":
            return self.daemon({"cmd": "param",
                                "name": body.get("name"),
                                "value": body.get("value")})
        if url.path == "/api/raw":
            return self.daemon({"cmd": "set",
                                "addr": body.get("addr"),
                                "data": body.get("data")})
        if url.path == "/api/rate":
            return self.daemon({"cmd": "rate",
                                "value": body.get("value")}, timeout=12.0)
        if url.path == "/api/meter":
            return self.daemon({"cmd": "param", "name": "meter",
                                "value": body.get("value")})
        self.send_json({"error": "unknown endpoint"}, HTTPStatus.NOT_FOUND)


def main():
    ap = argparse.ArgumentParser(prog="qc-web")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"qc-web: http://{args.host}:{args.port}/", file=sys.stderr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
