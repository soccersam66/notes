// Main-thread client for the math engine worker.
import { createSolver } from './mathengine.js';

let worker = null, ready = false, readyWaiters = [], seq = 0;
const pending = new Map();
export const engineState = { status: 'off', error: '' };
const listeners = new Set();
export function onEngineState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setState(status, error = '') { engineState.status = status; engineState.error = error; listeners.forEach(f => f(engineState)); }

function start() {
  if (worker) return;
  setState('loading');
  worker = new Worker(new URL('./engine-worker.js', import.meta.url));
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'ready') { ready = true; setState('ready'); readyWaiters.forEach(r => r()); readyWaiters = []; return; }
    if (d.type === 'fatal') { setState('error', d.error); readyWaiters.forEach(r => r()); readyWaiters = []; return; }
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id); clearTimeout(p.timer);
    if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result);
  };
  worker.onerror = (e) => setState('error', e.message || 'Engine failed to start');
}

function restart() {
  if (worker) worker.terminate();
  worker = null; ready = false;
  pending.forEach(p => p.reject(new Error('timeout')));
  pending.clear();
  start();
}

export function warmEngine() { start(); return ready ? Promise.resolve() : new Promise(r => readyWaiters.push(r)); }

export function evalCmd(cmd, timeout = 8000) {
  start();
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); restart(); } }, timeout + (ready ? 0 : 20000));
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, cmd });
  });
}

export const solver = createSolver(evalCmd);
