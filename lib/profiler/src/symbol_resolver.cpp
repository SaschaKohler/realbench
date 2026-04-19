#include "profiler.h"
#include <fstream>
#include <sstream>
#include <algorithm>
#include <unordered_map>
#include <vector>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>
#include <elf.h>
#include <link.h>

namespace realbench {

struct MemoryMapping {
    uint64_t start;
    uint64_t end;
    std::string path;
    uint64_t offset;
};

struct Symbol {
    std::string name;
    uint64_t address;
    uint64_t size;
};

class SymbolResolver {
public:
    SymbolResolver(pid_t pid) : pid_(pid) {
        load_memory_maps();
        load_symbols();
    }
    
    std::string resolve(uint64_t address) {
        for (const auto& mapping : mappings_) {
            if (address >= mapping.start && address < mapping.end) {
                uint64_t file_offset = address - mapping.start + mapping.offset;
                
                auto it = symbols_.find(mapping.path);
                if (it != symbols_.end()) {
                    const Symbol* best = nullptr;
                    uint64_t best_distance = UINT64_MAX;
                    
                    for (const auto& sym : it->second) {
                        if (file_offset >= sym.address && file_offset < sym.address + sym.size) {
                            return sym.name;
                        }
                        if (file_offset >= sym.address) {
                            uint64_t distance = file_offset - sym.address;
                            if (distance < best_distance) {
                                best_distance = distance;
                                best = &sym;
                            }
                        }
                    }
                    
                    if (best && best_distance < 4096) {
                        char buf[512];
                        snprintf(buf, sizeof(buf), "%s+0x%lx", best->name.c_str(), best_distance);
                        return std::string(buf);
                    }
                }
                
                char buf[256];
                const char* basename = strrchr(mapping.path.c_str(), '/');
                basename = basename ? basename + 1 : mapping.path.c_str();
                snprintf(buf, sizeof(buf), "%s+0x%lx", basename, file_offset);
                return std::string(buf);
            }
        }
        
        char buf[32];
        snprintf(buf, sizeof(buf), "0x%016lx", address);
        return std::string(buf);
    }
    
    StackFrame resolve_frame(uint64_t address) {
        StackFrame frame;
        frame.address = address;
        frame.symbol = resolve(address);
        frame.file = "unknown";
        frame.line = 0;
        return frame;
    }

private:
    pid_t pid_;
    std::vector<MemoryMapping> mappings_;
    std::unordered_map<std::string, std::vector<Symbol>> symbols_;
    
    void load_memory_maps() {
        char path[64];
        snprintf(path, sizeof(path), "/proc/%d/maps", pid_);
        
        std::ifstream maps(path);
        if (!maps) return;
        
        std::string line;
        while (std::getline(maps, line)) {
            uint64_t start, end, offset;
            char perms[5], dev[16], inode[32];
            char pathname[512] = {};
            
            int parsed = sscanf(line.c_str(), "%lx-%lx %4s %lx %15s %31s %511[^\n]",
                              &start, &end, perms, &offset, dev, inode, pathname);
            
            if (parsed >= 6 && perms[2] == 'x') {
                MemoryMapping mapping;
                mapping.start = start;
                mapping.end = end;
                mapping.offset = offset;
                
                char* p = pathname;
                while (*p == ' ') p++;
                if (*p) {
                    mapping.path = p;
                    mappings_.push_back(mapping);
                }
            }
        }
    }
    
    void load_symbols() {
        for (const auto& mapping : mappings_) {
            if (mapping.path.empty() || mapping.path[0] != '/') continue;
            
            std::vector<Symbol> syms = read_elf_symbols(mapping.path);
            if (!syms.empty()) {
                symbols_[mapping.path] = std::move(syms);
            }
        }
    }
    
    std::vector<Symbol> read_elf_symbols(const std::string& path) {
        std::vector<Symbol> result;
        
        int fd = open(path.c_str(), O_RDONLY);
        if (fd < 0) return result;
        
        unsigned char e_ident[EI_NIDENT];
        if (read(fd, e_ident, EI_NIDENT) != EI_NIDENT) {
            close(fd);
            return result;
        }
        
        if (memcmp(e_ident, ELFMAG, SELFMAG) != 0) {
            close(fd);
            return result;
        }
        
        bool is_64bit = (e_ident[EI_CLASS] == ELFCLASS64);
        
        if (is_64bit) {
            result = read_elf64_symbols(fd);
        }
        
        close(fd);
        return result;
    }
    
    std::vector<Symbol> read_elf64_symbols(int fd) {
        std::vector<Symbol> result;
        
        lseek(fd, 0, SEEK_SET);
        Elf64_Ehdr ehdr;
        if (read(fd, &ehdr, sizeof(ehdr)) != sizeof(ehdr)) {
            return result;
        }
        
        lseek(fd, ehdr.e_shoff, SEEK_SET);
        std::vector<Elf64_Shdr> shdrs(ehdr.e_shnum);
        if (read(fd, shdrs.data(), ehdr.e_shnum * sizeof(Elf64_Shdr)) 
            != static_cast<ssize_t>(ehdr.e_shnum * sizeof(Elf64_Shdr))) {
            return result;
        }
        
        for (size_t i = 0; i < shdrs.size(); ++i) {
            if (shdrs[i].sh_type == SHT_SYMTAB || shdrs[i].sh_type == SHT_DYNSYM) {
                size_t num_syms = shdrs[i].sh_size / sizeof(Elf64_Sym);
                std::vector<Elf64_Sym> syms(num_syms);
                
                lseek(fd, shdrs[i].sh_offset, SEEK_SET);
                read(fd, syms.data(), shdrs[i].sh_size);
                
                Elf64_Shdr& strtab_hdr = shdrs[shdrs[i].sh_link];
                std::vector<char> strtab(strtab_hdr.sh_size);
                lseek(fd, strtab_hdr.sh_offset, SEEK_SET);
                read(fd, strtab.data(), strtab_hdr.sh_size);
                
                for (const auto& sym : syms) {
                    if (ELF64_ST_TYPE(sym.st_info) == STT_FUNC && sym.st_name < strtab.size()) {
                        Symbol s;
                        s.name = &strtab[sym.st_name];
                        s.address = sym.st_value;
                        s.size = sym.st_size;
                        if (!s.name.empty()) {
                            result.push_back(s);
                        }
                    }
                }
            }
        }
        
        return result;
    }
};

} // namespace realbench
