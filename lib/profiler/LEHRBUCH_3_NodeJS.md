# RealBench Profiler – Lehrbuch Teil 3: Node.js Integration
# Kapitel: Unix-IPC · N-API · node-gyp · Worker Threads · Ende-zu-Ende · Cheatsheet

---

## 13. Unix-IPC — das Handwerkszeug des Profilers

Der gesamte C++-Kern nutzt für jeden externen Prozessaufruf dasselbe Muster:
**fork → dup2 → exec → pipe → read → waitpid**. Das ist kein Framework, das ist
klassisches Unix-Handwerk.

### Das Muster erklärt

```
1. pipe(pipefd)
   Erstellt zwei Datei-Deskriptoren: pipefd[0]=Lesen, pipefd[1]=Schreiben.
   Was auf pipefd[1] geschrieben wird, erscheint auf pipefd[0].
   ┌────────────────┐    Pipe (Kernel-Puffer)    ┌────────────────┐
   │  pipefd[1]     │ ────────────────────────→  │  pipefd[0]     │
   │  (Schreiben)   │                             │  (Lesen)       │
   └────────────────┘                             └────────────────┘

2. fork()
   Erstellt eine exakte Kopie des Prozesses (Copy-on-Write).
   Beide Prozesse (Parent + Child) haben die gleichen Deskriptoren.
   Rückgabewert: 0 im Child, Child-PID im Parent.

3. Im Child:
   close(pipefd[0])              ← Child liest nicht
   dup2(pipefd[1], STDOUT_FILENO) ← Child's stdout → Pipe
   close(pipefd[1])
   execvp("perf", argv)          ← Prozess durch perf ersetzen
   _exit(127)                    ← execvp schlug fehl

4. Im Parent:
   close(pipefd[1])              ← Parent schreibt nicht
   // Lesen bis EOF:
   while (read(pipefd[0], buf, sizeof(buf)) > 0)
     fwrite(buf, 1, n, outfile);
   close(pipefd[0])
   waitpid(child, &status, 0)    ← Warten bis Child fertig ist
   WIFEXITED(status) ? WEXITSTATUS(status) : -1  ← Exit-Code

5. Exit-Code 127 = Sonderfall
   execvp() setzt Exit-Code 127 wenn das Programm nicht gefunden wird.
   Deshalb: if (rc == 127) throw ProfilerException("perf not found");
```

### Skizze: fork + pipe für perf script

```
Parent (C++ Profiler)          Child (wird zu "perf script")
─────────────────────          ──────────────────────────────
pipe() erstellen               (erbt die pipe)
fork() → child = PID
                               close(pipefd[0])
                               dup2(pipefd[1], stdout)
                               close(pipefd[1])
                               execvp("perf", ["perf","script","-i","..."])
                                   → perf schreibt seine Ausgabe nach stdout
                                   → stdout IST jetzt pipefd[1]
close(pipefd[1])
FILE *out = fopen(script_out, "w")
while read(pipefd[0]) > 0:
  fwrite(..., out)             (perf schreibt, wir lesen gleichzeitig)
fclose(out)
waitpid(child)                 perf beendet sich
```

**Warum nicht `system()` oder `popen()`?**
- `system()` nutzt `/bin/sh` → Shell-Injection-Risiko + Shell-Overhead
- `popen()` öffnet nur stdin oder stdout, nicht beides
- `fork+exec` direkt → volle Kontrolle, kein Shell-Overhead

### run_and_wait vs. run_and_wait_capture

