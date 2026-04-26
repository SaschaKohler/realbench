import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

export interface BinaryValidation {
  isValid: boolean;
  reason?: string;
}

/**
 * Validate that the uploaded buffer is a profilable native binary.
 * The profiling worker runs on Linux — only ELF binaries are supported.
 * Rejected: Mach-O, PE/COFF, scripts, archives, ZIP/JAR/WASM, plain text, etc.
 */
export function isProfilableBinary(buffer: Buffer): BinaryValidation {
  if (buffer.length < 4) {
    return { isValid: false, reason: 'File is too small to be a valid binary.' };
  }

  // ELF: 0x7f 'E' 'L' 'F' — the only supported format (profiler runs on Linux)
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return { isValid: true };
  }

  // Mach-O: macOS binaries — not supported, profiler runs on Linux
  const magic32 = buffer.readUInt32BE(0);
  if (
    magic32 === 0xfeedface ||
    magic32 === 0xfeedfacf ||
    magic32 === 0xcafebabe ||
    magic32 === 0xcefaedfe ||
    magic32 === 0xcffaedfe
  ) {
    return { isValid: false, reason: 'Mach-O (macOS) binaries are not supported. The profiler runs on Linux — upload an ELF binary compiled for Linux.' };
  }

  // PE/COFF (Windows): 'M' 'Z' — not supported
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return { isValid: false, reason: 'PE/COFF (Windows) binaries are not supported. The profiler runs on Linux — upload an ELF binary compiled for Linux.' };
  }

  // Shell scripts / text files
  if (buffer[0] === 0x23 && buffer[1] === 0x21) {
    return { isValid: false, reason: 'Script files (shebang) are not profilable. Upload a compiled ELF binary (Linux).' };
  }
  // ZIP / JAR / APK (PK magic)
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return { isValid: false, reason: 'ZIP/JAR/APK archives are not profilable. Upload a compiled ELF binary (Linux).' };
  }
  // WebAssembly: 0x00 'a' 's' 'm'
  if (buffer[0] === 0x00 && buffer[1] === 0x61 && buffer[2] === 0x73 && buffer[3] === 0x6d) {
    return { isValid: false, reason: 'WebAssembly binaries are not supported. Upload a native ELF binary compiled for Linux.' };
  }
  // gzip / tar.gz
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return { isValid: false, reason: 'Compressed archives are not profilable. Upload the uncompressed ELF binary.' };
  }
  // Plain text (printable ASCII start)
  if (buffer[0] >= 0x20 && buffer[0] < 0x7f) {
    return { isValid: false, reason: 'Text files are not profilable. Upload a compiled ELF binary (Linux).' };
  }

  return {
    isValid: false,
    reason: 'Unrecognized file format. Upload a compiled ELF binary for Linux (e.g. built with gcc/clang/cargo/go build on Linux or cross-compiled for Linux).',
  };
}

export interface BinaryAnalysis {
  hasDebugSymbols: boolean;
  hasLineInfo: boolean;
  buildType: 'debug' | 'release' | 'relwithdebinfo' | 'unknown';
  compiler: string | null;
  optimizationLevel: string | null;
  symbolCount: number;
  warnings: string[];
}

/**
 * Analyze a binary to detect debug symbols and build configuration.
 */
