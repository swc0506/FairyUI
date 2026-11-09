// Spawn the Windows PowerShell GDI+ renderers (layout preview, asset sheet, mockup grid).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function powershellPath() {
  const win = process.env.SystemRoot || 'C:\\Windows';
  const full = path.join(win, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(full) ? full : 'powershell.exe';
}

export function runScript(script, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const ps = powershellPath();
    const argv = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args];
    const child = spawn(ps, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`script timed out after ${timeoutMs}ms: ${path.basename(script)}`));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(`${path.basename(script)} failed (exit ${code}): ${(stderr || stdout).trim()}`));
    });
  });
}

export function renderWith(script, planPath, outPath, options) {
  return runScript(script, ['-Plan', planPath, '-Out', outPath], options);
}

export function scriptPath(name) {
  return path.join(import.meta.dirname, name);
}
