// ------------------------------
// Load environment variables
// ------------------------------
import * as dotenv from "dotenv";
dotenv.config();

import os from "os";  // To detect server IP
import { buildApp } from './app.js';

// ------------------------------
// Function to get machine's IP address
// ------------------------------
const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address; // Return first non-internal IPv4
      }
    }
  }
  return '0.0.0.0';
};

// ------------------------------
// Main server start function
// ------------------------------
const start = async () => {
  const app = await buildApp();

  const PORT = Number(process.env.PORT) || 3004;
  const IP = getLocalIP(); // Detect server IP automatically

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });

    console.log("🚀 Server running at:");
    console.log(`➡ Local:       http://localhost:${PORT}`);
    console.log(`➡ Network:     http://${IP}:${PORT}`);

    // Graceful shutdown handlers
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n[${new Date().toISOString()}] ${signal} received, shutting down gracefully...`);
      try {
        // Give in-flight requests 30 seconds to complete
        await Promise.race([
          app.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Shutdown timeout')), 30000),
          ),
        ]);
        console.log('✓ Server closed gracefully');
        process.exit(0);
      } catch (err) {
        console.error('✗ Error during shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