export async function analyzeBinary(binaryBuffer: Buffer, filename: string): Promise<BinaryAnalysis> {
  const tempPath = join(tmpdir(), `realbench-analyze-${Date.now()}-${filename}`);

  try {
    await writeFile(tempPath, binaryBuffer);
    return await analyzeBinaryAtPath(tempPath, filename);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

async function analyzeBinaryAtPath(binaryPath: string, _filename: string): Promise<BinaryAnalysis> {
  const analysis: BinaryAnalysis = {
    hasDebugSymbols: false,
    hasLineInfo: false,
    buildType: 'unknown',
    compiler: null,
    optimizationLevel: null,
    symbolCount: 0,
    warnings: [],
  };

  try {
    // Check for debug symbols using readelf
    const { stdout: sectionInfo } = await execFileAsync('readelf', ['-S', binaryPath], { timeout: 10000 })
      .catch(() => ({ stdout: '' }));

    // Look for debug sections
    const debugSections = [
      '.debug_info',
      '.debug_line',
      '.debug_str',
      '.debug_ranges',
      '.zdebug_info',   // compressed
      '.zdebug_line',
    ];

    for (const section of debugSections) {
      if (sectionInfo.includes(section)) {
        analysis.hasDebugSymbols = true;
        if (section.includes('line')) {
          analysis.hasLineInfo = true;
        }
      }
    }

    // Count symbols
    const { stdout: symInfo } = await execFileAsync('nm', ['-C', '--format=posix', binaryPath], { timeout: 10000 })
      .catch(() => ({ stdout: '' }));
    analysis.symbolCount = symInfo.trim().split('\n').filter(l => l.trim()).length;

    // Check for debug symbols in symbol table
    if (!analysis.hasDebugSymbols && symInfo.includes(' ')) {
      // Has some symbols but may be stripped
      analysis.warnings.push('Binary has limited symbols. File/line info may not be available.');
    }

    // Detect build type from symbols and sections — resolved later after strings scan

    // Try to detect compiler
    const { stdout: noteInfo } = await execFileAsync('readelf', ['-n', binaryPath], { timeout: 10000 })
      .catch(() => ({ stdout: '' }));

    if (noteInfo.includes('GCC')) {
      analysis.compiler = 'gcc';
    } else if (noteInfo.includes('Clang') || noteInfo.includes('clang')) {
      analysis.compiler = 'clang';
    } else if (noteInfo.includes('rustc')) {
      analysis.compiler = 'rustc';
    }

    // Detect optimization from string table
    const { stdout: stringInfo } = await execFileAsync('strings', [binaryPath], { timeout: 10000 })
      .catch(() => ({ stdout: '' }));

    if (stringInfo.includes('-O0')) {
      analysis.optimizationLevel = '-O0';
    } else if (stringInfo.includes('-O3')) {
      analysis.optimizationLevel = '-O3';
    } else if (stringInfo.includes('-O2')) {
      analysis.optimizationLevel = '-O2';
    } else if (stringInfo.includes('-O1')) {
      analysis.optimizationLevel = '-O1';
    }

    // Resolve build type: combine debug-section presence with optimization level
    const hasDebugSections = sectionInfo.includes('.debug_info') || sectionInfo.includes('.zdebug_info');
    const isOptimized = analysis.optimizationLevel !== null && analysis.optimizationLevel !== '-O0';
    const isSanitized = symInfo.includes('__ubsan') || symInfo.includes('__asan');

    if (hasDebugSections) {
      if (isSanitized || analysis.optimizationLevel === '-O0') {
        analysis.buildType = 'debug';
      } else if (isOptimized) {
        analysis.buildType = 'relwithdebinfo';
      } else {
        analysis.buildType = 'debug';
      }
    } else if (analysis.symbolCount > 0) {
      analysis.buildType = 'release';
    }

  } catch (error) {
    analysis.warnings.push(`Binary analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Generate appropriate warnings
  if (!analysis.hasDebugSymbols) {
    analysis.warnings.push(
      'No debug symbols detected. Rebuild with `-g` flag for source-level analysis and file/line information.'
    );
  } else if (!analysis.hasLineInfo) {
    analysis.warnings.push(
      'Debug symbols present but line information may be incomplete. File/line accuracy reduced.'
    );
  }

  if ((analysis.buildType === 'release' || analysis.buildType === 'unknown') && !analysis.hasDebugSymbols) {
    analysis.warnings.push(
      'Release build without debug symbols. You will see function names but not source locations. ' +
      'For development profiling, consider: `cmake -DCMAKE_BUILD_TYPE=RelWithDebInfo` or ' +
      '`g++ -O2 -g`'
    );
  }

  return analysis;
}

/**
 * Get recommendations for building with debug symbols based on detected/deduced language.
 */
export function getDebugBuildInstructions(language: 'cpp' | 'rust' | 'go' | string): string {
  const instructions: Record<string, string> = {
    cpp: `Build with debug symbols:
  CMake: cmake -DCMAKE_BUILD_TYPE=RelWithDebInfo .
  g++/clang++: g++ -O2 -g -ggdb3 main.cpp -o myapp
  
For best profiling results, use RelWithDebInfo (optimized with debug info).`,

    rust: `Build with debug symbols:
  Cargo: cargo build --profile release-with-debug
  
  # Add to Cargo.toml:
  [profile.release-with-debug]
  inherits = "release"
  debug = true
  
Or use: RUSTFLAGS="-C debuginfo=2" cargo build --release`,

    go: `Build with debug symbols:
  go build -gcflags="all=-N -l" -o myapp
  
For profiling: go build -o myapp (symbols included by default in recent Go versions)`,
  };

  return instructions[language] || instructions.cpp;
}
