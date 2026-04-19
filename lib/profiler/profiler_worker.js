'use strict';
const { parentPort, workerData } = require('worker_threads');
const { Profiler } = require('./build/Release/profiler.node');

const { options, method, args } = workerData;
// callgrind hat 10-50x Overhead; Timeout entsprechend setzen
const durationSeconds = options.durationSeconds || 30;
const timeoutMs = (durationSeconds * 60 + 120) * 1000;

// Kill this worker thread if the native call hangs
const killTimer = setTimeout(() => {
  parentPort.postMessage({ error: `Native profiler timed out after ${timeoutMs}ms` });
  process.exit(1);
}, timeoutMs);

const profiler = new Profiler(options);

try {
  let result;
  if (method === 'profilePid') {
    result = profiler.profilePid(args[0]);
  } else if (method === 'profileBinary') {
    result = profiler.profileBinary(args[0], args[1] || []);
  } else {
    throw new Error(`Unknown method: ${method}`);
  }
  clearTimeout(killTimer);
  parentPort.postMessage({ result });
} catch (err) {
  clearTimeout(killTimer);
  parentPort.postMessage({ error: err.message || String(err) });
}
