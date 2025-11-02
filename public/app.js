const taskForm = document.getElementById('taskForm');
const taskInput = document.getElementById('taskInput');
const taskList = document.getElementById('taskList');
const connectionStatus = document.getElementById('connectionStatus');

// Fetch and render tasks
async function loadTasks() {
  const response = await fetch('/api/tasks');
  const tasks = await response.json();
  renderTasks(tasks);
}

// Render tasks to DOM
function renderTasks(tasks) {
  taskList.innerHTML = tasks.map(task => `
    <li class="${task.completed ? 'completed' : ''}">
      <input 
        type="checkbox" 
        ${task.completed ? 'checked' : ''} 
        onchange="toggleTask(${task.id})"
      />
      <span>${task.title}</span>
      <button onclick="deleteTask(${task.id})">❌</button>
    </li>
  `).join('');
}

// Add new task
taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const title = taskInput.value.trim();
  if (!title) return;
  
  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  
  taskInput.value = '';
  await loadTasks();
});

// Toggle task completion
window.toggleTask = async (id) => {
  await fetch(`/api/tasks/${id}`, { method: 'PATCH' });
  await loadTasks();
};

// Delete task
window.deleteTask = async (id) => {
  await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  await loadTasks();
};

// Real-time updates via SSE
const eventSource = new EventSource('/api/events');

eventSource.onopen = () => {
  connectionStatus.textContent = '🟢 Connected';
  connectionStatus.style.color = '#22c55e';
};

eventSource.onerror = () => {
  connectionStatus.textContent = '🔴 Disconnected';
  connectionStatus.style.color = '#ef4444';
};

eventSource.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log('Real-time update:', update);
  loadTasks(); // Refresh task list
};

// Initial load
loadTasks();