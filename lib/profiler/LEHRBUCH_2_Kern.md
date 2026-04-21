# RealBench Profiler – Lehrbuch Teil 2: Der C++ Kern
# Kapitel: perf · addr2line · Demangling · Callgrind · build_result · Flamegraph · Diff

---

## 5. perf — Der Kern des Profilers

### Was ist perf?

`perf` ist ein Linux-Kernel-Tool das **Hardware Performance Counter** nutzt.
Jeder moderne CPU-Chip hat eingebaute Zähler. Der Kernel kann sie abfragen.
Bei jedem N-ten CPU-Zyklus löst der Kernel einen **Interrupt** aus, schaut welche
Adresse gerade lief, und notiert: "Gerade war Funktion X aktiv."

Kein Code wird instrumentiert. Der Prozess läuft normal — perf schaut nur rein.

### Der zweistufige perf-Workflow

```
SCHRITT 1: perf record — Daten sammeln
═══════════════════════════════════════
perf record -F 99 -g --call-graph dwarf,65528 -m 16M -o /tmp/perf_data -- /binary

  -F 99              99 Samples/Sekunde (Primzahl → keine Timer-Resonanz)
  -g                 Call-Graph aufzeichnen (ganzen Stack, nicht nur Leaf)
  --call-graph       Stack-Unwinding-Methode:
    dwarf,65528        DWARF-basiert, 65528 Bytes Stack-Snapshot pro Sample
    fp                 Frame-Pointer-basiert (für Go)
  -m 16M             16 MB Ring-Buffer im Kernel (mmap-basiert, kein Kopieren)
  --user-callchains  kein Kernel-Stack (wenn include_kernel = false)
  -o /tmp/perf_data  Ausgabe in binäre Datei (proprietäres Format)

  Für PID-Profiling: -p <pid> --duration <sek>  statt  -- <binary>

Ergebnis: /tmp/perf_data.PID  (binär, kann hunderte MB groß sein)


SCHRITT 2: perf script — Binärdaten → lesbaren Text
════════════════════════════════════════════════════
perf script -i /tmp/perf_data.PID

  Konvertiert die binäre Datei in menschenlesbaren Text:

  myprogram 12345/12345 [001] 123.456789: 1 cycles:u:
          7f3a00001234 sort_impl (/path/to/myprogram)
          7f3a00000890 sort (/path/to/myprogram)
          7f3a00000100 main (/path/to/myprogram)
  <Leerzeile = nächster Sample>
  myprogram 12345/12345 [001] 123.467890: 1 cycles:u:
          7f3a00001248 sort_impl (/path/to/myprogram)
          ...

  Jeder Block = 1 Sample.
  Erster eingerückter Frame = Leaf (wo die CPU gerade war).
  Danach: von innen nach außen (wer hat wen aufgerufen).
```

### Warum 99 Hz und nicht 100 Hz?

Linux hatte historisch HZ=100 (100 Kernel-Timer-Interrupts/Sekunde).
Bei exakt 100 Hz würde man immer zum gleichen Zeitpunkt samplen wie der Timer.
Falls dein Programm an dieser Stelle zufällig dasselbe tut, entsteht ein massiver
Bias. 99 Hz ist eine Primzahl-nahe Frequenz — keine Resonanz mit dem Timer.

### Der Code: profile_binary_perf (sampler.cpp:797)

