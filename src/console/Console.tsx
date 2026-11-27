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
        <button onClick={handleClear} className="badge warn">Clear</button>
        <span className="muted">Log:</span>
      </div>
      <pre className="console-log">{log}</pre>
      <div className="console-items">
        {diagnostics.map((d, i) => (
          <div
            key={i}
            className={`diagnostic ${d.severity}`}
            style={{ cursor: 'pointer' }}
            onClick={() => logDiagnostic(d)}
          >
            <span className="code">{d.code}</span>
            <span className="message">{d.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}