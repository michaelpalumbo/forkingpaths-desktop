import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// 1. Properly load websql as a function using require
const openDatabase = require('websql');
import setGlobalVars from 'indexeddbshim';

// 2. Initialize the WebSQL-to-SQLite bridge
const dbPath = './local_data.sqlite';
const db = openDatabase(dbPath, '1.0', 'description', 1);

// 3. Setup the shim
// We pass the bridge-enabled 'db' to the shim via the 'win' object
setGlobalVars(global, { 
    checkOrigin: false,
    win: { openDatabase: () => db }
});

// Now your class works as intended!
export class LocalDocumentStore {
    constructor(dbName = "AppDB", storeName = "documents") {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
    }

    // Initialize the connection and create object store if needed
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: "id" });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => reject(event.target.error);
        });
    }

    // SAVE - Put document into store
    async saveDocument(doc) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.storeName], "readwrite");
            const store = tx.objectStore(this.storeName);
            const request = store.put(doc);
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // LOAD - Get document by ID
    async loadDocument(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.storeName], "readonly");
            const store = tx.objectStore(this.storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // DELETE - Remove document by ID
    async deleteDocument(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.storeName], "readwrite");
            const store = tx.objectStore(this.storeName);
            const request = store.delete(id);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }
} 

// 4. Export a pre-initialized instance
export const dbStore = new LocalDocumentStore();