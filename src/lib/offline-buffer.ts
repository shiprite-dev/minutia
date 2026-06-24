// ---------------------------------------------------------------------------
// IndexedDB offline buffer for live capture
// ---------------------------------------------------------------------------

export interface PendingItem {
  id: string;
  type: "issue" | "decision";
  title: string;
  category?: string;
  priority?: string;
  meeting_id: string;
  series_id: string;
  created_at: string;
}

const DB_NAME = "minutia_offline";
const STORE_NAME = "pending_captures";
const AUDIO_STORE_NAME = "audio_chunks";
const DB_VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
        const store = db.createObjectStore(AUDIO_STORE_NAME, { keyPath: "id" });
        store.createIndex("by_meeting", "meeting_id", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Another tab holding an older version open would otherwise hang the upgrade.
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade blocked by another open tab"));
  });
}

export async function addPendingItem(item: PendingItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getPendingItems(): Promise<PendingItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      db.close();
      const items = (request.result as PendingItem[]).sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      resolve(items);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function removePendingItem(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getPendingCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).count();
    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

// ---------------------------------------------------------------------------
// Audio chunk buffer: persist MediaRecorder chunks as they arrive so
// a crash mid-meeting leaves a recoverable recording on disk. Each chunk is its
// own row, keyed by meeting + monotonic sequence, so writes stay append-only.
// ---------------------------------------------------------------------------

export interface AudioChunkRecord {
  id: string; // `${meeting_id}:${seq}` zero-padded for ordered iteration
  meeting_id: string;
  seq: number;
  blob: Blob;
}

export async function appendAudioChunk(
  meetingId: string,
  seq: number,
  blob: Blob
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
    tx.objectStore(AUDIO_STORE_NAME).put({
      id: `${meetingId}:${String(seq).padStart(6, "0")}`,
      meeting_id: meetingId,
      seq,
      blob,
    } satisfies AudioChunkRecord);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getAudioChunks(meetingId: string): Promise<Blob[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readonly");
    const index = tx.objectStore(AUDIO_STORE_NAME).index("by_meeting");
    const request = index.getAll(IDBKeyRange.only(meetingId));
    request.onsuccess = () => {
      db.close();
      const chunks = (request.result as AudioChunkRecord[])
        .sort((a, b) => a.seq - b.seq)
        .map((row) => row.blob);
      resolve(chunks);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function clearAudioChunks(meetingId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
    const store = tx.objectStore(AUDIO_STORE_NAME);
    const cursorRequest = store.index("by_meeting").openCursor(
      IDBKeyRange.only(meetingId)
    );
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
