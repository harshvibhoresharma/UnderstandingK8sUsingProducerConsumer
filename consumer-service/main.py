from fastapi import FastAPI
import redis
import os
import json
import threading
from datetime import datetime
import time  

app = FastAPI(title="Consumer Service")

REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_PORT", 6379))
QUEUE_NAME = os.environ.get("QUEUE_NAME", "tasks")

r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

# In-memory store of processed tasks (per pod)
# In real life this would be a database
processed_tasks = []
processed_count = 0


def worker():
    """
    Background thread — runs independently of the API.
    Blocks on BRPOP waiting for tasks from Redis.
    This is what KEDA watches and scales based on queue length.
    """
    global processed_count
    print(f"[Consumer Worker] Started. Listening on queue: {QUEUE_NAME}", flush=True)
    while True:
        try:
            result = r.brpop(QUEUE_NAME, timeout=0)
            if result:
                _, raw = result
                task = json.loads(raw)
                task["processed_at"] = datetime.utcnow().isoformat()
                processed_tasks.append(task)
                processed_count += 1
                print(f"[Consumer Worker] Processed task {task['task_id']} | "
                      f"Total processed by this pod: {processed_count}", flush=True)
                time.sleep(1)
        except Exception as e:
            print(f"[Consumer Worker] Error: {e}", flush=True)


# Start the background worker thread when the app starts
@app.on_event("startup")
def startup():
    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    print("[Consumer API] Worker thread started", flush=True)


@app.get("/health")
def health():
    return {"status": "ok", "service": "consumer"}


@app.get("/status")
def status():
    """
    Returns what this specific pod has processed.
    In a real system you'd query a shared DB here.
    """
    return {
        "pod_processed_count": processed_count,
        "recent_tasks": processed_tasks[-5:]  # last 5 tasks
    }


@app.get("/queue-length")
def queue_length():
    length = r.llen(QUEUE_NAME)
    return {"queue": QUEUE_NAME, "pending": length}
