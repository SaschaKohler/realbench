import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Hotspot } from '@realbench/shared';

export interface SourceSnippet {
  symbol: string;
  file: string;
  line: number;
  context: string; // The actual source code lines
  contextStartLine: number;
  contextEndLine: number;
  language: string;
}

export interface SourceExtractionConfig {
  // Root directories to search for source files
  sourceRoots: string[];
  // Number of lines of context to include before/after the hotspot line
  contextLines: number;
  // Maximum file size to read (in bytes)
  maxFileSize: number;
}

const DEFAULT_CONFIG: SourceExtractionConfig = {
  sourceRoots: [
    process.env.SOURCE_ROOT || '/app/source',
    process.cwd(),
  ],
  contextLines: 8,
  maxFileSize: 1024 * 1024, // 1MB
};

/**
 * Extract source code snippets for hotspots that have file/line information.
 * Returns snippets only for files that can be found and read.
 */
export async function extractSourceSnippets(
  hotspots: Hotspot[],
  language: string,
  config: Partial<SourceExtractionConfig> = {}
): Promise<SourceSnippet[]> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const snippets: SourceSnippet[] = [];

  for (const hotspot of hotspots) {
    // Skip hotspots without file/line info
    if (!hotspot.file || hotspot.file === 'unknown' || !hotspot.line || hotspot.line <= 0) {
      continue;
    }

    const snippet = await extractSnippetForHotspot(hotspot, language, mergedConfig);
    if (snippet) {
      snippets.push(snippet);
    }
  }

  return snippets;
}

async function extractSnippetForHotspot(
  hotspot: Hotspot,
  language: string,
  config: SourceExtractionConfig
): Promise<SourceSnippet | null> {
  if (!hotspot.file || !hotspot.line) {
    return null;
  }

  const filePath = await findSourceFile(hotspot.file, config.sourceRoots);
  if (!filePath) {
    return null;
  }

  try {
    const content = await readSourceFile(filePath, config.maxFileSize);
    if (!content) {
      return null;
    }

    const lines = content.split('\n');
    const totalLines = lines.length;
    const lineNumber = hotspot.line;

    if (lineNumber > totalLines) {
      return null;
    }

    // Calculate context range
    const contextStart = Math.max(1, lineNumber - config.contextLines);
    const contextEnd = Math.min(totalLines, lineNumber + config.contextLines);

    // Extract the context lines (0-indexed array)
    const contextLines_array = lines.slice(contextStart - 1, contextEnd);

    // Add line numbers to each line for better LLM understanding
    const numberedLines = contextLines_array.map((line, idx) => {
      const lineNum = contextStart + idx;
      const marker = lineNum === lineNumber ? '>>>' : '   ';
      return `${marker} ${lineNum.toString().padStart(4)} | ${line}`;
    });

    return {
      symbol: hotspot.symbol,
      file: hotspot.file,
      line: lineNumber,
      context: numberedLines.join('\n'),
      contextStartLine: contextStart,
      contextEndLine: contextEnd,
      language,
    };
  } catch (error) {
    console.warn(`Failed to extract source for ${hotspot.symbol} @ ${hotspot.file}:${hotspot.line}:`, error);
    return null;
  }
}

async function findSourceFile(filePath: string, sourceRoots: string[]): Promise<string | null> {
  // Try the path as-is first
  if (existsSync(filePath)) {
    return filePath;
  }

  // Try basename only (in case the path is absolute from build machine)
  const basename = filePath.split('/').pop();
  if (!basename) {
    return null;
  }

  // Search in each source root
  for (const root of sourceRoots) {
    // Try direct join
    const directPath = join(root, filePath);
    if (existsSync(directPath)) {
      return directPath;
    }

    // Try basename in root
    const basenamePath = join(root, basename);
    if (existsSync(basenamePath)) {
      return basenamePath;
    }

    // Try to find by basename recursively (limited depth)
    const found = await findFileByName(root, basename, 3);
    if (found) {
      return found;
    }
  }

  return null;
}

async function findFileByName(
  dir: string,
  filename: string,
  maxDepth: number
): Promise<string | null> {
  if (maxDepth <= 0) {
    return null;
  }

  try {
    const entries = await import('fs/promises').then(fs => fs.readdir(dir, { withFileTypes: true }));

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isFile() && entry.name === filename) {
        return fullPath;
      }

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        const found = await findFileByName(fullPath, filename, maxDepth - 1);
        if (found) {
          return found;
        }
      }
    }
  } catch {
    // Directory not readable, skip
  }

  return null;
}

async function readSourceFile(filePath: string, maxSize: number): Promise<string | null> {
  try {
    const { size } = await import('fs/promises').then(fs => fs.stat(filePath));

    if (size > maxSize) {
      console.warn(`Source file ${filePath} too large (${size} bytes), skipping`);
      return null;
    }

    const content = await readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.warn(`Failed to read source file ${filePath}:`, error);
    return null;
  }
}

/**
 * Check if a file path looks like a test file
 */
export function isTestFile(filePath: string): boolean {
  const testPatterns = [
    /test/i,
    /spec/i,
    /benchmark/i,
    /_test\./,
    /\.test\./,
    /_spec\./,
    /\.spec\./,
  ];

  return testPatterns.some(pattern => pattern.test(filePath));
}
