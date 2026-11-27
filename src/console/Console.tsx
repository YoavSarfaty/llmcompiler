import { useState } from 'react';
import type { Diagnostic } from '../types/diagnostics.ts';

interface ConsoleProps {
  diagnostics: Diagnostic[];
}

export function Console({ diagnostics }: ConsoleProps) {
  const [log, setLog] = useState<string>('');

  const handleClear = () => {
    setLog('');
  };

  const logDiagnostic = (d: Diagnostic) => {
    const line = `${d.severity.toUpperCase()} ${d.code}: ${d.message}`;
    setLog(prev => (prev ? `${prev}\n${line}` : line));
  };

  return (
    <div className="console">
      <div className="console-header">
        <button type="button" onClick={handleClear} className="badge warn" aria-label="Clear console output">
          Clear
        </button>
        <span className="muted">Log:</span>
      </div>
      <pre className="console-log" role="log" aria-live="polite">{log}</pre>
      <div className="console-items">
        {diagnostics.map((d, i) => (
          <button
            key={i}
            className={`diagnostic ${d.severity}`}
            type="button"
            onClick={() => logDiagnostic(d)}
          >
            <span className="code">{d.code}</span>
            <span className="message">{d.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}