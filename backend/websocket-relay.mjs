// websocket-relay.mjs - WebSocket relay for instant license revocation
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

// Store connected HRMS clients
const clients = new Map(); // license_id -> Set of WebSocket connections

// WebSocket server instance
let wss = null;

// Initialize WebSocket server
export function initWebSocketRelay(server) {
  wss = new WebSocketServer({ 
    server,
    path: '/ws/relay'
  });
  
  wss.on('connection', (ws, req) => {
    const clientId = randomUUID();
    let licenseId = null;
    let authenticated = false;
    
    console.log(`[WS] New connection: ${clientId}`);
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Connected to VY Group License Relay',
      client_id: clientId
    }));
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'authenticate':
            // HRMS sends its license_id to subscribe to revocation events
            licenseId = message.license_id;
            
            if (!licenseId) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'license_id required'
              }));
              return;
            }
            
            // Add client to subscribers for this license
            if (!clients.has(licenseId)) {
              clients.set(licenseId, new Set());
            }
            clients.get(licenseId).add(ws);
            
            authenticated = true;
            
            ws.send(JSON.stringify({
              type: 'authenticated',
              license_id: licenseId,
              message: 'Subscribed to revocation events'
            }));
            
            console.log(`[WS] Client ${clientId} authenticated for license ${licenseId}`);
            break;
            
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
            
          default:
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Unknown message type'
            }));
        }
      } catch (error) {
        console.error('[WS] Error processing message:', error.message);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        }));
      }
    });
    
    ws.on('close', () => {
      console.log(`[WS] Client ${clientId} disconnected`);
      
      // Remove from subscribers
      if (licenseId && clients.has(licenseId)) {
        clients.get(licenseId).delete(ws);
        if (clients.get(licenseId).size === 0) {
          clients.delete(licenseId);
        }
      }
    });
    
    ws.on('error', (error) => {
      console.error(`[WS] Client ${clientId} error:`, error.message);
    });
  });
  
  console.log('[WS] WebSocket relay initialized on /ws/relay');
  
  return wss;
}

// Broadcast revocation to all HRMS instances with this license
export function broadcastRevocation(licenseId, reason) {
  if (!clients.has(licenseId)) {
    console.log(`[WS] No clients connected for license ${licenseId}`);
    return { sent: 0 };
  }
  
  const subscribers = clients.get(licenseId);
  let sent = 0;
  
  const message = JSON.stringify({
    type: 'revoked',
    license_id: licenseId,
    reason: reason || 'License revoked by vendor',
    timestamp: new Date().toISOString()
  });
  
  for (const ws of subscribers) {
    if (ws.readyState === 1) { // OPEN
      try {
        ws.send(message);
        sent++;
      } catch (error) {
        console.error('[WS] Error sending to client:', error.message);
      }
    }
  }
  
  console.log(`[WS] Broadcast revocation for license ${licenseId} to ${sent} client(s)`);
  
  return { sent, total: subscribers.size };
}

// Broadcast license extension (un-revoke)
export function broadcastExtension(licenseId, additionalDays) {
  if (!clients.has(licenseId)) {
    console.log(`[WS] No clients connected for license ${licenseId}`);
    return { sent: 0 };
  }
  
  const subscribers = clients.get(licenseId);
  let sent = 0;
  
  const message = JSON.stringify({
    type: 'extended',
    license_id: licenseId,
    additional_days: additionalDays,
    timestamp: new Date().toISOString()
  });
  
  for (const ws of subscribers) {
    if (ws.readyState === 1) { // OPEN
      try {
        ws.send(message);
        sent++;
      } catch (error) {
        console.error('[WS] Error sending to client:', error.message);
      }
    }
  }
  
  console.log(`[WS] Broadcast extension for license ${licenseId} to ${sent} client(s)`);
  
  return { sent, total: subscribers.size };
}

// Get relay statistics
export function getRelayStats() {
  const stats = {
    total_licenses: clients.size,
    total_connections: 0,
    licenses: []
  };
  
  for (const [licenseId, subscribers] of clients.entries()) {
    const activeConnections = Array.from(subscribers).filter(ws => ws.readyState === 1).length;
    stats.total_connections += activeConnections;
    stats.licenses.push({
      license_id: licenseId,
      connections: activeConnections
    });
  }
  
  return stats;
}
