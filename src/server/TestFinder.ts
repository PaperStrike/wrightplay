import fs from 'node:fs';
import path from 'node:path';
import { globby } from 'globby';
import globParent from 'glob-parent';

import '../common/utils/patchDisposable.js';
import EventEmitter from './utils/TypedEventEmitter.js';

export interface TestFinderOptions {
  patterns: string | readonly string[];
  cwd: string;
  watch?: boolean;
}

export interface TestFinderEventMap {
  change: [];
}

export default class TestFinder extends EventEmitter<TestFinderEventMap> implements Disposable {
  private readonly patterns: string | readonly string[];

  private readonly cwd: string;

  private readonly watch: boolean;

  private readonly patternDirs: string[] = [];

  private readonly patternWatcherMap = new Map<string, fs.FSWatcher>();

  constructor({
    patterns,
    cwd,
    watch = false,
  }: TestFinderOptions) {
    super();
    this.patterns = patterns.concat(); // clone
    this.cwd = cwd;
    this.watch = watch;

    if (!watch) return;

    // Parse pattern dirs to watch recursively
    let patternDirs: string[] = [];
    const patternList = (typeof patterns === 'string' ? [patterns] : patterns);
    patternList.forEach((pattern) => {
      // Skip negated patterns
      if (pattern.startsWith('!')) return;

      // Resolve its parent absolute dir path
      const candidateDir = path.resolve(cwd, globParent(pattern));

      // Skip if the pattern dir is already covered
      if (patternDirs.some((dir) => candidateDir.startsWith(dir))) return;

      // Remove dirs that will be covered by the candidate dir
      patternDirs = patternDirs.filter((dir) => !dir.startsWith(candidateDir));

      // Accept the candidate dir
      patternDirs.push(candidateDir);
    });

    this.patternDirs = patternDirs;

    // Create pattern watchers
    this.patternWatcherMap = new Map(
      Array.from(patternDirs, (dir) => {
        const watcher = fs.watch(dir, {
          persistent: false,
          recursive: true,
        });

        watcher.on('change', this.onChange);

        return [dir, watcher];
      }),
    );
  }

  private filesPromise = Promise.resolve<string[]>([]);

  private searchFiles() {
    return globby(this.patterns, {
      cwd: this.cwd,
      absolute: true,
      gitignore: true,
    });
  }

  /**
   * Update the test file list.
   *
   * In watch mode, this will be automatically called on file changes,
   * but you may still need to call this once for the initial file list.
   */
  updateFiles() {
    this.filesPromise = this.searchFiles().then((files) => {
      this.emit('change');
      return files;
    });
  }

  /**
   * Returns a promise that resolves to the list by the last `updateFiles` call.
   */
  getFiles() {
    return this.filesPromise;
  }

  private relevantWatcherMap = new Map<string, fs.FSWatcher>();

  /**
   * Set additional files to watch.
   * Each call will replace the previous provided files.
   */
  setRelevantFiles(files: string[]) {
    if (!this.watch) {
      throw new Error('Cannot set relevant files when not watching');
    }

    const lastWatcherMap = this.relevantWatcherMap;
    const watcherMap = new Map<string, fs.FSWatcher>();
    files.forEach((file) => {
      // Use the parent dir to reduce the number of watchers.
      const dir = path.dirname(path.resolve(this.cwd, file));

      let watcher = lastWatcherMap.get(dir);

      // reuse the existing watcher if possible
      if (watcher) {
        watcherMap.set(dir, watcher);
        lastWatcherMap.delete(dir);
        return;
      }

      // return if already watched by another relevant file
      if (watcherMap.has(dir)) {
        return;
      }

      // return if already watched by a pattern
      if (this.patternDirs.some((patternDir) => dir.startsWith(patternDir))) {
        return;
      }

      // create a new watcher if not watched by any other
      watcher = fs.watch(dir, {
        persistent: false,
        recursive: false, // Yap, not recursive.
      });

      watcher.on('change', this.onChange);

      watcherMap.set(dir, watcher);
    });

    lastWatcherMap.forEach((watcher) => {
      watcher.close();
    });

    this.relevantWatcherMap = watcherMap;
  }

  private atomicTimeoutId: NodeJS.Timeout | null = null;

  private onChange = () => {
    if (this.atomicTimeoutId !== null) {
      return;
    }

    this.atomicTimeoutId = setTimeout(() => {
      this.atomicTimeoutId = null;
      this.updateFiles();
    }, 100);
  };

  dispose() {
    if (!this.watch) return;

    this.patternWatcherMap.forEach((watcher) => {
      watcher.close();
    });

    this.relevantWatcherMap.forEach((watcher) => {
      watcher.close();
    });
  }

  [Symbol.dispose]() {
    return this.dispose();
  }
}
