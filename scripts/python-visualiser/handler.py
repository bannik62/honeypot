#!/usr/bin/env python3
"""
handler.py
Rôle: centraliser le dispatch HTTP (do_GET/do_POST) vers les modules routes/*.
"""

from http.server import SimpleHTTPRequestHandler

from config import DATA_JSON_URL, IP_PREFIX, VISUALIZER_DIR
from routes.dashboard import serve_dashboard_regenerate
from routes.ip import serve_ip_resource
from routes.static import serve_data_json, serve_debug
from routes.vulners import serve_vulners_events, serve_vulners_lookup, serve_vulners_status


class VisualizerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(VISUALIZER_DIR), **kwargs)

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path == "/api/vulners/status":
            serve_vulners_status(self)
            return
        if path == "/api/vulners/events":
            serve_vulners_events(self)
            return
        if path == "/":
            self.path = "/honeypot-dashboard.html"
            return super().do_GET()
        if path == DATA_JSON_URL:
            serve_data_json(self)
            return
        if path == "/data/visualizer-dashboard/debug" or path == "/data/screenshotAndLog/debug":
            serve_debug(self)
            return
        if path.startswith(IP_PREFIX):
            serve_ip_resource(self, path[len(IP_PREFIX):].strip("/"))
            return
        if path.startswith("/visualizer/"):
            self.path = path.replace("/visualizer", "", 1) or "/honeypot-dashboard.html"
            return super().do_GET()
        if path.startswith("/"):
            self.path = path
            return super().do_GET()
        self.send_error(404)

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path == "/api/vulners/lookup":
            serve_vulners_lookup(self)
            return
        if path == "/api/dashboard/regenerate":
            serve_dashboard_regenerate(self)
            return
        self.send_error(404)

    def log_message(self, format, *args):
        pass  # silencieux
