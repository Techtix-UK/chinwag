import { io, type Socket } from 'socket.io-client';
import { useEffect } from 'react';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
  return socket;
}

export function resetSocket() {
  socket?.disconnect();
  socket = null;
}

/** Subscribe to a real-time event for the lifetime of the component. */
export function useSocketEvent<T = any>(event: string, handler: (payload: T) => void, deps: unknown[] = []) {
  useEffect(() => {
    const s = getSocket();
    s.on(event, handler);
    return () => {
      s.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
