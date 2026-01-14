/**
 * LogMonitor - Continuous log analysis for SignalK container
 * 
 * Monitors container stdout/stderr for errors and warnings,
 * tracking issues by test phase for detailed reporting.
 */

const { EventEmitter } = require('events');

class LogMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.errors = [];
    this.warnings = [];
    this.allLogs = [];
    this.maxLogEntries = options.maxLogEntries || 10000;
    
    // Critical error patterns - these fail tests
    this.criticalPatterns = [
      /\bERROR\b/i,
      /\bFATAL\b/i,
      /\bUncaught\s+Exception/i,
      /\bUnhandled\s+Rejection/i,
      /\bUnhandledPromiseRejection/i,
      /ECONNREFUSED/,
      /EADDRINUSE/,
      /EACCES/,
      /Cannot find module/,
      /Module not found/,
      /SyntaxError/,
      /TypeError(?!.*null)/,  // Exclude common null checks
      /ReferenceError/,
      /RangeError/,
      /segmentation fault/i,
      /out of memory/i,
      /heap out of memory/i,
      /SIGABRT/,
      /SIGSEGV/,
      /core dumped/i,
    ];
    
    // Warning patterns - reported but don't fail tests
    this.warningPatterns = [
      /\bWARN\b/i,
      /\bwarning\b/i,
      /deprecated/i,
      /\bDEPRECATION\b/,
    ];
    
    // Patterns to ignore (expected during normal operation)
    this.ignorePatterns = options.ignorePatterns || [
      /WARN.*no\s+data\s+received/i,
      /WARN.*waiting for/i,
      /debug/i,
      /\bDEBUG\b/,
      /health.*check/i,
      /starting/i,
      /listening on/i,
      /connected/i,
    ];
    
    this.currentPhase = 'init';
    this.phaseErrors = new Map();
    this.phaseWarnings = new Map();
    this.phaseLogs = new Map();
    this.stream = null;
  }

  /**
   * Set current test phase for log categorization
   */
  setPhase(phase) {
    this.currentPhase = phase;
    if (!this.phaseErrors.has(phase)) {
      this.phaseErrors.set(phase, []);
      this.phaseWarnings.set(phase, []);
      this.phaseLogs.set(phase, []);
    }
    this.emit('phase', phase);
  }

  /**
   * Process a single log line
   */
  processLine(line, stream = 'stdout') {
    if (!line || !line.trim()) return null;
    
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      line: line.trim(),
      stream,
      phase: this.currentPhase,
    };

    // Store all logs (with limit)
    this.allLogs.push(entry);
    if (this.allLogs.length > this.maxLogEntries) {
      this.allLogs.shift();
    }
    
    // Store phase-specific logs
    if (this.phaseLogs.has(this.currentPhase)) {
      this.phaseLogs.get(this.currentPhase).push(entry);
    }

    // Check ignore patterns first
    if (this.ignorePatterns.some(p => p.test(line))) {
      return null;
    }

    // Check for critical errors
    for (const pattern of this.criticalPatterns) {
      if (pattern.test(line)) {
        entry.type = 'error';
        entry.pattern = pattern.toString();
        this.errors.push(entry);
        this.phaseErrors.get(this.currentPhase)?.push(entry);
        this.emit('error', entry);
        return entry;
      }
    }

    // Check for warnings
    for (const pattern of this.warningPatterns) {
      if (pattern.test(line)) {
        entry.type = 'warning';
        entry.pattern = pattern.toString();
        this.warnings.push(entry);
        this.phaseWarnings.get(this.currentPhase)?.push(entry);
        this.emit('warning', entry);
        return entry;
      }
    }

    return null;
  }

  /**
   * Attach to Docker container logs
   */
  async attachToContainer(container) {
    return new Promise((resolve, reject) => {
      container.logs(
        {
          follow: true,
          stdout: true,
          stderr: true,
          timestamps: true,
          tail: 0,
        },
        (err, stream) => {
          if (err) return reject(err);

          this.stream = stream;
          let buffer = '';

          stream.on('data', (chunk) => {
            // Docker multiplexes stdout/stderr with 8-byte header
            const data = chunk.toString();
            buffer += data;

            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
              if (line.trim()) {
                // Remove Docker timestamp prefix if present
                const cleanLine = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '');
                this.processLine(cleanLine);
              }
            }
          });

          stream.on('error', (err) => {
            this.emit('stream-error', err);
          });

          stream.on('end', () => {
            // Process any remaining buffer
            if (buffer.trim()) {
              this.processLine(buffer);
            }
            this.emit('stream-end');
          });

          resolve(stream);
        }
      );
    });
  }

  /**
   * Detach from container logs
   */
  detach() {
    if (this.stream) {
      this.stream.destroy();
      this.stream = null;
    }
  }

  /**
   * Check if any errors occurred
   */
  hasErrors() {
    return this.errors.length > 0;
  }

  /**
   * Check if any warnings occurred
   */
  hasWarnings() {
    return this.warnings.length > 0;
  }

  /**
   * Get errors for a specific phase
   */
  getPhaseErrors(phase) {
    return this.phaseErrors.get(phase) || [];
  }

  /**
   * Get warnings for a specific phase
   */
  getPhaseWarnings(phase) {
    return this.phaseWarnings.get(phase) || [];
  }

  /**
   * Get complete phase report
   */
  getPhaseReport(phase) {
    return {
      errors: this.phaseErrors.get(phase) || [],
      warnings: this.phaseWarnings.get(phase) || [],
      logs: this.phaseLogs.get(phase) || [],
    };
  }

  /**
   * Get summary of all phases
   */
  getSummary() {
    const phases = {};
    for (const [phase, errors] of this.phaseErrors.entries()) {
      phases[phase] = {
        errors: errors.length,
        warnings: this.phaseWarnings.get(phase)?.length || 0,
        logs: this.phaseLogs.get(phase)?.length || 0,
      };
    }

    return {
      totalErrors: this.errors.length,
      totalWarnings: this.warnings.length,
      totalLogs: this.allLogs.length,
      phases,
      firstError: this.errors[0] || null,
      criticalPhases: [...this.phaseErrors.entries()]
        .filter(([_, errors]) => errors.length > 0)
        .map(([phase]) => phase),
    };
  }

  /**
   * Generate markdown report
   */
  generateReport() {
    const summary = this.getSummary();
    let report = `# Log Analysis Report\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n\n`;

    report += `## Summary\n\n`;
    report += `| Metric | Count |\n`;
    report += `|--------|-------|\n`;
    report += `| Total Errors | ${summary.totalErrors} |\n`;
    report += `| Total Warnings | ${summary.totalWarnings} |\n`;
    report += `| Total Log Lines | ${summary.totalLogs} |\n`;
    report += `| Phases with Errors | ${summary.criticalPhases.length} |\n\n`;

    if (summary.totalErrors > 0) {
      report += `## ❌ Errors by Phase\n\n`;
      for (const [phase, errors] of this.phaseErrors.entries()) {
        if (errors.length > 0) {
          report += `### ${phase}\n\n`;
          report += `| Time | Message |\n`;
          report += `|------|--------|\n`;
          for (const e of errors.slice(0, 10)) {
            const msg = e.line.substring(0, 100).replace(/\|/g, '\\|');
            report += `| ${e.timestamp} | ${msg} |\n`;
          }
          if (errors.length > 10) {
            report += `\n*... and ${errors.length - 10} more errors*\n`;
          }
          report += '\n';
        }
      }
    }

    if (summary.totalWarnings > 0) {
      report += `## ⚠️ Warnings\n\n`;
      const uniqueWarnings = new Map();
      for (const w of this.warnings) {
        const key = w.line.substring(0, 50);
        if (!uniqueWarnings.has(key)) {
          uniqueWarnings.set(key, { ...w, count: 1 });
        } else {
          uniqueWarnings.get(key).count++;
        }
      }

      report += `| Warning | Count | Phase |\n`;
      report += `|---------|-------|-------|\n`;
      for (const [_, w] of [...uniqueWarnings.entries()].slice(0, 20)) {
        const msg = w.line.substring(0, 60).replace(/\|/g, '\\|');
        report += `| ${msg} | ${w.count} | ${w.phase} |\n`;
      }
      report += '\n';
    }

    report += `## Phase Summary\n\n`;
    report += `| Phase | Errors | Warnings | Log Lines |\n`;
    report += `|-------|--------|----------|----------|\n`;
    for (const [phase, data] of Object.entries(summary.phases)) {
      const status = data.errors > 0 ? '❌' : '✅';
      report += `| ${status} ${phase} | ${data.errors} | ${data.warnings} | ${data.logs} |\n`;
    }

    return report;
  }

  /**
   * Export logs to JSON
   */
  toJSON() {
    return {
      summary: this.getSummary(),
      errors: this.errors,
      warnings: this.warnings,
      phases: Object.fromEntries(
        [...this.phaseErrors.entries()].map(([phase, errors]) => [
          phase,
          {
            errors,
            warnings: this.phaseWarnings.get(phase) || [],
          },
        ])
      ),
    };
  }

  /**
   * Reset all data
   */
  reset() {
    this.errors = [];
    this.warnings = [];
    this.allLogs = [];
    this.phaseErrors.clear();
    this.phaseWarnings.clear();
    this.phaseLogs.clear();
    this.currentPhase = 'init';
  }
}

module.exports = { LogMonitor };