```cpp
// run_and_wait: führt aus, gibt nur Exit-Code zurück
static int run_and_wait(const std::vector<std::string> &argv) {
  std::string dummy;
  return run_and_wait_capture(argv, dummy);  // delegiert
}

// run_and_wait_capture: führt aus, gibt Exit-Code UND Output zurück
// Achtung: kapped bei 8 KB (nur für kurze Diagnose-Ausgaben gedacht)
static int run_and_wait_capture(const std::vector<std::string> &argv,
                                std::string &out_output) {
  // ... fork + dup2(stderr→pipe) + exec ...
  // Liest stdout UND stderr (beide in pipefd[1] gemapped)
  while ((n = read(pipefd[0], buf, ...)) > 0) {
    out_output.append(buf, n);
    if (out_output.size() > 8192) break;  // Cap bei 8 KB
  }
}
```

`run_and_wait` = für lange Ausgaben (perf record, perf script output direkt in Datei).
`run_and_wait_capture` = für kurze Ausgaben (addr2line, demangle, Diagnose).

---

## 14. Datenstrukturen — profiler.h

```cpp
// profiler.h:13 — Ein Stack-Frame (für symbol_resolver.cpp)
struct StackFrame {
    std::string symbol;   // "main"
    std::string file;     // "src/main.cpp"
    uint64_t    address;  // 0x7f3a00001234
    int         line;     // 42
};

// profiler.h:21 — Ein Hotspot (Top-50 teuerste Funktionen)
struct Hotspot {
    std::string symbol;        // demangled Funktionsname
    uint64_t    self_samples;  // Samples wo diese Fn Leaf war
    uint64_t    total_samples; // Samples inkl. alles was sie aufruft
    uint64_t    call_count;    // Wie oft aufgerufen (bei perf: = self_samples)
    double      self_pct;      // self / total_gesamt * 100
    double      total_pct;     // total / total_gesamt * 100
};

// profiler.h:31 — Konfiguration (kommt aus JS via N-API)
struct ProfileConfig {
    uint32_t frequency_hz     = 99;     // perf -F Wert
    uint32_t duration_seconds = 30;     // perf --duration Wert
    bool     include_kernel   = false;  // --user-callchains wenn false
    // capture_cpu/memory/output_format: noch nicht genutzt
};

// profiler.h:41 — Eine Kante im Call-Graph
struct CallEdge {
    std::string caller;  // "main"
    std::string callee;  // "std::sort<int>"
    uint64_t    ir;      // Samples auf dieser Kante (Gewicht)
};

// profiler.h:48 — Das vollständige Ergebnis
struct ProfileResult {
    std::vector<Hotspot>  hotspots;        // Top-50 Funktionen
    std::vector<CallEdge> call_graph;      // Alle Caller→Callee Kanten
    std::string           flamegraph_svg;  // Fertiges SVG (kann MB groß sein)
    std::string           flamegraph_json; // JSON-Hotspot-Liste
    uint64_t              total_samples;   // Gesamt-Samples (Basis für %)
    uint32_t              duration_ms;     // Wie lange profiled wurde
    std::string           target_binary;   // Pfad zum Binary
    std::string           commit_sha;      // (von außen gesetzt)
    int                   exit_code;       // Exit-Code des Binaries
    std::string           error_message;   // Fehler wenn profiling scheiterte
};
```

### PIMPL-Idiom — Warum `class Impl`?

```cpp
// profiler.h:62
class Profiler {
public:
    explicit Profiler(const ProfileConfig& config);
    ~Profiler();
    ProfileResult profile_pid(pid_t pid);
    ProfileResult profile_binary(const std::string& path, ...);

private:
    class Impl;                      // Nur vorwärts-deklariert
    std::unique_ptr<Impl> impl_;     // Zeiger auf die echte Implementierung
};
```

**PIMPL** = Pointer to IMPLementation.
- Der Header `profiler.h` enthält **keine** `#include`-Abhängigkeiten auf
  `<sys/wait.h>`, `<unistd.h>` etc. → saubere API ohne Implementierungsdetails
- Ändert sich `sampler.cpp`, müssen nur die `.cpp`-Dateien neu kompiliert werden,
  nicht alles was `profiler.h` included
- Ermöglicht separate Kompilation und reduziert Build-Zeiten

---

## 15. N-API Brücke — C++ spricht JavaScript

