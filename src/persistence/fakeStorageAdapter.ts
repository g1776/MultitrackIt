import type { MediaFile, ProjectSnapshot, ProjectStorageAdapter, ProjectSummary } from "./types";

/** In-memory storage adapter for tests: no real disk I/O. */
export class FakeProjectStorageAdapter implements ProjectStorageAdapter {
  private saved = new Map<string, { snapshot: ProjectSnapshot; media: MediaFile[] }>();

  async saveProject(snapshot: ProjectSnapshot, media: MediaFile[]): Promise<void> {
    this.saved.set(snapshot.id, { snapshot, media });
  }

  async loadProject(id: string): Promise<{ snapshot: ProjectSnapshot; media: MediaFile[] } | null> {
    return this.saved.get(id) ?? null;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return Array.from(this.saved.values()).map(({ snapshot }) => ({
      id: snapshot.id,
      name: snapshot.name,
      updatedAt: snapshot.createdAt,
    }));
  }
}
