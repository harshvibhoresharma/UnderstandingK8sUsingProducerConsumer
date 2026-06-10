let autoOn = false, autoInterval = null;
let queueHistory = [], throughputHistory = [];
let completedTotal = 0, lastCompleted = 0;
let tasks = [];
let queueChart, throughputChart;
 
const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
  plugins: { legend: { display: false }, tooltip: {
    backgroundColor: '#1a1d27', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
    titleColor: '#7b82a0', bodyColor: '#e8eaf0', padding: 10, cornerRadius: 6
  }},
  scales: {
    x: { ticks: { color: '#7b82a0', font: { size: 11 }, maxRotation: 0, maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
    y: { ticks: { color: '#7b82a0', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false }, beginAtZero: true }
  }
};
 
function initCharts() {
  queueChart = new Chart(document.getElementById('queueChart'), {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: '#14b8a6', backgroundColor: 'rgba(20,184,166,0.08)', fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#14b8a6', borderWidth: 2 }] },
    options: JSON.parse(JSON.stringify(CHART_OPTS))
  });
  throughputChart = new Chart(document.getElementById('throughputChart'), {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4, borderSkipped: false }] },
    options: JSON.parse(JSON.stringify(CHART_OPTS))
  });
}
 
function ts() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
 
function setConn(state) {
  const dot = document.getElementById('conn-dot');
  const txt = document.getElementById('conn-text');
  dot.className = 'dot';
  if (state === 'connected')   { dot.classList.add('green'); txt.textContent = 'connected'; }
  else if (state === 'error')  { dot.classList.add('red');   txt.textContent = 'unreachable — mock data'; }
  else                         { txt.textContent = 'not connected'; }
}
 
async function poll() {
  const pUrl = document.getElementById('producer-url').value.trim();
  const cUrl = document.getElementById('consumer-url').value.trim();
  document.getElementById('poll-btn').disabled = true;
 
  let queueLen = 0, connected = false;
 
  try {
    const [qRes, cRes] = await Promise.allSettled([
      fetch(pUrl + '/queue-length').then(r => r.json()),
      fetch(cUrl + '/status').then(r => r.json())
    ]);
 
    if (qRes.status === 'fulfilled') {
      queueLen = qRes.value.length ?? 0;
      document.getElementById('m-queue').textContent = queueLen;
      connected = true;
    }
 
    if (cRes.status === 'fulfilled') {
      const s = cRes.value;
      completedTotal = s.completed ?? completedTotal;
      document.getElementById('m-done').textContent = completedTotal;
      const pods = s.pods ?? s.consumer_count ?? 1;
      document.getElementById('m-pods').textContent = pods;
      const avg = s.avg_process_time ?? s.avg_time ?? null;
      document.getElementById('m-avg').textContent = avg != null ? avg.toFixed(1) + 's' : '—';
      renderPods(pods, s.pod_names ?? null);
      if (s.recent_tasks) renderTasks(s.recent_tasks);
      document.getElementById('keda-info').style.display = 'block';
      connected = true;
    }
 
    setConn(connected ? 'connected' : 'error');
    if (!connected) seedMockData(queueLen);
 
  } catch(e) {
    setConn('error');
    seedMockData(0);
  }
 
  const now = ts();
  queueHistory.push({ t: now, v: queueLen });
  if (queueHistory.length > 20) queueHistory.shift();
  const delta = Math.max(0, completedTotal - lastCompleted);
  lastCompleted = completedTotal;
  throughputHistory.push({ t: now, v: delta });
  if (throughputHistory.length > 15) throughputHistory.shift();
 
  queueChart.data.labels = queueHistory.map(x => x.t);
  queueChart.data.datasets[0].data = queueHistory.map(x => x.v);
  queueChart.update();
  throughputChart.data.labels = throughputHistory.map(x => x.t);
  throughputChart.data.datasets[0].data = throughputHistory.map(x => x.v);
  throughputChart.update();
 
  document.getElementById('last-updated').textContent = 'last updated ' + now;
  document.getElementById('poll-btn').disabled = false;
}
 