### Was ist N-API?

N-API (Node API) = stabiles C-Interface zum Einbetten von C++ in Node.js.
`node-addon-api` = C++-Wrapper um N-API mit besserer Ergonomie (Napi-Klassen).

Node.js läuft auf V8 (Google's JavaScript-Engine). V8 hat eigene Typen für
alles: `v8::Number`, `v8::String`, `v8::Object`. N-API abstrahiert das —
unsere Bindungen funktionieren auf jeder V8-Version.

### ProfilerWrapper — das Klassen-Pattern

```cpp
// node_addon.cpp:10
class ProfilerWrapper : public ObjectWrap<ProfilerWrapper> {
    // ObjectWrap bindet eine C++-Instanz an ein JS-Objekt.
    // Wenn JS: const p = new Profiler({frequencyHz: 99})
    // → C++: ProfilerWrapper-Konstruktor wird aufgerufen
    // → p ist ein JS-Object das intern auf den C++-ProfilerWrapper zeigt
};
```

### Init — Klasse in JS registrieren (node_addon.cpp:12)

```cpp
static Object Init(Napi::Env env, Object exports) {
    Function func = DefineClass(env, "Profiler", {
        InstanceMethod("profilePid",    &ProfilerWrapper::ProfilePid),
        InstanceMethod("profileBinary", &ProfilerWrapper::ProfileBinary),
        StaticMethod( "diff",           &ProfilerWrapper::Diff),
    });
    exports.Set("Profiler", func);  // exports.Profiler = class Profiler { ... }
    return exports;
}
```

Analog zu JavaScript:
```js
exports.Profiler = class Profiler {
  profilePid(pid) { ... }
  profileBinary(path, args) { ... }
  static diff(a, b) { ... }
}
```

### Konstruktor — JS-Optionen → C++ Config (node_addon.cpp:23)

```cpp
ProfilerWrapper(const CallbackInfo& info) : ObjectWrap<ProfilerWrapper>(info) {
    ProfileConfig config;  // C++ Struct mit Defaults

    if (info.Length() > 0 && info[0].IsObject()) {
        Object opts = info[0].As<Object>();

        // JS: { frequencyHz: 99 }  → C++: config.frequency_hz = 99
        if (opts.Has("frequencyHz"))
            config.frequency_hz = opts.Get("frequencyHz").As<Number>().Uint32Value();
        if (opts.Has("durationSeconds"))
            config.duration_seconds = opts.Get("durationSeconds").As<Number>().Uint32Value();
        if (opts.Has("includeKernel"))
            config.include_kernel = opts.Get("includeKernel").As<Boolean>().Value();
    }
    profiler_ = std::make_unique<Profiler>(config);  // C++ Profiler erstellen
}
```

**Typ-Konvertierungs-Kette:**
```
JS Number  → info[0].As<Number>().Uint32Value()  → uint32_t
JS Boolean → info[0].As<Boolean>().Value()        → bool
JS String  → info[0].As<String>().Utf8Value()     → std::string
JS Array   → info[0].As<Array>()  + arr.Get(i)    → std::vector<>
```

### ProfileBinary — Methodenaufruf (node_addon.cpp:67)

```cpp
Napi::Value ProfileBinary(const CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Argument-Validierung
    if (info.Length() < 1 || !info[0].IsString()) {
        TypeError::New(env, "Binary path expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string binary_path = info[0].As<String>().Utf8Value();
    std::vector<std::string> args;
    if (info.Length() > 1 && info[1].IsArray()) {
        Array arr = info[1].As<Array>();
        for (uint32_t i = 0; i < arr.Length(); ++i)
            args.push_back(arr.Get(i).As<String>().Utf8Value());
    }

    try {
        ProfileResult result = profiler_->profile_binary(binary_path, args);
        return ResultToObject(env, result);   // C++ → JS Serialisierung
    } catch (const ProfilerException& e) {
        Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}
```

### ResultToObject — ProfileResult → JS-Objekt (node_addon.cpp:117)

```cpp
static Object ResultToObject(Napi::Env env, const ProfileResult& result) {
    Object obj = Object::New(env);

    // Array von Hotspot-Objekten
    Array hotspots = Array::New(env, result.hotspots.size());
    for (size_t i = 0; i < result.hotspots.size(); ++i)
        hotspots[i] = HotspotToObject(env, result.hotspots[i]);
    obj.Set("hotspots", hotspots);

    // SVG-String — aber nicht unbegrenzt groß
    const std::string& svg = result.flamegraph_svg;
    obj.Set("flamegraphSvg", String::New(env,
        svg.size() > 10 * 1024 * 1024 ? "<svg>Data too large</svg>" : svg));

    obj.Set("totalSamples",  Number::New(env, (double)result.total_samples));
    obj.Set("durationMs",    Number::New(env, result.duration_ms));
    obj.Set("targetBinary",  String::New(env, result.target_binary));
    obj.Set("commitSha",     String::New(env, result.commit_sha));
    obj.Set("exitCode",      Number::New(env, result.exit_code));
    obj.Set("errorMessage",  String::New(env, result.error_message));

    return obj;
}
```

### HotspotToObject — UTF-8 Sanitierung (node_addon.cpp:152)

Das ist der ausführlichste Teil des Bindings — und das aus gutem Grund:
Symbolnamen aus ELF-Binaries können **ungültige UTF-8-Bytes** enthalten
(z.B. eingebettete NUL-Bytes, kaputte multi-Byte-Sequenzen).
V8 bricht ab wenn es ungültige UTF-8-Strings erhält.

```
Algorithmus: UTF-8 Validator + Sanitizer
─────────────────────────────────────────
Für jedes Byte c im Symbolnamen:
  c == 0x00        → überspringen (NUL-Byte entfernen)
  c < 0x80         → 1-Byte-ASCII (seq=1) → direkt kopieren
  (c & 0xE0)==0xC0 → 2-Byte-Sequenz Anfang (seq=2)
  (c & 0xF0)==0xE0 → 3-Byte-Sequenz Anfang (seq=3)
  (c & 0xF8)==0xF0 → 4-Byte-Sequenz Anfang (seq=4)
  sonst            → ungültiges Byte → durch U+FFFD (0xEF 0xBF 0xBD) ersetzen

Für seq > 1: prüfe dass die nächsten seq-1 Bytes Continuation-Bytes sind
  Continuation-Byte: (byte & 0xC0) == 0x80
  Wenn nicht: ungültig → U+FFFD

Wenn nach Bereinigung leer: safe_symbol = "<unknown>"
```

**U+FFFD** = das Unicode Replacement Character — das Standard-Zeichen für
"hier war etwas, aber es war nicht valide".

### Modul-Export (node_addon.cpp:250)

```cpp
Object Init(Env env, Object exports) {
    return ProfilerWrapper::Init(env, exports);
}

NODE_API_MODULE(profiler, Init)
```

`NODE_API_MODULE(profiler, Init)` ist ein Makro das den Modul-Namen (`profiler`)
und die Init-Funktion registriert. Beim `require('./build/Release/profiler.node')`
sucht Node.js nach diesem registrierten Namen und ruft `Init` auf.

---

## 16. node-gyp und binding.gyp

### Was ist node-gyp?

`node-gyp` = Build-Tool für native Node.js Addons.
Es liest `binding.gyp` (GYP = Generate Your Projects) und erstellt daraus:
- **macOS**: Xcode-Projekt → clang++
- **Linux**: Makefile → g++
- Ausgabe: `build/Release/profiler.node` (eine normale `.so`-Datei mit `.node`-Extension)

### binding.gyp erklärt

```json
{
  "targets": [{
    "target_name": "profiler",        // → profiler.node

    "sources": [
      "bindings/node_addon.cpp",      // Die Brücke (N-API)
      "src/sampler.cpp",              // Profiler-Kern
      "src/flamegraph.cpp",           // SVG/JSON
      "src/diff.cpp",                 // Vergleich
      "src/symbol_resolver.cpp"       // ELF-Symbole direkt
    ],
    // Alle 5 Dateien werden zu EINEM .node kompiliert und gelinkt.
    // Deshalb funktionieren die extern-Deklarationen ohne #include.

    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      // ^ Shell-Ausdruck: führt node aus, gibt napi.h-Pfad zurück
      "include"                       // unser profiler.h
    ],

    "cflags_cc": ["-std=c++20", "-Wall", "-Wextra"],
    // C++20 für strukturierte Bindungen (auto& [key, val] : map),
    // std::min mit initializer_list, string_view etc.

    "libraries": ["-ldl"],
    // -ldl = libdl = Dynamic Linking Library
    // Wird für dlopen/dlsym gebraucht (obwohl wir es nicht direkt nutzen,
    // ist es Abhängigkeit von node-addon-api)

    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    // Wir nutzen manuelle Error::ThrowAsJavaScriptException()
    // statt C++ Exceptions durch N-API

    "conditions": [
      ["OS=='mac'", {
        "xcode_settings": {
          "GCC_ENABLE_CPP_EXCEPTIONS": "YES",  // Exceptions im C++-Code erlaubt
          "MACOSX_DEPLOYMENT_TARGET": "10.15"  // Minimum: macOS Catalina
        }
      }]
    ]
  }]
}
```

### Build-Prozess

```
pnpm install  →  node-gyp configure  →  node-gyp build
                  (liest binding.gyp)    (kompiliert + linkt)
                  (generiert Makefile)   (erstellt profiler.node)

Ausgabe: lib/profiler/build/Release/profiler.node
         (ELF Shared Object auf Linux, Mach-O dylib auf macOS)
```

---

## 17. Worker Thread Pattern

### Das fundamentale Problem

```
Node.js Event Loop (Single Thread):
  ┌──────────────────────────────────────────────────────┐
  │  Warte auf Events (HTTP Request, Timer, I/O, ...)    │
  │                                                       │
  │  Event kommt → Handler aufrufen → Handler muss KURZ  │
  │  sein → Event Loop kann weiter Events verarbeiten     │
  └──────────────────────────────────────────────────────┘

Was passiert wenn profileBinary() direkt aufgerufen wird?
  → C++ blockiert den Thread für 30+ Sekunden
  → Keine anderen Requests können verarbeitet werden
  → API antwortet auf nichts mehr
  → TIMEOUT
```

### Die Lösung: Worker Threads

```
Main Thread (Event Loop):              Worker Thread:
────────────────────────────────       ──────────────────────────────────
new Worker('profiler_worker.js',       // In eigenem OS-Thread gestartet
  { workerData: {opts, method, args}})
                                       // require('profiler.node') → C++ laden
const timer = setTimeout(...)          const profiler = new Profiler(options)
                                       // BLOCKIERT HIER 30 Sekunden:
worker.on('message', msg => ...)       result = profiler.profileBinary(path)

// Event Loop läuft weiter!            // Fertig:
// Andere HTTP-Requests werden         parentPort.postMessage({ result })
// normal bearbeitet.
                                       // → Main Thread's 'message' Event feuert
clearTimeout(timer)                    
resolve(msg.result)                    
```

### profiler_worker.js komplett erklärt (Zeile für Zeile)

```js
'use strict';
// Zeile 2: Worker Threads API
const { parentPort, workerData } = require('worker_threads');
// parentPort = Kommunikationskanal zum Parent-Thread
// workerData = die Daten die new Worker(..., {workerData}) mitgegeben hat

const { Profiler } = require('./build/Release/profiler.node');
// Lädt das native C++ Addon (die .node-Datei)
// Das passiert im Worker-Thread, nicht im Main-Thread

const { options, method, args } = workerData;
// Destrukturierung der übergebenen Daten:
//   options = { frequencyHz: 99, durationSeconds: 30, includeKernel: false }
//   method  = 'profileBinary' oder 'profilePid'
//   args    = ['/path/to/binary', []] oder [pid]

const durationSeconds = options.durationSeconds || 30;
const timeoutMs = (durationSeconds * 60 + 120) * 1000;
// Timeout-Formel: (durationSeconds * 60 + 120) * 1000
// Beispiel: 30s Profiling → (30*60 + 120) * 1000 = 1920 * 1000 = 32 Minuten
// Das ist sehr konservativ — callgrind war 10-50x langsamer (historisch)

// Kill-Timer: Failsafe falls der native Call HÄNGT (nicht nur langsam ist)
const killTimer = setTimeout(() => {
  parentPort.postMessage({ error: `Native profiler timed out after ${timeoutMs}ms` });
  process.exit(1);  // Worker hart beenden
}, timeoutMs);

const profiler = new Profiler(options);  // C++ ProfilerWrapper instanziieren

try {
  let result;
  if (method === 'profilePid')
    result = profiler.profilePid(args[0]);          // Blockiert hier
  else if (method === 'profileBinary')
    result = profiler.profileBinary(args[0], args[1] || []);  // Blockiert hier
  else
    throw new Error(`Unknown method: ${method}`);

  clearTimeout(killTimer);            // Erfolg → Kill-Timer abbrechen
  parentPort.postMessage({ result }); // Ergebnis an Parent schicken

} catch (err) {
  clearTimeout(killTimer);
  parentPort.postMessage({ error: err.message || String(err) });  // Fehler weiterleiten
}
```

### index.js — runInWorker erklärt (Zeile für Zeile)

```js
function runInWorker(options, method, args) {
  const durationSeconds = options.durationSeconds || 30;
  const timeoutMs = (durationSeconds * 60 + 120) * 1000;
  // Gleiche Timeout-Formel wie im Worker (Schutz falls Worker nicht antwortet)

  return new Promise((resolve, reject) => {
    // Worker-Thread starten
    const worker = new Worker(
      path.join(__dirname, 'profiler_worker.js'),
      { workerData: { options, method, args } }
    );

    let settled = false;  // Verhindert doppeltes resolve/reject

    // Timeout-Timer im Main Thread
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate();  // Worker-Thread zwangsweise beenden
        reject(new Error(`Profiler worker timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    // Worker schickt Ergebnis oder Fehler
    worker.on('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error));
      else           resolve(msg.result);
    });

    // Unerwarteter Fehler im Worker (z.B. JS-Exception)
    worker.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    // Worker beendete sich selbst mit Exit-Code != 0
    worker.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}