```cpp
void profile_binary_perf(const std::string &binary_path,
                         const std::vector<std::string> &args,
                         const std::string &perf_data,   // Ausgabedatei
                         const std::string &script_out)  // Text-Ausgabe
{
  BinaryRuntime rt = detect_binary_runtime(binary_path);

  // ── SCHRITT 1: perf record ───────────────────────────────────────────
  {
    std::vector<std::string> cmd = {
      "perf", "record",
      "-F", std::to_string(config_.frequency_hz),
      "-g",
      "--call-graph", (rt == BinaryRuntime::GO) ? "fp" : "dwarf,65528",
      "-m", "16M",
      "-o", perf_data,   // Ausgabedatei
      "--",              // Trennzeichen: danach das zu profilierende Programm
      binary_path
    };
    // args aus ProfilerClient werden angehängt
    int rc = run_and_wait(cmd);   // fork + exec + waitpid
    if (rc == 127)
      throw ProfilerException("perf not found – please install linux-perf");
  }

  // ── SCHRITT 2: perf script ───────────────────────────────────────────
  // Output kann sehr groß sein → nicht in RAM-Buffer, direkt in Datei
  {
    // fork + exec + pipe: stdout von perf script in script_out schreiben
    // (Detailliertes fork/pipe/exec Pattern → siehe Kapitel Unix-IPC in Teil 3)
    int pipefd[2]; pipe(pipefd);
    pid_t child = fork();
    if (child == 0) {
      dup2(pipefd[1], STDOUT_FILENO);
      execvp("perf", ...);
    }
    // Parent: aus pipe lesen, in Datei schreiben
    FILE *out = fopen(script_out.c_str(), "w");
    while ((n = read(pipefd[0], buf, sizeof(buf))) > 0)
      fwrite(buf, 1, n, out);
    waitpid(child, &status, 0);
  }
}
```

### Ring-Buffer (-m 16M) — warum?

perf speichert Samples zunächst in einem **Ring-Buffer im Kernel-Speicher**,
auf den der Userspace per `mmap` zugreift (kein Syscall pro Sample nötig).
16 MB ist groß genug für typische Profile. Ist der Buffer voll, werden älteste
Samples überschrieben — deshalb sollte die Profiling-Dauer nicht zu lang sein.

---

## 6. Symbol-Auflösung mit addr2line

### Das Problem: perf liefert rohe Adressen

`perf script` gibt z.B. aus:
```
7f3a00001234 sort_impl+0x3c (/path/to/myprogram)
```

Der Symbolname ist oft nur ein Basisname + Offset. Ohne Debug-Info:
```
7f3a00001234 [unknown] (/path/to/myprogram)
```

Wir wollen aber: **"std::sort<int>(vector<int>&) @ sort.cpp:42"**

### addr2line — das DWARF-Lookup-Tool

`addr2line` liest DWARF-Debug-Informationen aus dem ELF-Binary und
übersetzt eine virtuelle Adresse in:
- Den exakten Funktionsnamen (demangled mit `-C`)
- Dateiname + Zeilennummer

```bash
$ addr2line -e /path/to/myprogram -f -C 0x7f3a00001234
std::sort<int>(std::vector<int>&, int, int)   # Funktionsname
/home/user/src/sort.cpp:42                    # Datei:Zeile
```

Output-Format: immer **2 Zeilen pro Adresse** (ohne `-i` Flag):
- Zeile 1: Funktionsname (oder `??` wenn unbekannt)
- Zeile 2: datei:zeilennummer (oder `??:0`)

### Batch-Strategie: alle Adressen auf einmal

Naiv: für jeden der 10.000 Samples einmal addr2line aufrufen → 10.000 Prozesse!

Clever: **alle Adressen pro Binary sammeln, einmal addr2line aufrufen**.

```
Alle Samples:
  [/bin/myprog: Addr 0x1234, 0x5678, 0x9abc]
  [/lib/libc.so: Addr 0xdeef, 0x1111]

→ addr2line -e /bin/myprog -f -C 0x1234 0x5678 0x9abc   (ein Prozess)
→ addr2line -e /lib/libc.so -f -C 0xdeef 0x1111          (ein Prozess)
```

Ergebnis: `unordered_map<string, string>` mit Key `"dso:0xadresse"` → aufgelöster Name.

### Der Code: resolve_addrs_with_addr2line (sampler.cpp:220)

