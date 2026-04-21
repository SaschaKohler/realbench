# RealBench Profiler – Lehrbuch Teil 1: Grundlagen
# Kapitel: Was ist ein Profiler · Architektur · ELF · Runtime-Detection

---

## 1. Was ist ein Profiler?

### Das Grundprinzip

Stell dir vor, dein Programm ist ein Koch der 100 Gerichte gleichzeitig zubereitet.
Du willst wissen: Womit verbringt er die meiste Zeit?

Ein Profiler ist die Stoppuhr dafür. Er misst **welche Funktion wie viel CPU-Zeit
verbraucht** und liefert eine sortierte Rangliste — die sogenannten **Hotspots**.

### Zwei fundamentale Ansätze

```
SAMPLING (statistisch)              INSTRUMENTATION (exakt)
────────────────────────────        ────────────────────────────
Alle N ms fragt der Profiler:       Vor jede CPU-Instruktion wird
"Wo ist das Programm gerade?"       Zählcode eingefügt.

t=0ms  → main() läuft              main():    0 IR (kein eigener Aufwand)
t=10ms → sort() läuft              sort():    1.200.000 IR
t=20ms → sort() läuft              memcpy():    450.000 IR
t=30ms → main() läuft

Ergebnis (statistisch):             Ergebnis (exakt):
  sort() = 50 % der Zeit              sort()   = 72,7 %
  main() = 50 % der Zeit              memcpy() = 27,3 %

Overhead: 1–5 %                     Overhead: 10–50× langsamer
Tool: perf   (AKTUELL im Code)      Tool: callgrind (ALT, noch im Code)
```

**RealBench nutzt heute `perf`** — den Linux-Kernel-Sampling-Profiler.
Callgrind-Code existiert noch (`profile_binary_callgrind()` +
`parse_callgrind_output()`), ist aber kein aktiver Pfad mehr in `profile_binary()`.

### Was bedeutet "IR"?

**IR = Instruction Reference** = eine einzelne CPU-Instruktion die ausgeführt wird.
`add eax, 1` ist eine IR. `mov [rbp-8], rax` ist eine IR.
Bei `perf` verwenden wir **Samples** statt IR — Zeitpunkte wo nachgeschaut wird.
Im Code heißt das Feld historisch bedingt trotzdem noch `ir` und `total_ir`.

### self vs. total — der wichtigste Unterschied

```
Aufruf-Baum:
  main()          total=100, self=5    ← main wartet fast nur auf andere
    ├── sort()    total=70,  self=70   ← sort tut alles selbst
    └── print()   total=25,  self=5
          └── write()  total=20, self=20

self:  Samples wo DIESE Funktion ganz oben im Stack war (echte CPU-Zeit)
total: self + alles was von hier aus weiter unten im Stack lief
```

---

## 2. Architektur-Übersicht

### Die Schichten (Skizze)

```
┌─────────────────────────────────────────────────────┐
│              FRONTEND / WEB UI                       │
│   zeigt SVG-Flamegraph an (aus S3-URL)               │
└────────────────────┬────────────────────────────────┘
                     │  HTTP
┌────────────────────▼────────────────────────────────┐
│     apps/api – TypeScript Backend                    │
│     profiling-worker.ts – verarbeitet pg-boss Jobs   │
└────────────────────┬────────────────────────────────┘
                     │  await profileBinary(path, opts)
┌────────────────────▼────────────────────────────────┐
│     lib/profiler/index.js – ProfilerClient (JS)      │
│     runInWorker() – neuer Worker Thread pro Job      │
└────────────────────┬────────────────────────────────┘
                     │  workerData + postMessage
┌────────────────────▼────────────────────────────────┐
│     profiler_worker.js – Worker Thread               │
│     require('profiler.node')                         │
│     profiler.profileBinary(path)   ← BLOCKIERT HIER │
└────────────────────┬────────────────────────────────┘
                     │  N-API Funktionsaufruf
┌────────────────────▼────────────────────────────────┐
│     bindings/node_addon.cpp – ProfilerWrapper        │
│     JS-Typen → C++-Typen → ProfileResult → JS-Objekt│
└────────────────────┬────────────────────────────────┘
                     │  C++ Methodenaufruf
┌────────────────────▼────────────────────────────────┐
│     src/sampler.cpp – Profiler::Impl                 │
│                                                      │
│  1. detect_binary_runtime()  ← ELF-Header lesen     │
│  2. profile_binary_perf()    ← perf record+script   │
│  3. parse_perf_script_output() ← Stacks parsen      │
│  4. resolve_addrs_with_addr2line() ← Namen lösen    │
│  5. demangle_rust()          ← Rust-Namen lesbar    │
│  6. build_result()           ← FnCost→ProfileResult │
└──────┬─────────────────┬──────────────┬─────────────┘
       │                 │              │
       ▼                 ▼              ▼
flamegraph.cpp       diff.cpp    symbol_resolver.cpp
SVG + JSON           Vergleich   ELF direkt lesen
```

