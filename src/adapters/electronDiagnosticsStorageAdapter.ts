import { reportFileName } from "../diagnostics/report";
import type { DiagnosticsReport, DiagnosticsStorageAdapter } from "../diagnostics/types";

/** The IPC surface `electron/preload.ts` exposes on `window.diagnosticsStorage`. */
export interface DiagnosticsStorageBridge {
  /** Writes `report` as JSON under the repo-root diagnostics directory, returning its repo-relative path. */
  writeReport(fileName: string, report: DiagnosticsReport): Promise<string>;
}

declare global {
  interface Window {
    diagnosticsStorage: DiagnosticsStorageBridge;
  }
}

/**
 * Real diagnostics storage, backed by Electron main-process filesystem
 * access via the `window.diagnosticsStorage` IPC bridge — mirroring
 * `ElectronProjectStorageAdapter` over its own channel (see ADR 0004 for why
 * the two are kept apart). The file name is chosen here rather than in the
 * main process, so what a report is called stays with the code that knows
 * what a report is.
 */
export class ElectronDiagnosticsStorageAdapter implements DiagnosticsStorageAdapter {
  writeReport(report: DiagnosticsReport): Promise<string> {
    return window.diagnosticsStorage.writeReport(reportFileName(report.createdAt), report);
  }
}
