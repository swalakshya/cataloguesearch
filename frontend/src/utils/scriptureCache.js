/**
 * PDF Cache Utility
 * 
 * Manages caching of PDF files in IndexedDB with:
 * - 100MB storage limit
 * - LRU (Least Recently Used) eviction policy
 * - Automatic cache key generation
 * 
 * Note: Scripture data (Granth objects) should always be fetched fresh from API
 */

const DB_NAME = 'PDFCache';
const DB_VERSION = 1;
const STORE_NAME = 'pdfs';
const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB in bytes

class PDFCache {
    constructor() {
        this.db = null;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                this.initialized = true;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                    store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
                    store.createIndex('size', 'size', { unique: false });
                }
            };
        });
    }

    generateCacheKey(pdfUrl) {
        return `pdf_${pdfUrl}`;
    }

    async get(pdfUrl) {
        await this.init();
        
        const key = this.generateCacheKey(pdfUrl);
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            
            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    // Update last accessed time for LRU
                    result.lastAccessed = Date.now();
                    store.put(result);
                    
                    console.log(`PDF Cache HIT for: ${pdfUrl}`);
                    resolve(result.data);
                } else {
                    console.log(`PDF Cache MISS for: ${pdfUrl}`);
                    resolve(null);
                }
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async set(pdfUrl, pdfBlob) {
        await this.init();
        
        const key = this.generateCacheKey(pdfUrl);
        const dataSize = pdfBlob.size;
        
        const cacheEntry = {
            key,
            data: pdfBlob,
            pdfUrl,
            size: dataSize,
            lastAccessed: Date.now(),
            createdAt: Date.now()
        };

        // Check if we need to evict old entries
        await this.ensureSpaceAvailable(dataSize);
        
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        return new Promise((resolve, reject) => {
            const request = store.put(cacheEntry);
            
            request.onsuccess = () => {
                console.log(`Cached PDF: ${pdfUrl} (${(dataSize / 1024 / 1024).toFixed(1)}MB)`);
                resolve();
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async ensureSpaceAvailable(newDataSize) {
        const currentSize = await this.getCurrentCacheSize();
        
        if (currentSize + newDataSize <= MAX_CACHE_SIZE) {
            return; // No eviction needed
        }

        console.log(`Cache size ${(currentSize / 1024 / 1024).toFixed(1)}MB + ${(newDataSize / 1024).toFixed(1)}KB exceeds limit. Evicting oldest entries...`);
        
        // Get all entries sorted by last accessed (oldest first)
        const entries = await this.getAllEntriesSortedByLRU();
        
        let sizeToFree = (currentSize + newDataSize) - MAX_CACHE_SIZE;
        const entriesToDelete = [];
        
        for (const entry of entries) {
            entriesToDelete.push(entry.key);
            sizeToFree -= entry.size;
            
            if (sizeToFree <= 0) break;
        }
        
        // Delete the oldest entries
        for (const key of entriesToDelete) {
            await this.delete(key);
        }
        
        console.log(`Evicted ${entriesToDelete.length} old PDF entries`);
    }

    async getCurrentCacheSize() {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            
            request.onsuccess = () => {
                const totalSize = request.result.reduce((sum, entry) => sum + entry.size, 0);
                resolve(totalSize);
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async getAllEntriesSortedByLRU() {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            
            request.onsuccess = () => {
                const entries = request.result;
                // Sort by lastAccessed (oldest first for LRU eviction)
                entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
                resolve(entries);
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async delete(key) {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        return new Promise((resolve, reject) => {
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getCacheStats() {
        await this.init();
        
        const entries = await this.getAllEntriesSortedByLRU();
        const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
        
        return {
            totalEntries: entries.length,
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
            maxSizeMB: (MAX_CACHE_SIZE / 1024 / 1024).toFixed(0),
            utilizationPercent: ((totalSize / MAX_CACHE_SIZE) * 100).toFixed(1)
        };
    }

    async clear() {
        await this.init();
        
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => {
                console.log('PDF cache cleared');
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// Export singleton instance
export const pdfCache = new PDFCache();

const API_BASE_URL = process.env.REACT_APP_EVAL_API_BASE_URL || '/api';

// Helper function to get scripture data (always from API - no caching)
export const getScriptureData = async (relativePath) => {
    const response = await fetch(`${API_BASE_URL}/eval/scripture`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ relative_path: relativePath })
    });
    
    if (!response.ok) {
        throw new Error(`Failed to fetch scripture: ${response.statusText}`);
    }
    
    return await response.json();
};

// Helper function to get PDF with caching
export const getPDFWithCache = async (pdfUrl) => {
    // Check cache first
    const cachedPDF = await pdfCache.get(pdfUrl);
    if (cachedPDF) {
        return cachedPDF;
    }
    
    // If not in cache, fetch from network
    let finalUrl = pdfUrl;
    if (pdfUrl.startsWith('http://') || pdfUrl.startsWith('https://')) {
        finalUrl = `${API_BASE_URL}/eval/pdf/proxy?url=${encodeURIComponent(pdfUrl)}`;
    }
    
    const response = await fetch(finalUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }
    
    const pdfBlob = await response.blob();
    
    // Cache the PDF
    await pdfCache.set(pdfUrl, pdfBlob);
    
    return pdfBlob;
};