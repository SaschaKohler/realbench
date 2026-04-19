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

std::string color_for_name(const std::string& name) {
    size_t hash = 5381;
    for (char c : name) hash = hash * 33 ^ static_cast<unsigned char>(c);
    int r = 200 + static_cast<int>(hash % 56);
    int g = 80  + static_cast<int>((hash >> 8) % 120);
    int b = 30  + static_cast<int>((hash >> 16) % 80);
    char buf[8];
    snprintf(buf, sizeof(buf), "#%02x%02x%02x", r, g, b);
    return std::string(buf);
}

// Recursively render a flame node into the SVG stream.
// y_top is the TOP of the current row (flames grow upward from the bottom).
void render_node(std::ostringstream& svg, const FlameNode& node,
                 double x, double y_top, double px_per_ir,
                 int depth, int max_depth) {
    if (depth > max_depth) return;
    const int fh = 18;  // frame height px
    double w = node.total_ir * px_per_ir;
    if (w < 0.5) return;

    std::string color = color_for_name(node.name);
    std::string label = node.name;
    size_t max_chars = static_cast<size_t>(w / 7.0);
    if (label.size() > max_chars && max_chars > 3)
        label = label.substr(0, max_chars - 1) + "…";
    else if (label.size() > max_chars)
        label.clear();

    // tooltip via <title>
    svg << "  <g>\n"
        << "    <title>" << escape_xml(node.name) << " (" << node.total_ir << " IR)</title>\n"
        << "    <rect x=\"" << std::fixed << std::setprecision(1) << x
        << "\" y=\"" << y_top
        << "\" width=\"" << w
        << "\" height=\"" << fh
        << "\" fill=\"" << color
        << "\" stroke=\"white\" stroke-width=\"0.5\"/>\n";
    if (!label.empty() && w > 14) {
        svg << "    <text x=\"" << (x + 2)
            << "\" y=\"" << (y_top + fh - 5)
            << "\" font-family=\"Verdana\" font-size=\"11\" fill=\"black\">"
            << escape_xml(label) << "</text>\n";
    }
    svg << "  </g>\n";

    // Sort children by total_ir descending so biggest is leftmost
    std::vector<const FlameNode*> sorted;
    sorted.reserve(node.children.size());
    for (const auto& c : node.children) sorted.push_back(c.get());
    std::sort(sorted.begin(), sorted.end(),
              [](const FlameNode* a, const FlameNode* b){ return a->total_ir > b->total_ir; });

    double cx = x;
    for (const FlameNode* child : sorted) {
        render_node(svg, *child, cx, y_top - fh, px_per_ir, depth + 1, max_depth);
        cx += child->total_ir * px_per_ir;
    }
}

