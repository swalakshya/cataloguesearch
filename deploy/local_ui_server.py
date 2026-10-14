"""Serve the explicitly built application UI without a live Vite watcher."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    parser.add_argument('--port', type=int, default=3000)
    args = parser.parse_args()
    directory = Path(args.directory)
    if not (directory / 'index.html').is_file():
        parser.error('Build the application UI before serving it')

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(directory), **kw)

        def do_GET(self):
            path = urlsplit(self.path).path
            # App routes (e.g. /chat) fall back to the SPA. Missing assets do not.
            target = Path(self.translate_path(path))
            if not target.exists() and not Path(path).suffix:
                self.path = '/index.html'
            super().do_GET()

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