### Datei-Übersicht

| Datei | Aufgabe |
|---|---|
| `include/profiler.h` | Öffentliches Interface — alle Structs und die Profiler-Klasse |
| `src/sampler.cpp` | Das Herzstück — perf starten, parsen, build_result |
| `src/flamegraph.cpp` | SVG + JSON-Generierung aus ProfileResult |
| `src/diff.cpp` | Zwei Profile vergleichen (Regression/Improvement) |
| `src/symbol_resolver.cpp` | ELF-Symbole direkt lesen (für profile_pid) |
| `bindings/node_addon.cpp` | C++ ↔ Node.js Brücke via N-API |
| `index.js` | Öffentliche JS-API + Worker-Thread-Management |
| `profiler_worker.js` | Blocking-Call in eigenem Thread, Timeout-Failsafe |
| `binding.gyp` | Build-Rezept für node-gyp (kompiliert das C++ zu .node) |

---

## 3. Das ELF-Format

### Was ist ELF?

**ELF = Executable and Linkable Format** — das Binärformat auf Linux.
Jede kompilierte Executable, jede `.so`-Bibliothek ist intern so aufgebaut.
macOS nutzt Mach-O, Windows PE — aber in unserem Docker-Worker läuft Linux.

### ELF-Aufbau (Skizze)

```
Anfang der Datei                                     Ende
│                                                      │
▼                                                      ▼
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ELF Header│  .text   │  .data   │ .symtab  │.debug_*  │
│ (64 B)   │ (Code)   │ (Daten)  │ (Symbole)│ (DWARF)  │
└──────────┴──────────┴──────────┴──────────┴──────────┘
                 ▲
                 └── Section Header Tabelle (Verzeichnis aller Sections)
                     ab Offset shoff, shnum Einträge à shentsize Bytes

ELF Header (wichtige Felder für uns):
  Bytes  0– 3:  Magic 0x7F 'E' 'L' 'F'   ← Erkennungszeichen
  Byte      4:  ELFCLASS64 = 64-Bit-Binary
  Bytes 40–47:  shoff     = Offset der Section Header Tabelle
  Bytes 58–59:  shentsize = Größe eines Section Headers (64 Bytes)
  Bytes 60–61:  shnum     = Anzahl Sections
  Bytes 62–63:  shstrndx  = Index der String-Section (Namentabelle)

Interessante Sections:
  .text         → Maschinencode (ausführbarer Code)
  .symtab       → Symboltabelle (Name → Adresse)
  .strtab       → Strings (die eigentlichen Textnamen der Symbole)
  .debug_info   → DWARF (Datei:Zeile-Info für Debugger und addr2line)
  .go.buildinfo → Nur in Go-Binaries
  .rustc        → Nur in Rust-Binaries
```

### Warum `memcpy` statt direktem Cast?

```cpp
// RICHTIG:
uint64_t shoff;
memcpy(&shoff, ehdr + 40, 8);

// FALSCH — Undefined Behavior auf manchen Architekturen:
// uint64_t shoff = *reinterpret_cast<uint64_t*>(ehdr + 40);
```

Der `ehdr[]`-Puffer liegt im RAM nicht garantiert auf einer 8-Byte-Grenze.
Ein direkter `uint64_t`-Cast auf `ehdr+40` löst auf SPARC/MIPS einen **Bus Error**
(SIGBUS) aus. `memcpy` kopiert byteweise — immer sicher.
Das ist ein klassisches **Alignment-Problem**: primitive Typen müssen auf ihrer
eigenen Größe ausgerichtet sein (uint64_t → 8 Bytes).

---

## 4. Runtime-Detection — Go, Rust oder Native?

### Das Problem: verschiedene Sprachen, verschiedene Stacks

`perf` muss wissen wie es den Call-Stack "entrollt" (unwindet), wenn ein Sample
genommen wird. Das hängt von der Zielsprache ab:

```
Sprache    Stack-Unwinding-Methode  Warum
─────────  ───────────────────────  ──────────────────────────────────────
C++/Rust   DWARF                   Compiler optimiert Frame-Pointer weg
Go         Frame-Pointer (fp)      Go bewahrt explizit den Frame-Pointer
```

**Frame-Pointer** = Register RBP (x86-64) zeigt immer auf den Anfang des aktuellen
Stack-Frames. Mit ihm kann man den Stack wie eine verkettete Liste rückwärts
durchgehen: aktueller Frame → vorheriger Frame → ... → main.

**DWARF** = Debug-Informations-Format das im `.debug_info`-Abschnitt des ELF-Binaries
steckt. Enthält präzise Anweisungen wie der Stack ohne Frame-Pointer rekonstruierbar ist.
Wird von `addr2line`, gdb, lldb genutzt.