```

**Doppelt-Timer-Schutz**: Sowohl `index.js` (Main Thread) als auch
`profiler_worker.js` haben jeweils einen Timer. Das ist Defensive Programming:
- `profiler_worker.js`-Timer: schützt vor hängendem nativen Call
- `index.js`-Timer: schützt vor Worker der nie antwortet (z.B. Worker crasht stumm)

---

## 18. Vollständiger Datenfluss Ende-zu-Ende

```
TRIGGER: profiling-worker.ts bekommt Job von pg-boss

   profiling-worker.ts
   ├── await profileBinary('/tmp/binary', { frequencyHz: 99, durationSeconds: 30 })
   │   ↓
   index.js: ProfilerClient.profileBinary()
   ├── runInWorker({ frequencyHz:99, ... }, 'profileBinary', ['/tmp/binary', []])
   ├── new Worker('profiler_worker.js', { workerData: ... })
   │   ↓ (neuer OS-Thread)
   profiler_worker.js
   ├── new Profiler({ frequencyHz: 99, ... })
   │   ↓ N-API Konstruktor
   node_addon.cpp: ProfilerWrapper()
   ├── ProfileConfig { frequency_hz=99, duration_seconds=30 }
   ├── profiler_ = make_unique<Profiler>(config)
   │   ↓
   sampler.cpp: Profiler::Impl
   │
   profiler_worker.js: profiler.profileBinary('/tmp/binary', [])
   │   ↓ N-API
   node_addon.cpp: ProfilerWrapper::ProfileBinary()
   ├── binary_path = "/tmp/binary"
   ├── profiler_->profile_binary(binary_path, {})
   │   ↓
   sampler.cpp: Profiler::Impl::profile_binary()
   ├── detect_binary_runtime("/tmp/binary")  → NATIVE
   ├── profile_binary_perf("/tmp/binary", {}, "/tmp/perf_data.PID", "/tmp/perf_script.PID")
   │   ├── perf record -F 99 -g --call-graph dwarf,65528 -m 16M ...  [fork+exec+waitpid]
   │   └── perf script -i /tmp/perf_data.PID  [fork+exec+pipe → Datei]
   ├── parse_perf_script_output("/tmp/perf_script.PID", "/tmp/binary")
   │   ├── Alle RawFrames aus Textdatei parsen
   │   ├── resolve_addrs_with_addr2line([...])  [fork+exec+pipe für addr2line]
   │   └── fn_map aufbauen: "sort" → {ir:150, callers:{main:150}}
   ├── build_result(costs, "/tmp/binary", duration_ms)
   │   ├── Kein Demangling (NATIVE)
   │   ├── Top-50 Hotspots sortieren
   │   ├── CallEdges exportieren
   │   ├── generate_flamegraph_svg()  → SVG-String
   │   └── generate_flamegraph_json() → JSON-String
   │   ↓ ProfileResult
   node_addon.cpp: ResultToObject()
   ├── C++ ProfileResult → JS-Objekt (hotspots Array, flamegraphSvg String, ...)
   │   ↓ Napi::Object
   profiler_worker.js: parentPort.postMessage({ result })
   │   ↓ Worker-Thread → Main-Thread Nachricht
   index.js: worker.on('message') → resolve(msg.result)
   │   ↓ Promise resolved
   profiling-worker.ts
   ├── result.flamegraphSvg → S3 hochladen
   ├── result.hotspots → LLM-Analyse (analyzeProfiling)
   └── DB updaten: status='completed', flamegraphUrl=...
