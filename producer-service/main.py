from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import redis
import os
import uuid
import json
from datetime import datetime

app = FastAPI(title="Producer Service")

REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_PORT", 6379))
QUEUE_NAME = os.environ.get("QUEUE_NAME", "tasks")

r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


class TaskRequest(BaseModel):
    name: str
    payload: str


class TaskResponse(BaseModel):
    task_id: str
    status: str
    message: str


@app.get("/health")
def health():
    return {"status": "ok", "service": "producer"}


@app.post("/submit-task", response_model=TaskResponse)
def submit_task(task: TaskRequest):
    try:
        task_id = str(uuid.uuid4())[:8]
        message = json.dumps({
            "task_id": task_id,
            "name": task.name,
            "payload": task.payload,
            "submitted_at": datetime.utcnow().isoformat()
        })
        r.lpush(QUEUE_NAME, message)
        queue_length = r.llen(QUEUE_NAME)
        print(f"[Producer] Submitted task {task_id} | Queue length: {queue_length}", flush=True)
        return TaskResponse(
            task_id=task_id,
            status="queued",
            message=f"Task submitted. Current queue length: {queue_length}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/queue-length")
def queue_length():
    length = r.llen(QUEUE_NAME)
    return {"queue": QUEUE_NAME, "length": length}