### Der Code: detect_binary_runtime (sampler.cpp:128)

```cpp
static BinaryRuntime detect_binary_runtime(const std::string &path) {
  std::ifstream f(path, std::ios::binary);
  if (!f) return BinaryRuntime::UNKNOWN;

  unsigned char ehdr[64];
  if (!f.read(reinterpret_cast<char *>(ehdr), sizeof(ehdr)))
    return BinaryRuntime::UNKNOWN;

  // 1. Magic Number prüfen
  if (ehdr[0] != 0x7f || ehdr[1] != 'E' || ehdr[2] != 'L' || ehdr[3] != 'F')
    return BinaryRuntime::UNKNOWN;   // kein ELF → unbekannt

  // 2. Section Header Tabellen-Position aus dem Header lesen
  uint64_t shoff = 0; uint16_t shentsize = 0, shnum = 0, shstrndx = 0;
  memcpy(&shoff,     ehdr + 40, 8);   // Offset der Tabelle
  memcpy(&shentsize, ehdr + 58, 2);   // Größe eines Eintrags
  memcpy(&shnum,     ehdr + 60, 2);   // Anzahl Einträge
  memcpy(&shstrndx,  ehdr + 62, 2);   // Index der Namentabellen-Section

  // 3. String-Tabelle laden (enthält alle Section-Namen als Text)
  // → springe zur shstrndx-ten Section, lese deren Offset+Größe,
  //   lade den kompletten Strings-Block in RAM
  f.seekg(shoff + shstrndx * shentsize);
  unsigned char shdr[64]; f.read(...);
  // strtab = kompletter Block mit allen Section-Namen (NUL-getrennt)

  // 4. Alle Sections durchgehen, Namen prüfen
  bool has_go = false, has_rust = false;
  for (int i = 0; i < shnum; ++i) {
    std::string sname = strtab.c_str() + name_idx;
    if (sname == ".go.buildinfo" || sname == ".gosymtab")  has_go   = true;
    if (sname == ".rustc")                                  has_rust = true;
  }

  if (has_go)   return BinaryRuntime::GO;
  if (has_rust) return BinaryRuntime::RUST;
  return BinaryRuntime::NATIVE;   // C++ oder anderes
}
```

### Skizze: Wie Section-Namen gefunden werden

```
strtab[] (ein langer String-Puffer):
Byte:  0    6   11   20   33   ...
       │    │    │    │    │
       [NUL][.text NUL][.data NUL][.go.buildinfo NUL]...

Jeder Section Header hat ein Feld name_idx = Offset in strtab[].
strtab.c_str() + name_idx  →  liefert den C-String des Section-Namens.

Wir suchen: ".go.buildinfo" → GO
            ".rustc"        → RUST
            sonst           → NATIVE
```

### Wozu brauchen wir das Ergebnis?

Direkt in `profile_binary_perf()` (sampler.cpp:802):

```cpp
BinaryRuntime rt = detect_binary_runtime(binary_path);
cmd.push_back("--call-graph");
if (rt == BinaryRuntime::GO)
    cmd.push_back("fp");           // Frame-Pointer für Go
else
    cmd.push_back("dwarf,65528");  // DWARF für C++/Rust
```

Und in `build_result()` (sampler.cpp:684):

```cpp
if (rt == BinaryRuntime::RUST)
    c.name = demangle_rust(c.name);   // Rust-Symbole lesbar machen
// C++ → bereits von addr2line -C demangled
// Go  → kein Demangling nötig
```

---

## Schlüssel-Konzepte aus Teil 1

| Begriff | Kurzdefinition |
|---|---|
| **Sampling** | Profiler schaut in festen Abständen rein — statistisch, sehr geringer Overhead |
| **Instrumentation** | Zählcode um jede Instruktion — exakt, aber 10–50× langsamer |
| **ELF** | Binärformat auf Linux; besteht aus Header + Sections |
| **Section** | Abschnitt im ELF-Binary (`.text`, `.debug_info`, `.go.buildinfo`, …) |
| **DWARF** | Debug-Info-Format in `.debug_*`-Sections; ermöglicht Stack-Unwinding ohne Frame-Pointer |
| **Frame-Pointer** | Register (RBP) das immer auf den aktuellen Stack-Frame zeigt; Go bewahrt ihn |
| **BinaryRuntime** | Enum: `NATIVE` / `GO` / `RUST` — bestimmt perf call-graph Strategie |
| **memcpy-Trick** | Sicheres Lesen unalignierter Felder aus einem Byte-Puffer |

---
*Weiter in LEHRBUCH_2_Kern.md: perf, addr2line, Demangling, build_result, Flamegraph, Diff*