```cpp
static std::unordered_map<std::string, std::string>
resolve_addrs_with_addr2line(const std::vector<AddrEntry> &entries) {

  // 1. Eingaben nach DSO (Shared Object = Binary/Library) gruppieren
  std::unordered_map<std::string, std::vector<const AddrEntry *>> by_dso;
  for (const auto &e : entries)
    if (!e.dso.empty() && e.dso[0] == '/')  // nur absolute Pfade
      by_dso[e.dso].push_back(&e);

  // 2. Pro DSO: einen addr2line Prozess starten
  for (const auto &[dso, group] : by_dso) {
    std::vector<std::string> cmd = {
      "addr2line", "-e", dso, "-f", "-C"   // -f: Funktion, -C: demangled
    };
    for (const auto *e : group) {
      char buf[32];
      snprintf(buf, sizeof(buf), "0x%lx", e->addr);  // alle Adressen
      cmd.push_back(buf);
    }
    // fork + exec + pipe (wie überall im Code)
    // addr2line's Ausgabe in String lesen
    
    // 3. Output parsen: je 2 Zeilen pro Adresse
    for (size_t idx = 0; idx < group.size(); ++idx) {
      std::getline(ss, fn_line);   // "std::sort<int>(...)"
      std::getline(ss, loc_line);  // "/src/sort.cpp:42"

      bool fn_known  = (fn_line  != "??" && !fn_line.empty());
      bool loc_known = (loc_line.find("??") == std::string::npos);

      // Key: "dso:0xadresse" → "Funktionsname @ datei.cpp:zeile"
      char key[128];
      snprintf(key, sizeof(key), "%s:0x%lx", dso.c_str(), e->addr);

      if (fn_known && loc_known)
        result[key] = fn_line + " @ " + basename(loc_line);
      else if (fn_known)
        result[key] = fn_line;
      // else: kein DWARF → key nicht gesetzt → Fallback auf raw_sym
    }
  }
  return result;
}
```

### Skizze: Resolve-Pipeline

```
perf script Output:
  7f3a001234 sort_impl+0x3c (/bin/myprog)
  7f3a000890 sort (/bin/myprog)
  7f3a000100 main (/bin/myprog)

                    │
                    ▼
           parse_perf_script_output()
           sammelt alle unique (addr, dso) Paare
                    │
                    ▼
           resolve_addrs_with_addr2line()
           addr2line -e /bin/myprog -f -C 0x1234 0x0890 0x0100
                    │
                    ▼  (2 Zeilen pro Adresse)
           "void std::sort<int>(vector<int>&)"  → fn_line
           "/home/user/sort.cpp:42"              → loc_line
                    │
                    ▼
           result["/bin/myprog:0x1234"] = "std::sort<int> @ sort.cpp:42"
```

---

## 7. Name Mangling und Demangling

### Was ist Mangling?

```
Quellcode:                           Mangled (im Binary):
─────────────────────────────────    ────────────────────────────────────
void std::sort(vector<int>&)    →    _ZNSt4sortERSt6vectorIiSaIiEE
int  add(int, int)              →    _Z3addii
myClass::foo()                  →    _ZN7myClass3fooEv
fn my_crate::sort() [Rust]      →    _RNvNtCs4abcd1_8my_crate4sort
```

C++ und Rust haben beide unterschiedliche Mangling-Schemas.
Ohne Demangling sehen Profiler-Ausgaben unleserlich aus.

### Wer demangled was?

| Sprache | Tool | Wo |
|---|---|---|
| C++ | `addr2line -C` | Automatisch beim addr2line-Aufruf |
| Rust (neu: `_R`) | `rustc --print demangle` | `demangle_rust()` in sampler.cpp |
| Rust (alt: `_ZN`) | Manuelles Parsing | `demangle_rust()` Fallback |
| Go | Kein Demangling | Symbole sind bereits lesbar |

### Der Code: demangle_rust (sampler.cpp:26)

```cpp
static std::string demangle_rust(const std::string& mangled) {
  // Nur bei Rust-Symbolen aktiv: _R... (neu) oder _ZN... (legacy)
  if (mangled.empty() ||
      (mangled.substr(0, 2) != "_R" && mangled.substr(0, 3) != "_ZN"))
    return mangled;  // kein Rust-Mangling → direkt zurück

  // ── Versuch 1: rustc --print demangle ────────────────────────────────
  // rustc ist im Docker-Worker installiert
  // fork + exec: rustc --print demangle _RNvNtCs4abcd...
  // Liest Output via pipe, entfernt trailing \n
  if (rc == 0 && !output.empty()) return output;  // "my_crate::sort"

  // ── Versuch 2: Manuelles _ZN Parsing als Fallback ────────────────────
  // Format: _ZN + [länge][name]+ + E
  // Beispiel: _ZN9my_module4sortE
  //           Skip _ZN:   i=3
  //   lese "9" → len=9 → lies "my_module", result="my_module"
  //   lese "4" → len=4 → lies "sort",      result="my_module::sort"
  //   "E" → Ende
  if (mangled.substr(0, 3) == "_ZN") {
    std::string result;
    size_t i = 3;
    while (i < mangled.length()) {
      size_t len = 0;
      while (i < mangled.length() && std::isdigit(mangled[i]))
        len = len * 10 + (mangled[i++] - '0');
      if (len == 0 || i + len > mangled.length()) break;
      if (!result.empty()) result += "::";
      result += mangled.substr(i, len);
      i += len;
    }
    return result;
  }
  return mangled;  // letzter Fallback: unverändert zurück
}
```

