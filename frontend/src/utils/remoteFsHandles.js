// Duck-typed stand-ins for FileSystemDirectoryHandle/FileSystemFileHandle,
// backed by the eval backend's /eval/fs/list, /eval/fs/read and /eval/fs/write
// endpoints instead of the browser's native File System Access API.
//
// Every call site in this codebase (FileBrowser.js, PDFParser.js,
// ParagraphGenEval.js via directoryHandlers.js, etc.) only ever calls
// `.entries()`, `.values()`, `.getDirectoryHandle(name)`, `.getFileHandle(name)`,
// `.getFile()`, `.createWritable()`, `.kind` and `.name` on a handle -- never
// `instanceof FileSystemDirectoryHandle` -- so an object implementing just
// that subset works as a drop-in replacement wherever a real handle is used
// today. This lets "server" filesystem mode reuse all of the existing
// browse/read/write UI unchanged; the only branch point is which kind of
// root handle gets constructed in UIEval.js.
//
// Covers all three roots (pdf/ocr/text) and writing (used by the paragraph
// classifier's save-corrections flow, which overwrites an existing OCR JSON
// page in place -- /eval/fs/write mirrors that: it 404s rather than creating
// new files).

class RemoteFileHandle {
    constructor(apiBaseUrl, root, relativePath, name) {
        this.kind = 'file';
        this.name = name;
        this._apiBaseUrl = apiBaseUrl;
        this._root = root;
        this._relativePath = relativePath;
    }

    async getFile() {
        const qs = new URLSearchParams({ root: this._root, path: this._relativePath });
        const res = await fetch(`${this._apiBaseUrl}/eval/fs/read?${qs.toString()}`);
        if (!res.ok) {
            throw new Error(`Failed to read ${this._relativePath} (HTTP ${res.status})`);
        }
        const blob = await res.blob();
        return new File([blob], this.name, { type: blob.type || 'application/pdf' });
    }

    // Mirrors the subset of FileSystemWritableFileStream that this codebase
    // actually uses: write(content) then close(). Buffers locally and only
    // hits the network on close(), same as the native stream only durably
    // commits on close().
    async createWritable() {
        let pending = null;
        const apiBaseUrl = this._apiBaseUrl;
        const root = this._root;
        const relativePath = this._relativePath;
        return {
            async write(content) {
                pending = content;
            },
            async close() {
                const qs = new URLSearchParams({ root, path: relativePath });
                const res = await fetch(`${apiBaseUrl}/eval/fs/write?${qs.toString()}`, {
                    method: 'PUT',
                    body: pending,
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.detail || `Failed to write ${relativePath} (HTTP ${res.status})`);
                }
            },
        };
    }
}

class RemoteDirectoryHandle {
    constructor(apiBaseUrl, root, relativePath, name) {
        this.kind = 'directory';
        this.name = name;
        this._apiBaseUrl = apiBaseUrl;
        this._root = root;
        this._relativePath = relativePath;
    }

    async _list() {
        const qs = new URLSearchParams({ root: this._root, path: this._relativePath });
        const res = await fetch(`${this._apiBaseUrl}/eval/fs/list?${qs.toString()}`);
        if (!res.ok) {
            throw new Error(`Failed to list ${this._relativePath || '/'} (HTTP ${res.status})`);
        }
        const data = await res.json();
        return data.entries || [];
    }

    _childPath(name) {
        return this._relativePath ? `${this._relativePath}/${name}` : name;
    }

    _childHandle(entry) {
        const childPath = this._childPath(entry.name);
        return entry.is_dir
            ? new RemoteDirectoryHandle(this._apiBaseUrl, this._root, childPath, entry.name)
            : new RemoteFileHandle(this._apiBaseUrl, this._root, childPath, entry.name);
    }

    async *entries() {
        const entries = await this._list();
        for (const entry of entries) {
            yield [entry.name, this._childHandle(entry)];
        }
    }

    async *values() {
        const entries = await this._list();
        for (const entry of entries) {
            yield this._childHandle(entry);
        }
    }

    async getDirectoryHandle(name) {
        return new RemoteDirectoryHandle(this._apiBaseUrl, this._root, this._childPath(name), name);
    }

    async getFileHandle(name) {
        return new RemoteFileHandle(this._apiBaseUrl, this._root, this._childPath(name), name);
    }
}

// `rootName` is purely cosmetic (shown wherever a handle's `.name` is
// displayed, mirroring what a native picker's folder name would show).
export const createRemoteDirectoryHandle = (apiBaseUrl, root, basePath) => {
    const rootName = (basePath || '').split('/').filter(Boolean).pop() || basePath || 'Server';
    return new RemoteDirectoryHandle(apiBaseUrl, root, '', `${rootName} (server)`);
};