function seedMockData(base) {
  const q = base || Math.floor(Math.random() * 14);
  document.getElementById('m-queue').textContent = q;
  if (document.getElementById('m-done').textContent === '—') {
    completedTotal = Math.floor(Math.random() * 60) + 20;
    lastCompleted = completedTotal;
    document.getElementById('m-done').textContent = completedTotal;
  }
  if (document.getElementById('m-pods').textContent === '—') {
    const p = q > 8 ? 4 : q > 4 ? 2 : 1;
    document.getElementById('m-pods').textContent = p;
    renderPods(p, null);
  }
  if (document.getElementById('m-avg').textContent === '—') {
    document.getElementById('m-avg').textContent = (Math.random() * 2 + 0.5).toFixed(1) + 's';
  }
  if (tasks.length === 0) {
    const names = ['resize-image','send-email','generate-report','compress-video','sync-db','export-csv','process-payment'];
    const statuses = ['done','done','processing','queued','done','done','failed'];
    tasks = Array.from({ length: 7 }, (_, i) => ({
      task_id: Math.random().toString(36).slice(2,10),
      name: names[i % names.length],
      status: statuses[i],
      submitted_at: new Date(Date.now() - i * 15000).toISOString()
    }));
    renderTasks(tasks);
  }
  document.getElementById('keda-info').style.display = 'block';
}
 
function renderTasks(list) {
  tasks = list;
  const el = document.getElementById('task-list');
  document.getElementById('task-count').textContent = list.length + ' tasks';
  if (!list.length) { el.innerHTML = '<div class="empty">no tasks yet</div>'; return; }
  el.innerHTML = list.slice(0, 15).map(t => {
    const badgeClass = { queued: 'badge-queued', processing: 'badge-processing', done: 'badge-done', failed: 'badge-failed' }[t.status] || 'badge-queued';
    const time = t.submitted_at ? new Date(t.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    return `<div class="task-row">
      <div class="task-info">
        <div class="task-name">${t.name || 'task'}</div>
        <div class="task-id">${t.task_id}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="task-time">${time}</span>
        <span class="badge ${badgeClass}">${t.status}</span>
      </div>
    </div>`;
  }).join('');
}
 
function renderPods(count, names) {
  const el = document.getElementById('pods-wrap');
  const n = typeof count === 'number' ? Math.max(1, count) : 1;
  document.getElementById('pod-count').textContent = n + ' pod' + (n !== 1 ? 's' : '');
  el.innerHTML = Array.from({ length: n }, (_, i) => {
    const name = names ? names[i] : `consumer-${String(i).padStart(2,'0')}`;
    return `<div class="pod-row">
      <div class="pod-name-wrap">
        <div class="pod-icon">📦</div>
        <span class="pod-name">${name}</span>
      </div>
      <span class="pod-status pod-running">● running</span>
    </div>`;
  }).join('');
}
 
async function submitTask() {
  const name = document.getElementById('task-name').value.trim() || 'test-task';
  const payload = document.getElementById('task-payload').value.trim() || 'data=test';
  const pUrl = document.getElementById('producer-url').value.trim();
  const msg = document.getElementById('submit-msg');
  msg.style.color = '#7b82a0';
  msg.textContent = 'submitting…';
  try {
    const res = await fetch(pUrl + '/submit-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, payload })
    });
    const data = await res.json();
    msg.style.color = '#22c55e';
    msg.textContent = `✓ ${data.task_id} queued`;
    document.getElementById('task-name').value = '';
    document.getElementById('task-payload').value = '';
    setTimeout(poll, 600);
  } catch(e) {
    msg.style.color = '#ef4444';
    msg.textContent = 'could not reach producer — is port-forward running?';
  }
}
 
function toggleAuto() {
  autoOn = !autoOn;
  const btn = document.getElementById('auto-btn');
  btn.textContent = autoOn ? 'auto: on (5s)' : 'auto: off';
  btn.classList.toggle('active', autoOn);
  if (autoOn) { autoInterval = setInterval(poll, 5000); poll(); }
  else clearInterval(autoInterval);
}
 
initCharts();
seedMockData(0);