// ---------------------------------------------------------------------------
// Build a flame tree from call_graph edges + self-costs.
// Returns a synthetic root whose children are the top-level call roots.
// ---------------------------------------------------------------------------
FlameNode build_flame_tree(const ProfileResult& result) {
    // self-cost per symbol
    std::unordered_map<std::string, uint64_t> self_map;
    for (const auto& h : result.hotspots) {
        self_map[h.symbol] = h.self_samples;
    }

    // children map: parent → [(child, edge_ir)]
    std::unordered_map<std::string, std::vector<std::pair<std::string, uint64_t>>> children_map;
    std::unordered_set<std::string> has_caller;
    for (const auto& edge : result.call_graph) {
        children_map[edge.caller].push_back({edge.callee, edge.ir});
        has_caller.insert(edge.callee);
    }

    // Collect all known symbols
    std::unordered_set<std::string> all_syms;
    for (const auto& h  : result.hotspots)    all_syms.insert(h.symbol);
    for (const auto& e  : result.call_graph)  { all_syms.insert(e.caller); all_syms.insert(e.callee); }

    // Root symbols = those that appear as callers but never as callees,
    // or symbols with self cost but no callers at all.
    std::vector<std::string> roots;
    for (const auto& sym : all_syms) {
        if (!has_caller.count(sym)) roots.push_back(sym);
    }
    // If everything has callers (cycle / missing root) fall back to top hotspots
    if (roots.empty()) {
        for (const auto& h : result.hotspots) roots.push_back(h.symbol);
    }

    // Recursive builder (iterative depth limit to avoid cycles)
    std::function<std::unique_ptr<FlameNode>(const std::string&, int)> make_node;
    make_node = [&](const std::string& sym, int depth) -> std::unique_ptr<FlameNode> {
        auto node = std::make_unique<FlameNode>();
        node->name    = sym;
        node->self_ir = self_map.count(sym) ? self_map[sym] : 0;
        node->total_ir = node->self_ir;

        if (depth < 30) {
            auto it = children_map.find(sym);
            if (it != children_map.end()) {
                for (const auto& [callee, edge_ir] : it->second) {
                    auto child = make_node(callee, depth + 1);
                    // Use edge_ir as the child's total contribution from this caller
                    // but cap it to avoid over-counting recursive calls
                    child->total_ir = std::max(child->total_ir, edge_ir);
                    node->total_ir += child->total_ir;
                    node->children.push_back(std::move(child));
                }
            }
        }
        return node;
    };

    FlameNode synthetic_root;
    synthetic_root.name = "all";
    for (const auto& sym : roots) {
        auto child = make_node(sym, 0);
        synthetic_root.total_ir += child->total_ir;
        synthetic_root.children.push_back(std::move(child));
    }

    // If call_graph is empty (no edges tracked), fall back to flat list from hotspots
    if (result.call_graph.empty()) {
        synthetic_root.children.clear();
        synthetic_root.total_ir = result.total_samples;
        for (const auto& h : result.hotspots) {
            auto n = std::make_unique<FlameNode>();
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
    const int svg_width  = 1200;
    const int top_pad    = 55;
    const int bot_pad    = 10;
    const int fh         = 18;

    FlameNode root = build_flame_tree(result);

    // Compute max depth for height calculation
    std::function<int(const FlameNode&)> max_depth_fn;
    max_depth_fn = [&](const FlameNode& n) -> int {
        int d = 0;
        for (const auto& c : n.children)
            d = std::max(d, max_depth_fn(*c));
        return d + 1;
    };
    int depth = max_depth_fn(root);
    int svg_height = top_pad + depth * fh + bot_pad;

    double px_per_ir = (root.total_ir > 0)
        ? (static_cast<double>(svg_width) / root.total_ir)
        : 1.0;

    std::ostringstream svg;
    svg << R"(<?xml version="1.0" standalone="no"?>)" "\n"
        << "<svg version=\"1.1\" width=\"" << svg_width << "\" height=\"" << svg_height << "\""
        << " xmlns=\"http://www.w3.org/2000/svg\">\n"
        << "  <defs><linearGradient id=\"bg\" y1=\"0\" y2=\"1\" x1=\"0\" x2=\"0\">"
        << "<stop stop-color=\"#f8f8f0\" offset=\"5%\"/>"
        << "<stop stop-color=\"#e8e8c0\" offset=\"95%\"/>"
        << "</linearGradient></defs>\n"
        << "  <rect width=\"" << svg_width << "\" height=\"" << svg_height << "\" fill=\"url(#bg)\"/>\n"
        << "  <text x=\"" << svg_width/2 << "\" y=\"20\" font-family=\"Verdana\" font-size=\"15\""
        << " fill=\"#222\" text-anchor=\"middle\">RealBench Flamegraph</text>\n"
        << "  <text x=\"" << svg_width/2 << "\" y=\"38\" font-family=\"Verdana\" font-size=\"11\""
        << " fill=\"#666\" text-anchor=\"middle\">" << result.total_samples << " instruction refs</text>\n";

    // Render from bottom up: root bar at y = svg_height - bot_pad - fh
    double root_y = static_cast<double>(svg_height - bot_pad - fh);

    // Render root bar
    svg << "  <g><title>all (" << root.total_ir << " IR)</title>"
        << "<rect x=\"0\" y=\"" << std::fixed << std::setprecision(1) << root_y
        << "\" width=\"" << svg_width << "\" height=\"" << fh
        << "\" fill=\"#c0c0c0\" stroke=\"white\" stroke-width=\"0.5\"/>"
        << "<text x=\"2\" y=\"" << (root_y + fh - 5)
        << "\" font-family=\"Verdana\" font-size=\"11\" fill=\"black\">all</text></g>\n";

    // Sort root children
    std::vector<const FlameNode*> sorted_roots;
    sorted_roots.reserve(root.children.size());
    for (const auto& c : root.children) sorted_roots.push_back(c.get());
    std::sort(sorted_roots.begin(), sorted_roots.end(),
              [](const FlameNode* a, const FlameNode* b){ return a->total_ir > b->total_ir; });

    double cx = 0.0;
    for (const FlameNode* child : sorted_roots) {
        render_node(svg, *child, cx, root_y - fh, px_per_ir, 0, 28);
        cx += child->total_ir * px_per_ir;
    }

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
