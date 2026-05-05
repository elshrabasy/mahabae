import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type SyncEvent = {
  id?: string;
  seq?: number;
  type: string;
  payload?: any;
  time?: string;
  replay?: boolean;
};

type UseRealtimeSyncOptions = {
  apiBaseUrl: string;
  token: string | null | undefined;
  deviceFp: string | null | undefined;
  enabled?: boolean;
  adminToken?: string;
  onEvent?: (event: SyncEvent) => void;
};

const LAST_SEQ_KEY = 'mahabat_hr_last_event_seq';

function wsBaseFromHttp(apiBaseUrl: string) {
  const url = new URL(apiBaseUrl || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.origin;
}

function authHeaders(token?: string | null, deviceFp?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (deviceFp) headers['X-Device-Fp'] = deviceFp;
  return headers;
}

function getStoredSeq() {
  const n = Number(localStorage.getItem(LAST_SEQ_KEY) || 0);
  return Number.isFinite(n) ? n : 0;
}

function storeSeq(seq?: number) {
  if (typeof seq === 'number' && Number.isFinite(seq) && seq > getStoredSeq()) {
    localStorage.setItem(LAST_SEQ_KEY, String(seq));
  }
}

export function useRealtimeSync({
  apiBaseUrl,
  token,
  deviceFp,
  enabled = true,
  adminToken,
  onEvent,
}: UseRealtimeSyncOptions) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const closedByHookRef = useRef(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('idle');

  const canConnect = Boolean(enabled && apiBaseUrl && (adminToken || (token && deviceFp)));

  const invalidateForEvent = useMemo(() => (event: SyncEvent) => {
    const type = String(event.type || '').toLowerCase();
    if (type.includes('employee')) queryClient.invalidateQueries({ queryKey: ['employees'] });
    if (type.includes('attendance')) queryClient.invalidateQueries({ queryKey: ['attendance'] });
    if (type.includes('payroll') || type.includes('salary')) queryClient.invalidateQueries({ queryKey: ['payroll'] });
    if (type.includes('loan')) queryClient.invalidateQueries({ queryKey: ['loans'] });
    if (type.includes('leave')) queryClient.invalidateQueries({ queryKey: ['leaves'] });
    if (type.includes('allowance') || type.includes('bonus')) queryClient.invalidateQueries({ queryKey: ['allowances'] });
    if (type.includes('notification')) queryClient.invalidateQueries({ queryKey: ['notifications'] });
    if (type.includes('device') || type.includes('security')) queryClient.invalidateQueries({ queryKey: ['security'] });
  }, [queryClient]);

  useEffect(() => {
    if (!canConnect) {
      setStatus('idle');
      return;
    }

    closedByHookRef.current = false;

    const handleEvent = (event: SyncEvent) => {
      storeSeq(event.seq);
      invalidateForEvent(event);
      onEvent?.(event);
    };

    const fetchReplay = async () => {
      const lastSeq = getStoredSeq();
      const path = adminToken ? '/api/admin/sync/since' : '/api/sync/since';
      const url = `${apiBaseUrl.replace(/\/$/, '')}${path}?seq=${encodeURIComponent(lastSeq)}`;
      const res = await fetch(url, {
        headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : authHeaders(token, deviceFp),
      });
      if (!res.ok) throw new Error(`Sync replay failed: ${res.status}`);
      const data = await res.json();
      (data.events || []).forEach(handleEvent);
      if (typeof data.latestSeq === 'number') storeSeq(data.latestSeq);
    };

    const connect = async () => {
      try {
        setStatus('connecting');
        await fetchReplay().catch(() => undefined);
        const lastSeq = getStoredSeq();
        const params = new URLSearchParams({ lastSeq: String(lastSeq) });
        if (adminToken) params.set('adminToken', adminToken);
        else {
          params.set('token', token || '');
          params.set('deviceFp', deviceFp || '');
        }
        const ws = new WebSocket(`${wsBaseFromHttp(apiBaseUrl)}/ws?${params.toString()}`);
        wsRef.current = ws;
        ws.onopen = () => { retryCountRef.current = 0; setStatus('connected'); };
        ws.onerror = () => setStatus('error');
        ws.onmessage = (message) => {
          try {
            handleEvent(JSON.parse(message.data));
          } catch (error) {
            console.warn('Invalid realtime sync message', error);
          }
        };
        ws.onclose = () => {
          wsRef.current = null;
          if (closedByHookRef.current) return;
          setStatus('disconnected');
          retryCountRef.current += 1;
          retryRef.current = window.setTimeout(connect, Math.min(30_000, 1000 * Math.pow(1.7, Math.min(retryCountRef.current, 8))));
        };
      } catch (error) {
        console.error('Realtime sync connection failed', error);
        setStatus('error');
        retryCountRef.current += 1;
        retryRef.current = window.setTimeout(connect, Math.min(30_000, 1000 * Math.pow(1.7, Math.min(retryCountRef.current, 8))));
      }
    };

    connect();

    return () => {
      closedByHookRef.current = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [apiBaseUrl, token, deviceFp, enabled, adminToken, canConnect, invalidateForEvent, onEvent]);

  return { status, lastSeq: getStoredSeq(), reconnect: () => wsRef.current?.close() };
}