### Skizze: _ZN Demangling Schritt für Schritt

```
Input: _ZN9my_module4sortE
       0123456789...

i=0: "_"
i=1: "Z"
i=2: "N"
i=3: Start der Komponenten

i=3: lese Ziffern: "9" → len=9
i=4: lies 9 Zeichen: "my_module"
     result = "my_module"
i=13: lese Ziffern: "4" → len=4
i=14: lies 4 Zeichen: "sort"
      result = "my_module::sort"
i=18: "E" → kein digit → len=0 → break

Output: "my_module::sort"
```

---

## 8. perf Script Parsing — parse_perf_script_output

### Warum ein eigener Parser?

`perf script` gibt einen speziellen Textformat aus.
Wir müssen ihn in unsere `FnCost`-Struktur überführen.

### Der Algorithmus (sampler.cpp:334)

```
Durchlaufe die Textdatei Zeile für Zeile:

  Zeile beginnt NICHT mit Tab/Space:
    → Das ist eine Sample-Header-Zeile (PID, Zeit, CPU)
    → alten Stack speichern (flush_stack), neuen Stack beginnen (in_sample=true)

  Zeile beginnt MIT Tab/Space:
    → Das ist ein Stack-Frame
    → Parse: "  <hex-addr> <sym> (<dso>)"
    → Füge RawFrame{addr, sym, dso} zum aktuellen Stack hinzu

  Zeile ist leer:
    → flush_stack: Stack ist komplett, speichern

Nach dem Lesen:
  → Alle unique (addr, dso) Paare gesammelt
  → resolve_addrs_with_addr2line() aufrufen (Batch-Lookup)

Dann für jeden Stack:
  leaf = stk[0]          (die Funktion wo die CPU WAR)
  fn_map[leaf].ir += 1   (self-sample: +1 für die Leaf-Funktion)

  für i = 1..N:
    callee = resolve(stk[i-1])   (die Funktion DARUNTER)
    caller = resolve(stk[i])     (die Funktion DARÜBER im Stack)
    fn_map[callee].callers[caller] += 1   (Call-Kante)
```

### Beispiel: Ein Sample → fn_map

```
perf script Ausgabe (1 Sample):
  myprogram [001] 1.0: 1 cycles:u:     ← Header-Zeile
          0x1234 sort_impl (/bin/prog)  ← stk[0] = LEAF (wo CPU war)
          0x0890 sort     (/bin/prog)   ← stk[1]
          0x0100 main     (/bin/prog)   ← stk[2]

Ergebnis in fn_map:
  fn_map["sort_impl"].ir += 1                 (sort_impl war Leaf)
  fn_map["sort_impl"].callers["sort"] += 1    (sort rief sort_impl auf)
  fn_map["sort"].callers["main"] += 1         (main rief sort auf)

Nach 100 ähnlichen Samples:
  fn_map["sort_impl"].ir = 100   (100× war sort_impl ganz oben)
  fn_map["sort"].ir = 0          (sort war nie Leaf, nur Caller)
  fn_map["sort"].callers["main"] = 100
```

### Resolve-Priorität (resolve_sym_name Lambda)

```cpp
auto resolve_sym_name = [&](const RawFrame &fr) -> std::string {
  // 1. Versuch: addr2line hat eine Auflösung geliefert
  if (fr.addr != 0) {
    char key[128];
    snprintf(key, sizeof(key), "%s:0x%lx", fr.dso.c_str(), fr.addr);
    auto it = resolved.find(key);
    if (it != resolved.end()) return it->second;  // "sort @ sort.cpp:42"
  }
  // 2. Fallback: raw_sym ohne +0xOFFSET Suffix
  std::string name = strip_offset(fr.sym);  // "sort_impl+0x3c" → "sort_impl"
  if (!name.empty()) return name;
  // 3. Letzter Fallback: rohe Adresse als hex
  char buf[32];
  snprintf(buf, sizeof(buf), "0x%lx", fr.addr);
  return std::string(buf);
};
```

