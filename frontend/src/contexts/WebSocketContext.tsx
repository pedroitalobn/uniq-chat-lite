"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

interface InstanceEvent {
  type: string;
  instance: string;
  payload: {
    status: string;
    phone?: string;
  };
}

interface WebSocketContextType {
  isConnected: boolean;
  instanceStatuses: Record<string, string>;
  subscribe: (instanceId: string) => void;
  unsubscribe: (instanceId: string) => void;
}

const WebSocketContext = createContext<WebSocketContextType>({
  isConnected: false,
  instanceStatuses: {},
  subscribe: () => {},
  unsubscribe: () => {},
});

export function useInstanceStatus() {
  return useContext(WebSocketContext);
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [instanceStatuses, setInstanceStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    // Get token from localStorage
    const token = localStorage.getItem("token");
    if (!token) return;

    const wsUrl = `ws://localhost:8080/ws/events`;
    const wsInstance = new WebSocket(wsUrl);

    wsInstance.onopen = () => {
      setIsConnected(true);
      console.log("[WS] Connected to events");
    };

    wsInstance.onmessage = (event) => {
      try {
        const data: InstanceEvent = JSON.parse(event.data);
        
        if (data.type === "instance_status" && data.instance) {
          setInstanceStatuses((prev) => ({
            ...prev,
            [data.instance]: data.payload.status,
          }));
        }
      } catch (e) {
        // Ignore non-JSON messages (like ping/pong)
      }
    };

    wsInstance.onclose = () => {
      setIsConnected(false);
      setWs(null);
      // Reconnect after 3 seconds
      setTimeout(() => setWs(null as any), 3000);
    };

    wsInstance.onerror = () => {
      wsInstance.close();
    };

    setWs(wsInstance);

    return () => {
      wsInstance.close();
    };
  }, []);

  const subscribe = useCallback((instanceId: string) => {
    // Already tracked via global connection
  }, []);

  const unsubscribe = useCallback((instanceId: string) => {
    // Already tracked via global connection
  }, []);

  return (
    <WebSocketContext.Provider value={{ isConnected, instanceStatuses, subscribe, unsubscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
}