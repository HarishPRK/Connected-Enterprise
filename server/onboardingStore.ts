import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OnboardingDatabase } from './onboardingTypes.js';

export interface OnboardingRepository {
  load(): Promise<OnboardingDatabase | undefined>;
  save(database: OnboardingDatabase): Promise<void>;
}

export class MemoryOnboardingRepository implements OnboardingRepository {
  private database?: OnboardingDatabase;

  constructor(seed?: OnboardingDatabase) {
    this.database = seed ? structuredClone(seed) : undefined;
  }

  async load(): Promise<OnboardingDatabase | undefined> {
    return this.database ? structuredClone(this.database) : undefined;
  }

  async save(database: OnboardingDatabase): Promise<void> {
    this.database = structuredClone(database);
  }
}

export class FileOnboardingRepository implements OnboardingRepository {
  constructor(private readonly filePath: string) {}

  async load(): Promise<OnboardingDatabase | undefined> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as OnboardingDatabase;
      if (parsed.schemaVersion !== 1 || typeof parsed.tenants !== 'object') {
        throw new Error('Unsupported onboarding database schema');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(database: OnboardingDatabase): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