---

## 9. Callgrind — Das alte Backend (noch im Code)

### Warum wurde gewechselt?

| Eigenschaft | Callgrind | perf |
|---|---|---|
| Overhead | 10–50× langsamer | 1–5 % |
| Genauigkeit | Exakt (jede IR) | Statistisch |
| Multi-Threading | Eingeschränkt | Vollständig |
| Kernel-Stacks | Begrenzt | Vollständig |
| Abhängigkeit | Valgrind (große Installation) | Im Linux-Kernel eingebaut |

### Callgrind-Ausgabeformat kurz erklärt

```
# Callgrind output
fn=(42) main         ← ID 42 = "main" (Definition)
12 1000              ← Zeile 12: 1000 IR Selbstkosten
cfn=(43) sort        ← Callee: ID 43 = "sort"
calls=1 20           ← 1 Aufruf bei Zeile 20
20 5000              ← Kosten dieses Aufrufs: 5000 IR

fn=(42)              ← Referenz auf ID 42 (schon bekannt = "main")
25 200               ← Zeile 25: 200 IR
```

Das Format komprimiert Symbolnamen per ID-System.
Der Parser `resolve_sym()` (sampler.cpp:494) entschlüsselt: `"(42) main"` → ID 42 wird
"main" zugeordnet, `"(42)"` → Nachschlagen → "main".

### Wann wird Callgrind heute noch aufgerufen?

Direkt: **nie mehr** über `profile_binary()` oder `profile_pid()`.
Indirekt: `profile_binary_callgrind()` ist als Fallback-Methode in `Profiler::Impl`
vorhanden, wird aber nicht aufgerufen. Das ist intentional — der Code bleibt für
eventuelle Wiederverwendung oder manuelle Tests.

---

## 10. build_result — Von Rohdaten zum fertigen Ergebnis

`build_result()` (sampler.cpp:681) ist die finale Transformations-Funktion:
`vector<FnCost>` → `ProfileResult`.

```cpp
static ProfileResult build_result(std::vector<FnCost> &costs,
                                  const std::string &binary_path,
                                  uint32_t duration_ms) {

  // 1. Runtime-Demangling (nur für Rust nötig)
  BinaryRuntime rt = detect_binary_runtime(binary_path);
  for (auto &c : costs)
    if (rt == BinaryRuntime::RUST)
      c.name = demangle_rust(c.name);
    // C++ → bereits von addr2line -C demangled
    // Go  → kein Demangling nötig

  // 2. total_ir = Summe aller Selbstkosten → Basis für Prozentrechnung
  uint64_t total_ir = 0;
  for (const auto &c : costs) total_ir += c.ir;

  // 3. Inclusive-Kosten berechnen (vereinfacht: max aus self + incoming edges)
  std::unordered_map<std::string, uint64_t> inclusive;
  for (const auto &c : costs)
    inclusive[c.name] = std::max(inclusive[c.name], c.ir);

  // 4. Nach Selbstkosten sortieren (teuerste zuerst)
  std::sort(costs.begin(), costs.end(),
    [](const FnCost &a, const FnCost &b) { return a.ir > b.ir; });

  // 5. Top-50 als Hotspots exportieren
  for (size_t i = 0; i < std::min<size_t>(50, costs.size()); ++i) {
    Hotspot h;
    h.symbol       = costs[i].name;
    h.self_samples = costs[i].ir;
    h.total_samples = inclusive[costs[i].name];
    h.self_pct      = 100.0 * costs[i].ir / total_ir;
    h.total_pct     = 100.0 * h.total_samples / total_ir;
    result.hotspots.push_back(h);
  }

  // 6. Call-Graph Kanten exportieren
  for (const auto &c : costs)
    for (const auto &[caller, ir] : c.callers)
      result.call_graph.push_back({caller, c.name, ir});

  // 7. SVG + JSON generieren (in flamegraph.cpp)
  //    extern-Deklaration ohne Include — Linker verbindet beides
  extern std::string generate_flamegraph_svg(const ProfileResult &result);
  extern std::string generate_flamegraph_json(...);
  result.flamegraph_svg  = generate_flamegraph_svg(result);
  result.flamegraph_json = generate_flamegraph_json(result.hotspots);

  return result;
}
```

