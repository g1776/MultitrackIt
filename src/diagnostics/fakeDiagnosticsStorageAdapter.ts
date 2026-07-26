import { reportFileName } from "./report";
import type { DiagnosticsReport, DiagnosticsStorageAdapter } from "./types";

/**
 * In-memory diagnostics storage for tests: no real disk I/O. Reports are
 * held as the JSON text that would have been written rather than as live
 * objects, so a round trip through this fake exercises the same
 * serialization the real adapter does instead of trivially handing back the
 * caller's own object.
 */
export class FakeDiagnosticsStorageAdapter implements DiagnosticsStorageAdapter {
  private written = new Map<string, string>();

  async writeReport(report: DiagnosticsReport): Promise<string> {
    const path = reportFileName(report.createdAt);
    this.written.set(path, JSON.stringify(report, null, 2));
    return path;
  }

  readReport(path: string): DiagnosticsReport | null {
    const raw = this.written.get(path);
    return raw ? (JSON.parse(raw) as DiagnosticsReport) : null;
  }

  writtenPaths(): string[] {
    return Array.from(this.written.keys());
  }
}
