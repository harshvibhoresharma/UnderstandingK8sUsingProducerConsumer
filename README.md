# K8s Microservices — Producer & Consumer

## Architecture

```
Postman / curl
      │
      ▼
Producer Service (FastAPI)          ← NodePort :30001, external traffic
      │  POST /submit-task
      │  GET  /queue-length
      │
      └──── LPUSH ──── Redis (ClusterIP) ──── BRPOP ────┐
                                                         ▼
                                              Consumer Service (FastAPI)
                                                GET /status
                                                GET /queue-length
                                                [background worker thread]
                                                         ▲
                                                      KEDA
                                               (watches queue length,
                                                scales consumer pods)
```

## Project Structure
```
k8s-microservices/
├── producer-service/
│   ├── main.py           # FastAPI: POST /submit-task, GET /queue-length
│   ├── requirements.txt
│   └── Dockerfile
├── consumer-service/
│   ├── main.py           # FastAPI: GET /status + background BRPOP worker
│   ├── requirements.txt
│   └── Dockerfile
└── k8s/
    ├── configmap.yaml         # shared Redis config
    ├── redis.yaml             # Redis Deployment + ClusterIP Service
    ├── producer.yaml          # Producer Deployment + NodePort Service + HPA
    ├── consumer.yaml          # Consumer Deployment + ClusterIP Service
    └── keda-scaledobject.yaml # KEDA ScaledObject (queue-based autoscaling)
```

---

## Setup

### Step 1 — Start Minikube with metrics server (needed for HPA)
```bash
minikube start
minikube addons enable metrics-server
```

### Step 2 — Install KEDA
```bash
kubectl apply -f https://github.com/kedacore/keda/releases/download/v2.14.0/keda-2.14.0.yaml

# Wait for KEDA pods to be ready
kubectl get pods -n keda
```

### Step 3 — Point Docker to Minikube's daemon
```bash
eval $(minikube docker-env)
```

### Step 4 — Build images
```bash
docker build -t producer-service:latest ./producer-service
docker build -t consumer-service:latest ./consumer-service
```

### Step 5 — Apply all manifests
```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/producer.yaml
kubectl apply -f k8s/consumer.yaml
kubectl apply -f k8s/keda-scaledobject.yaml
```

### Step 6 — Verify everything is running
```bash
kubectl get pods
kubectl get deployments
kubectl get services
kubectl get hpa
kubectl get scaledobject
```

---

## Using the API

### Get Minikube IP
```bash
minikube ip
# e.g. 192.168.49.2
```

### Submit a task (hits Producer Service via NodePort)
```bash
curl -X POST http://$(minikube ip):30001/submit-task \
  -H "Content-Type: application/json" \
  -d '{"name": "send-email", "payload": "user@example.com"}'
```

### Check queue length (from producer)
```bash
curl http://$(minikube ip):30001/queue-length
```

### Check consumer status (ClusterIP — needs port-forward)
```bash
kubectl port-forward svc/consumer-service 8001:8001
curl http://localhost:8001/status
curl http://localhost:8001/queue-length
```

---

## Experiments

### 1. Watch KEDA scale consumers based on queue length
```bash
# Terminal 1: watch pods
kubectl get pods -w

# Terminal 2: blast 100 tasks at once
for i in $(seq 1 100); do
  curl -s -X POST http://$(minikube ip):30001/submit-task \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"task-$i\", \"payload\": \"data-$i\"}" &
done

# Watch consumer pods scale from 1 → 10 automatically
```

### 2. Kill Redis — watch both services crash-loop and recover
```bash
kubectl delete pod -l app=redis
kubectl get pods -w
# Redis pod is recreated by its Deployment
# Producer and consumer recover automatically once Redis is back
```

### 3. Check inter-service DNS
```bash
# Exec into producer pod
kubectl exec -it deployment/producer -- sh

# Inside the pod — verify Redis is reachable by Service name
python3 -c "import socket; print(socket.gethostbyname('redis-service'))"

# Verify consumer is reachable by Service name (ClusterIP)
python3 -c "import socket; print(socket.gethostbyname('consumer-service'))"
```

### 4. Watch HPA scale producer under load
```bash
# Terminal 1
kubectl get hpa -w

# Terminal 2: hammer the producer endpoint
for i in $(seq 1 500); do
  curl -s -X POST http://$(minikube ip):30001/submit-task \
    -H "Content-Type: application/json" \
    -d '{"name": "stress", "payload": "test"}' &
done
```

### 5. Tail logs from all consumer pods simultaneously
```bash
kubectl logs -f -l app=consumer
# You'll see tasks distributed across pods — each pod picks up different tasks
```

### 6. Scale to zero — KEDA kills consumers when queue is empty
```bash
# After queue drains:
kubectl get pods -l app=consumer
# Consumer pods go to 0 after cooldownPeriod (30s)
# Submit a new task — KEDA spins a pod back up within seconds
```

---

## Key Concepts Covered

| Concept | Where |
|---|---|
| Deployment | producer, consumer, redis |
| ClusterIP Service | redis-service, consumer-service |
| NodePort Service | producer-service (external access) |
| ConfigMap | shared Redis config injected as env vars |
| Liveness Probe | all three services |
| Readiness Probe | all three services |
| Resource requests/limits | all three services |
| HPA (CPU-based) | producer |
| KEDA (queue-based) | consumer |
| Inter-pod DNS | producer → redis-service, consumer → redis-service |
| Background threads | consumer worker (BRPOP separate from API) |