### Warum `extern` ohne `#include`?

```cpp
extern std::string generate_flamegraph_svg(const ProfileResult &result);
```

Das ist eine **Forward-Deklaration**. Die Funktion ist in `flamegraph.cpp` definiert.
Beide Dateien landen im selben Build-Target (`binding.gyp` listet beide).
Der **Linker** verbindet die Symbole beim letzten Build-Schritt.
Kein `#include` nötig weil keine weiteren Typen oder Templates gebraucht werden.

---

## 11. Flamegraph — Visualisierung

### Was zeigt ein Flamegraph?

```
▲ Aufruf-Tiefe
│
│  [sort_impl ████████████████████████████] ← viel Zeit hier
│  [sort      ████████████████████████████] ← sort rief sort_impl auf
│  [main ████████████████████████████████] ← main rief sort auf
└─────────────────────────────────────────────────────→ Zeit (IR / Samples)
   Breite = wie viel Zeit in dieser Funktion inkl. allem was sie aufruft
```

### FlameNode — die interne Baumstruktur

```cpp
struct FlameNode {
    std::string name;
    uint64_t self_ir  = 0;   // Samples wo DIESE Funktion Leaf war
    uint64_t total_ir = 0;   // self_ir + Summe aller Kinder
    std::vector<std::unique_ptr<FlameNode>> children;
};
```

### build_flame_tree (flamegraph.cpp:150)

```
Eingabe: ProfileResult (hotspots + call_graph)

Schritt 1: self_map aufbauen
  symbol → self_samples  (aus result.hotspots)

Schritt 2: children_map aufbauen (invertiert aus call_graph)
  call_graph enthält Kanten: callee.callers[caller]
  children_map: caller → [(callee, edge_ir)]

Schritt 3: Roots finden
  Root = Symbole die NIRGENDWO als Callee auftauchen (kein Elternknoten)
  Typisch: main(), _start, Thread-Entry-Points

Schritt 4: Baum rekursiv bauen (DFS, max Tiefe 32 um Zyklen zu brechen)
  make_node(sym):
    node.self_ir  = self_map[sym]
    node.total_ir = self_ir
    für jeden callee in children_map[sym]:
      child = make_node(callee)
      child.total_ir = max(child.total_ir, edge_ir)
      node.total_ir += child.total_ir

Schritt 5: Synthetischer "all"-Root
  Ein Knoten "all" der alle echten Roots als Kinder hat
  → eine gemeinsame Breite = total_root_ir

Fallback (wenn kein call_graph):
  Flache Liste der Hotspots als direkte Kinder von "all"
```

### Noise-Filter

```cpp
bool is_noise_symbol(const std::string& s) {
    // Diese Symbole werden aus dem Flamegraph gefiltert:
    // "(below ...", "__libc", "__GI_", "_dl_" (dynamic linker),
    // "_start", "__cxa_" (C++ Exceptions), pthread_, clone
}
```

### SVG-Rendering (render_node — flamegraph.cpp:85)

```
Für jeden FlameNode rekursiv:
  1. Breite berechnen: w = node.total_ir * px_per_ir
  2. Wenn w < 1 Pixel: nicht zeichnen (zu klein)
  3. Farbe aus Hash des Symbolnamens (warm: rot/orange/gelb/grün)
  4. <rect> zeichnen (abgerundete Ecken, weiße Umrandung)
  5. Label: nur der lokale Name (ohne Namespace-Prefix)
     Abschneiden wenn zu breit (> max_chars Zeichen)
  6. Kinder sortiert nach total_ir descending zeichnen
     cx (x-Position) rückt pro Kind um child.total_ir * px_per_ir vor

SVG-Features:
  - Dunkler Hintergrund (#1a1a2e)
  - Clip-Paths pro Tiefenstufe (Text überläuft nie aus Rechteck)
  - onclick="zoom(evt)" für Browser-Interaktivität
  - Titel-Tooltip mit exakten IR-Werten und Prozent
  - viewBox für responsive Skalierung
```

