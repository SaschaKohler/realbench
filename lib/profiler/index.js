const { Profiler } = require('./build/Release/profiler.node');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

function runInWorker(options, method, args) {
  // callgrind hat 10-50x Overhead; Timeout entsprechend setzen
  const durationSeconds = options.durationSeconds || 30;
  const timeoutMs = (durationSeconds * 60 + 120) * 1000;
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'profiler_worker.js'), {
      workerData: { options, method, args },
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate();
        reject(new Error(`Profiler worker timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    worker.on('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    });
    worker.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    worker.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

class ProfilerClient {
  constructor(options = {}) {
    this.options = {
      frequencyHz: options.frequencyHz || 99,
      durationSeconds: options.durationSeconds || 30,
      includeKernel: options.includeKernel || false,
    };
  }

  async profilePid(pid) {
    return runInWorker(this.options, 'profilePid', [pid]);
  }

  async profileBinary(binaryPath, args = []) {
    return runInWorker(this.options, 'profileBinary', [binaryPath, args]);
  }

  static diff(baseline, current) {
    return Profiler.diff(baseline, current);
  }
}

module.exports = {
  ProfilerClient,
  Profiler,
};
