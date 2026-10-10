import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(50);
/** Fire-and-forget: listeners must never break the code that emitted the event. */
export const emit = (type, data = {}) => { try { bus.emit('event', { type, at: Date.now(), ...data }); } catch { /* ignore */ } };
export const onEvent = (fn) => bus.on('event', fn);