### Farb-Hash-Funktion

```cpp
std::string color_for_name(const std::string& name) {
    size_t hash = 5381;
    for (char c : name) hash = hash * 33 ^ (unsigned char)c;
    // djb2-Hash → 4 Farb-Buckets: rot, orange, gelb, grün
    // + 40 Schritte Variation für Helligkeit
}
```

**djb2-Hash**: `hash = hash * 33 ^ c` ist ein schneller, gut verteilender
String-Hash. Gleicher Symbolname → immer gleiche Farbe. Verschiedene Namen → verschiedene Farben.

---

## 12. Diff — Zwei Profile vergleichen

### Konzept

```
BASELINE (z.B. main-Branch)          CURRENT (z.B. Feature-Branch)
  sort():    35 % self_pct              sort():    45 % self_pct  ← +10 % REGRESSION
  memcpy():  20 % self_pct             memcpy():   15 % self_pct  ← -5 %  IMPROVEMENT
  main():     5 % self_pct             new_func(): 10 % self_pct  ← NEU (Regression)
```

### Der Code: Profiler::diff (diff.cpp:7)

```cpp
DiffResult Profiler::diff(const ProfileResult& baseline,
                          const ProfileResult& current) {
  // 1. Baseline-Hotspots in HashMap (symbol → Hotspot*)
  std::unordered_map<std::string, const Hotspot*> baseline_map;
  for (const auto& h : baseline.hotspots)
    baseline_map[h.symbol] = &h;

  // 2. Alle Current-Hotspots durchgehen
  for (const auto& [symbol, current_hotspot] : current_map) {
    auto it = baseline_map.find(symbol);
    if (it != baseline_map.end()) {
      // Symbol in beiden Profilen → Delta berechnen
      double delta = current_hotspot->self_pct - baseline_hotspot->self_pct;
      if (delta > 0.1)  result.regressions.push_back(...);  // langsamer
      if (delta < -0.1) result.improvements.push_back(...); // schneller
    } else {
      // Symbol nur in current → neuer Hotspot → immer Regression
      result.regressions.push_back(*current_hotspot);
    }
  }

  // 3. overall_speedup = (baseline_total - current_total) / baseline_total * 100
  //    Positiv = schneller, Negativ = langsamer

  // 4. Sortieren nach self_pct descending (schwerste Regression zuerst)
  std::sort(result.regressions.begin(), result.regressions.end(),
    [](const Hotspot& a, const Hotspot& b){ return a.self_pct > b.self_pct; });
}
```

### Schwellwert 0.1 %

Symbole mit `|delta| <= 0.1 %` werden ignoriert — normales statistisches Rauschen
bei Sampling-Profilern. Man will echte Änderungen, keine Messunsicherheiten.

---

## Schlüssel-Konzepte aus Teil 2

| Begriff | Kurzdefinition |
|---|---|
| **perf record** | Sammelt Samples in binäre Datei; nutzt Hardware-Counter |
| **perf script** | Konvertiert binäre perf-Daten in lesbaren Text |
| **Ring-Buffer** | Kernel-seitiger mmap-Puffer, kein Syscall pro Sample |
| **addr2line** | Tool das Adressen via DWARF in Datei:Zeile auflöst |
| **Batch-Resolution** | Alle Adressen eines Binaries in einem addr2line-Aufruf |
| **AddrEntry** | Struct: addr + raw_sym + dso (Eingabe für addr2line) |
| **strip_offset** | Entfernt "+0xHEX" Suffix von perf-Symbolnamen |
| **FnCost** | Intern: name + ir (self-Samples) + callers-Map |
| **djb2-Hash** | Schneller String-Hash für Flamegraph-Farben |
| **Noise-Filter** | `is_noise_symbol()` filtert libc/__cxa_/pthread_ aus SVG |
| **overall_speedup** | Positive Zahl = schneller, negative = langsamer |

---
*Weiter in LEHRBUCH_3_NodeJS.md: Unix-IPC · N-API · node-gyp · Worker Threads · Cheatsheet*