```

---

## 19. Interview-Cheatsheet

### "Erkläre wie der Profiler funktioniert"

> Der Profiler nutzt `perf` — den Linux-Kernel-Sampling-Profiler.
> Er startet das Binary mit `perf record`, das 99 Mal pro Sekunde schaut wo
> sich die CPU gerade befindet und den vollständigen Call-Stack aufzeichnet.
> Das Ergebnis ist eine binäre Datei die wir mit `perf script` in Text
> konvertieren. Danach lösen wir alle Adressen per `addr2line` in Datei:Zeile
> auf, bauen eine Funktion-Kosten-Map, generieren ein SVG-Flamegraph und
> geben Top-50 Hotspots zurück.

### "Warum perf statt Valgrind/Callgrind?"

> Callgrind hat 10–50× Overhead — ein 1-Sekunden-Programm läuft unter
> Callgrind 10–50 Sekunden. Außerdem verändert das die Ausführungscharakteristik
> (CPU-Caches heißlaufen anders). perf hat nur 1–5% Overhead und zeigt
> echtes Laufzeitverhalten.

### "Was ist der Unterschied zwischen self und total?"

> `self` = die Zeit die DIESE Funktion selbst verbraucht hat (Leaf-Samples).
> `total` = self + alles was von dieser Funktion aus aufgerufen wurde.
> Eine Dispatcher-Funktion wie `main()` hat hohes total, niederes self.
> Eine echte Hotspot-Funktion wie `sort_impl()` hat hohes self.

### "Warum Worker Threads?"

> Node.js ist single-threaded — ein blockierender Aufruf stoppt alles.
> `profile_binary()` blockiert für 30+ Sekunden (C++ Code der auf `perf`
> wartet). Im Worker Thread läuft das in einem separaten OS-Thread —
> der Event Loop verarbeitet weiter alle anderen Requests.

### "Was ist N-API?"

> N-API = stabiles C-Interface von Node.js für native Addons.
> Es erlaubt C++-Code als `.node`-Datei zu kompilieren die Node.js
> wie ein normales Modul laden kann. `node-addon-api` ist der C++-Wrapper
> darum. `node-gyp` + `binding.gyp` ist das Build-System das alles
> zu einer `.so`-Datei kompiliert.

### "Wie erkennt der Profiler Go vs Rust vs C++?"

> Durch direktes Lesen des ELF-Headers: Go-Binaries haben Sections
> `.go.buildinfo` und `.gosymtab`. Rust-Binaries haben `.rustc`.
> Das bestimmt die perf call-graph Strategie: fp (Frame-Pointer) für Go,
> dwarf,65528 für C++/Rust.

### "Was macht addr2line?"

> addr2line liest DWARF-Debug-Informationen aus dem ELF-Binary und
> übersetzt rohe virtuelle Adressen in Funktionsname + Datei:Zeile.
> Wir rufen es einmal pro Binary auf mit allen Adressen auf einmal
> (Batch-Strategie) statt einmal pro Sample.

### "Was ist PIMPL?"

> Pointer to IMPLementation. Die `Profiler`-Klasse im Header deklariert
> nur `class Impl;` und hält einen `unique_ptr<Impl>`. Die komplette
> Implementierung steckt in `sampler.cpp`. So ändern sich Implementierungsdetails
> ohne dass API-Nutzer ihre Header-Dependencies neu kompilieren müssen.

---

## Schlüssel-Konzepte Gesamtübersicht

| Begriff | Kurzdefinition |
|---|---|
| **Sampling** | Profiling durch regelmäßiges Unterbrechen; 1–5% Overhead |
| **perf record** | Linux-Tool; sammelt Hardware-Counter-Samples in binäre Datei |
| **perf script** | Konvertiert binäre perf-Daten in lesbaren Stack-Text |
| **DWARF** | Debug-Info-Format; erlaubt Stack-Unwinding ohne Frame-Pointer |
| **Frame-Pointer** | Register RBP; Go bewahrt ihn, C++ optimiert ihn oft weg |
| **ELF** | Binärformat auf Linux; besteht aus Header + Sections |
| **addr2line** | Übersetzt Adressen → Funktionsname + Datei:Zeile via DWARF |
| **Batch-Resolution** | Alle Adressen eines Binaries in einem addr2line-Aufruf |
| **FnCost** | Intern: name + self-Samples + callers-Map |
| **ProfileResult** | Öffentlich: hotspots + call_graph + SVG + JSON |
| **PIMPL** | Implementierung hinter Pointer verstecken; saubere API |
| **N-API** | Stabiles C-Interface für native Node.js Addons |
| **ObjectWrap** | node-addon-api Mixin das C++-Instanz an JS-Objekt bindet |
| **binding.gyp** | Build-Rezept für node-gyp (→ profiler.node) |
| **Worker Thread** | Eigener OS-Thread; verhindert Event-Loop-Blockierung |
| **settled-Flag** | Verhindert doppeltes resolve/reject bei Worker-Events |
| **Doppel-Timer** | Timeout sowohl in index.js als auch profiler_worker.js |
| **djb2-Hash** | `hash*33 ^ c`; deterministischer String-Hash für SVG-Farben |
| **U+FFFD** | Unicode Replacement Character; ersetzt ungültige UTF-8-Bytes |
| **99 Hz** | Primzahl-nahe Frequenz; verhindert Timer-Resonanz mit Kernel |
