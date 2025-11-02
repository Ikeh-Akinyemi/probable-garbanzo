import { RedisClient, SQL } from "bun";
import { mkdir } from "node:fs/promises";

// Initialize MySQL database
const db = new SQL({
  adapter: "mysql",
  hostname: "localhost",
  port: 3306,
  database: "taskdb",
  username: "bunuser",
  password: "bunpass",
});

// Initialize database table
await db`
  CREATE TABLE IF NOT EXISTS tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

console.log("✅ MySQL database initialized");

// Initialize Redis clients
const redis = new RedisClient("redis://localhost:6379");
const pubClient = new RedisClient("redis://localhost:6379");

await redis.connect();
await pubClient.connect();

console.log("✅ Redis connected");

// SSE connections for real-time updates
const clients = new Set();

// Subscribe to task updates
await redis.subscribe("task_updates", (message) => {
  // Broadcast to all connected SSE clients
  for (const client of clients) {
    try {
      client.controller.enqueue(`data: ${message}\n\n`);
    } catch (e) {
      // Client disconnected, remove it
      clients.delete(client);
    }
  }
});

console.log("✅ Redis subscribed to task_updates");

// Ensure public directory exists
await mkdir("./public", { recursive: true });

Bun.serve({
  port: 3000,
  
  async fetch(req) {
    const url = new URL(req.url);
    
    // Serve static files from /public
    if (url.pathname === "/" || url.pathname.startsWith("/public")) {
      const filePath = url.pathname === "/" 
        ? "./public/index.html" 
        : `.${url.pathname}`;
      
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
    }
    
    // API: Get all tasks
    if (url.pathname === "/api/tasks" && req.method === "GET") {
      const tasks = await db`SELECT * FROM tasks ORDER BY created_at DESC`;
      return Response.json(tasks);
    }
    
    // API: Create task
    if (url.pathname === "/api/tasks" && req.method === "POST") {
      const { title } = await req.json();
      
      await db`INSERT INTO tasks (title) VALUES (${title})`;
      
      // Get the last inserted ID
      const [task] = await db`SELECT * FROM tasks WHERE id = LAST_INSERT_ID()`;
      
      // Publish update to Redis
      await pubClient.publish("task_updates", JSON.stringify({ type: "create", task }));
      
      return Response.json(task, { status: 201 });
    }
    
    // API: Toggle task
    if (url.pathname.startsWith("/api/tasks/") && req.method === "PATCH") {
      const id = parseInt(url.pathname.split("/").pop());
      
      await db`UPDATE tasks SET completed = NOT completed WHERE id = ${id}`;
      const [task] = await db`SELECT * FROM tasks WHERE id = ${id}`;
      
      // Publish update to Redis
      await pubClient.publish("task_updates", JSON.stringify({ type: "toggle", task }));
      
      return Response.json(task);
    }
    
    // API: Delete task
    if (url.pathname.startsWith("/api/tasks/") && req.method === "DELETE") {
      const id = parseInt(url.pathname.split("/").pop());
      
      await db`DELETE FROM tasks WHERE id = ${id}`;
      
      // Publish update to Redis
      await pubClient.publish("task_updates", JSON.stringify({ type: "delete", id }));
      
      return new Response(null, { status: 204 });
    }
    
    // SSE endpoint for real-time updates
    if (url.pathname === "/api/events") {
      const stream = new ReadableStream({
        start(controller) {
          const client = { controller };
          clients.add(client);
          
          // Send initial connection message
          controller.enqueue("data: {\"type\":\"connected\"}\n\n");
          
          // Clean up on disconnect
          req.signal.addEventListener("abort", () => {
            clients.delete(client);
            try {
              controller.close();
            } catch (e) {}
          });
        },
      });
      
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }
    
    return new Response("Not Found", { status: 404 });
  },
});

console.log("🚀 Server running at http://localhost:3000");