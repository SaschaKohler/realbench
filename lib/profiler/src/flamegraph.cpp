#include "profiler.h"
#include <sstream>
#include <iomanip>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <vector>
#include <cmath>
#include <functional>
#include <memory>

namespace realbench {

// ---------------------------------------------------------------------------
// Flame tree node – built from ProfileResult.call_graph + self-costs
// ---------------------------------------------------------------------------
struct FlameNode {
    std::string name;
    uint64_t self_ir   = 0;   // instruction refs spent in this function itself
    uint64_t total_ir  = 0;   // self + all children (set during tree build)
    std::vector<std::unique_ptr<FlameNode>> children;
};

namespace {

std::string escape_xml(const std::string& str) {
    std::string result;
    result.reserve(str.size());
    for (char c : str) {
        switch (c) {
            case '&':  result += "&amp;";  break;
            case '<':  result += "&lt;";   break;
            case '>':  result += "&gt;";   break;
            case '"':  result += "&quot;"; break;
            case '\'': result += "&apos;"; break;
            default:   result += c;
        }
    }
    return result;
}

std::string escape_json(const std::string& str) {
    std::string result;
    result.reserve(str.size());
    for (char c : str) {
        if (c == '"' || c == '\\') result += '\\';
        result += c;
    }
    return result;
}

// Symbols that add noise and should be excluded from the flame tree
bool is_noise_symbol(const std::string& s) {
    static const char* prefixes[] = {
        "(below ", "(anonymous", "__libc", "__GI_", "_dl_",
        "_start", "__cxa_", "_ZN9__gnu_cxx", "gsignal", "abort",
        "__lll_", "pthread_", "clone", nullptr
    };
    for (int i = 0; prefixes[i]; ++i)
        if (s.rfind(prefixes[i], 0) == 0) return true;
    return false;
}

std::string color_for_name(const std::string& name) {
    // Warm palette: hot functions are red/orange, cool ones yellow/green
    size_t hash = 5381;
    for (char c : name) hash = hash * 33 ^ static_cast<unsigned char>(c);
    // Hue buckets: 0=red, 1=orange, 2=yellow, 3=green
    int bucket = static_cast<int>((hash >> 4) % 4);
    int r, g, b;
    int v = static_cast<int>(hash % 40);  // variation
    switch (bucket) {
        case 0: r = 215 + v/4; g = 40  + v;   b = 10;       break;  // red
        case 1: r = 220 + v/4; g = 120 + v;   b = 10;       break;  // orange
        case 2: r = 200 + v/4; g = 185 + v/2; b = 10;       break;  // yellow
        default:r = 80  + v;   g = 160 + v/2; b = 50 + v/2; break;  // green
    }
    char buf[8];
    snprintf(buf, sizeof(buf), "#%02x%02x%02x", r, g, b);
    return std::string(buf);
}

// Recursively render a flame node (top-down icicle layout).
// y_top is the top of the current frame; children are placed directly below.
void render_node(std::ostringstream& svg, const FlameNode& node,
                 double x, double y_top, double px_per_ir,
                 int depth, int max_depth, uint64_t total_root_ir) {
    if (depth > max_depth) return;
    const int fh = 20;  // frame height px
    double w = node.total_ir * px_per_ir;
    if (w < 1.0) return;

    std::string color = color_for_name(node.name);

    // Truncate label to fit width
    std::string label = node.name;
    // Strip leading namespace/module noise for display
    auto colon = label.rfind("::");
    if (colon != std::string::npos && colon + 2 < label.size())
        label = label.substr(colon + 2);
    size_t max_chars = static_cast<size_t>(w / 7.2);
    if (label.size() > max_chars) {
        if (max_chars > 3) label = label.substr(0, max_chars - 1) + "…";
        else               label.clear();
    }

    double pct = (total_root_ir > 0)
        ? 100.0 * node.total_ir / total_root_ir : 0.0;
    char pct_buf[32];
    snprintf(pct_buf, sizeof(pct_buf), "%.2f%%", pct);

    svg << "  <g class=\"frame\"\n"
        << "     onclick=\"zoom(evt)\">\n"
        << "    <title>" << escape_xml(node.name)
        << " — " << node.total_ir << " IR (" << pct_buf << ")</title>\n"
        << "    <rect x=\"" << std::fixed << std::setprecision(1) << x
        << "\" y=\"" << y_top
        << "\" width=\"" << (w - 0.5)
        << "\" height=\"" << (fh - 1)
        << "\" fill=\"" << color
        << "\" rx=\"2\" stroke=\"#fff8\" stroke-width=\"0.4\"/>\n";
    if (!label.empty() && w > 18) {
        svg << "    <text x=\"" << (x + 4)
            << "\" y=\"" << (y_top + fh - 6)
            << "\" font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"11.5\""
            << " fill=\"#111\" clip-path=\"url(#clip_" << depth << ")\">"  
            << escape_xml(label) << "</text>\n";
    }
    svg << "  </g>\n";

    // Sort children by total_ir descending → biggest left
    std::vector<const FlameNode*> sorted;
    sorted.reserve(node.children.size());
    for (const auto& c : node.children) sorted.push_back(c.get());
    std::sort(sorted.begin(), sorted.end(),
              [](const FlameNode* a, const FlameNode* b){ return a->total_ir > b->total_ir; });

    double cx = x;
    for (const FlameNode* child : sorted) {
        render_node(svg, *child, cx, y_top + fh, px_per_ir, depth + 1, max_depth, total_root_ir);
        cx += child->total_ir * px_per_ir;
    }
}

// ---------------------------------------------------------------------------
// Build a flame tree from call_graph edges + self-costs.
// Noise symbols are filtered. The call_graph stores callee.callers[caller].
// We invert this to caller→[callee] for top-down rendering.
// ---------------------------------------------------------------------------
FlameNode build_flame_tree(const ProfileResult& result) {
    std::unordered_map<std::string, uint64_t> self_map;
    for (const auto& h : result.hotspots) {
        if (!is_noise_symbol(h.symbol))
            self_map[h.symbol] = h.self_samples;
    }

    // caller → [(callee, edge_ir)] — derived from call_graph edges
    std::unordered_map<std::string, std::vector<std::pair<std::string, uint64_t>>> children_map;
    std::unordered_set<std::string> has_parent;
    for (const auto& edge : result.call_graph) {
        if (is_noise_symbol(edge.caller) || is_noise_symbol(edge.callee)) continue;
        children_map[edge.caller].emplace_back(edge.callee, edge.ir);
        has_parent.insert(edge.callee);
    }

    std::unordered_set<std::string> all_syms;
    for (const auto& [s, _] : self_map)    all_syms.insert(s);
    for (const auto& [caller, vec] : children_map) {
        all_syms.insert(caller);
        for (const auto& [callee, _] : vec) all_syms.insert(callee);
    }

    // Roots = symbols that are never a callee (no parent)
    std::vector<std::string> roots;
    for (const auto& sym : all_syms)
        if (!has_parent.count(sym)) roots.push_back(sym);
    if (roots.empty())
        for (const auto& h : result.hotspots)
            if (!is_noise_symbol(h.symbol)) { roots.push_back(h.symbol); break; }

    // Visited set to break cycles
    std::function<std::unique_ptr<FlameNode>(const std::string&, int,
                                              std::unordered_set<std::string>&)> make_node;
    make_node = [&](const std::string& sym, int depth,
                    std::unordered_set<std::string>& visited) -> std::unique_ptr<FlameNode> {
        auto node       = std::make_unique<FlameNode>();
        node->name      = sym;
        node->self_ir   = self_map.count(sym) ? self_map.at(sym) : 0;
        node->total_ir  = node->self_ir;

        if (depth < 32 && !visited.count(sym)) {
            visited.insert(sym);
            auto it = children_map.find(sym);
            if (it != children_map.end()) {
                for (const auto& [callee, edge_ir] : it->second) {
                    auto child = make_node(callee, depth + 1, visited);
                    // edge_ir from callgrind is the inclusive IR for this call arc;
                    // use it directly as child's total width contribution.
                    child->total_ir = std::max(child->total_ir, edge_ir);
                    node->total_ir += child->total_ir;
                    node->children.push_back(std::move(child));
                }
            }
            visited.erase(sym);
        }
        return node;
    };

    FlameNode synthetic_root;
    synthetic_root.name = "all";
    for (const auto& sym : roots) {
        std::unordered_set<std::string> visited;
        auto child = make_node(sym, 0, visited);
        synthetic_root.total_ir += child->total_ir;
        synthetic_root.children.push_back(std::move(child));
    }

    // Fallback: no call graph → flat hotspot list
    if (result.call_graph.empty() || synthetic_root.total_ir == 0) {
        synthetic_root.children.clear();
        synthetic_root.total_ir = result.total_samples;
        for (const auto& h : result.hotspots) {
            if (is_noise_symbol(h.symbol)) continue;
            auto n      = std::make_unique<FlameNode>();
            n->name     = h.symbol;
            n->self_ir  = h.self_samples;
            n->total_ir = h.self_samples;
            synthetic_root.children.push_back(std::move(n));
        }
    }

    return synthetic_root;
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// Public generators
// ---------------------------------------------------------------------------
std::string generate_flamegraph_svg(const ProfileResult& result) {
    // If there are too many samples, return a simplified message instead
    if (result.total_samples > 10000000) {
        return "<svg><text x='10' y='20'>Flamegraph unavailable: too many samples (" + 
               std::to_string(result.total_samples) + ")</text></svg>";
    }
    
    const int svg_width  = 1200;
    const int top_pad    = 60;
    const int bot_pad    = 25;
    const int fh         = 20;

    FlameNode root = build_flame_tree(result);

    // Compute max depth for height calculation
    std::function<int(const FlameNode&)> max_depth_fn;
    max_depth_fn = [&](const FlameNode& n) -> int {
        int d = 0;
        for (const auto& c : n.children)
            d = std::max(d, max_depth_fn(*c));
        return d + 1;
    };
    int depth = std::min(max_depth_fn(root), 32);
    int svg_height = top_pad + (depth + 1) * fh + bot_pad;

    double px_per_ir = (root.total_ir > 0)
        ? (static_cast<double>(svg_width - 2) / root.total_ir)
        : 1.0;

    std::ostringstream svg;
    // viewBox makes it scale in the browser
    svg << R"(<?xml version="1.0" standalone="no"?>)" "\n"
        << "<svg version=\"1.1\""
        << " width=\"" << svg_width << "\" height=\"" << svg_height << "\""
        << " viewBox=\"0 0 " << svg_width << " " << svg_height << "\""
        << " xmlns=\"http://www.w3.org/2000/svg\">\n"
        // Dark background
        << "  <rect width=\"100%\" height=\"100%\" fill=\"#1a1a2e\"/>\n"
        // Title
        << "  <text x=\"" << svg_width/2 << "\" y=\"22\""
        << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"15\""
        << " fill=\"#e0e0e0\" text-anchor=\"middle\" font-weight=\"bold\">RealBench Flamegraph</text>\n"
        << "  <text x=\"" << svg_width/2 << "\" y=\"40\""
        << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"11\""
        << " fill=\"#888\" text-anchor=\"middle\">"
        << result.total_samples << " instruction refs · hover for details</text>\n"
        // Clip paths per depth level to prevent text overflow
        << "  <defs>\n";
    for (int i = 0; i <= depth; ++i) {
        double y_clip = top_pad + i * fh;
        svg << "    <clipPath id=\"clip_" << i << "\"><rect x=\"0\" y=\""
            << y_clip << "\" width=\"" << svg_width << "\" height=\"" << fh << "\"/></clipPath>\n";
    }
    svg << "  </defs>\n";

    // "all" root bar at the top (below title), children grow downward
    double root_y_top = static_cast<double>(top_pad);
    svg << "  <g>\n"
        << "    <title>all (" << root.total_ir << " IR)</title>\n"
        << "    <rect x=\"1\" y=\"" << std::fixed << std::setprecision(1) << root_y_top
        << "\" width=\"" << (svg_width - 2)
        << "\" height=\"" << (fh - 1)
        << "\" fill=\"#4a4a6a\" rx=\"2\" stroke=\"#fff4\" stroke-width=\"0.4\"/>\n"
        << "    <text x=\"4\" y=\"" << (root_y_top + fh - 6)
        << "\" font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"11.5\""
        << " fill=\"#ccc\">all</text>\n  </g>\n";

    // Sort root children
    std::vector<const FlameNode*> sorted_roots;
    sorted_roots.reserve(root.children.size());
    for (const auto& c : root.children) sorted_roots.push_back(c.get());
    std::sort(sorted_roots.begin(), sorted_roots.end(),
              [](const FlameNode* a, const FlameNode* b){ return a->total_ir > b->total_ir; });

    // Children grow downward from root_y_top + fh (directly below "all" bar)
    double cx = 1.0;
    for (const FlameNode* child : sorted_roots) {
        render_node(svg, *child, cx, root_y_top + fh, px_per_ir, 1, 30, root.total_ir);
        cx += child->total_ir * px_per_ir;
    }

    // Bottom legend
    svg << "  <text x=\"4\" y=\"" << (svg_height - 8)
        << "\" font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"10\""
        << " fill=\"#555\">x-axis: cumulative instruction refs · y-axis: call depth</text>\n";

    svg << "</svg>\n";
    return svg.str();
}

std::string generate_flamegraph_json(const std::vector<Hotspot>& hotspots) {
    std::ostringstream json;
    json << "{\n  \"hotspots\": [\n";
    for (size_t i = 0; i < hotspots.size(); ++i) {
        const auto& h = hotspots[i];
        json << "    {\n"
             << "      \"symbol\": \""   << escape_json(h.symbol) << "\",\n"
             << "      \"selfPct\": "    << std::fixed << std::setprecision(2) << h.self_pct  << ",\n"
             << "      \"totalPct\": "   << std::fixed << std::setprecision(2) << h.total_pct << ",\n"
             << "      \"callCount\": "  << h.call_count << "\n"
             << "    }";
        if (i + 1 < hotspots.size()) json << ",";
        json << "\n";
    }
    json << "  ]\n}\n";
    return json.str();
}

} // namespace realbench
