// Client for the local stem-separation server (server.py).

let statusPromise = null;

/** Returns the server's capabilities, or null when the page isn't served by server.py. */
export function serverStatus(refresh = false) {
  if (!statusPromise || refresh) {
    statusPromise = fetch('api/status')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return statusPromise;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function abortError() {
  return new DOMException('Separation cancelled', 'AbortError');
}

/**
 * Uploads audio for separation and resolves to { drums: Blob, noDrums: Blob, method }.
 * @returns {{promise: Promise, cancel: Function}}
 */
export function separate(file, onProgress) {
  const controller = new AbortController();
  let jobId = null;

  const promise = (async () => {
    onProgress(0, 'Uploading audio…');
    const res = await fetch(`api/separate?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
      signal: controller.signal,
    });
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || `Upload failed (${res.status})`);
    jobId = job.id;

    try {
      for (;;) {
        await sleep(700);
        if (controller.signal.aborted) throw abortError();
        const status = await (await fetch(`api/jobs/${jobId}`, { signal: controller.signal })).json();
        onProgress(status.progress * 0.95, status.message);
        if (status.state === 'error') throw new Error(`Stem separation failed.\n${status.error || ''}`);
        if (status.state === 'done') {
          onProgress(0.96, 'Downloading separated stems…');
          const [drums, noDrums] = await Promise.all(['drums', 'no_drums'].map(async (kind) => {
            const r = await fetch(`api/jobs/${jobId}/${kind}`, { signal: controller.signal });
            if (!r.ok) throw new Error(`Couldn't download the ${kind} stem.`);
            return r.blob();
          }));
          return { drums, noDrums, method: status.method };
        }
      }
    } finally {
      fetch(`api/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
    }
  })();

  return {
    promise,
    cancel: () => controller.abort(),
  };
}
