---
doc_sync_id: "91843c69-ee99-414c-8d24-bda888e414c3"
---

# WebUI UX Improvement Plan

> Comprehensive redesign plan for the agent-bundle WebUI.
> Synthesized from layout analysis, competitive research (8 platforms), and interaction audit (10 areas).
> This document is the single source of truth for all subsequent implementation work.

---

## 1. Problem Statement

The current 3-panel layout `[FileTree 280px | Chat (flex:1) | Preview 360px]` places the chat panel between the file tree and the file preview. This creates a fundamental UX problem:

- **Broken visual flow**: Users must cross the entire chat column (500-800px) to go from selecting a file (left) to seeing its preview (right). This violates Fitts's Law and breaks the primary workflow loop: **browse file -> preview content -> iterate**.
- **Preview is secondary**: The preview panel (360px) is narrower than chat, despite visual output (charts, images, code) being the primary artifact in data analysis workflows.
- **GTM misalignment**: The GTM demo strategy emphasizes that "high-visual-output demos generate disproportionate social sharing." The current layout buries visual output in a narrow side panel.

### User's Core Complaint

> "Chat 放在中间阻碍了文件树和 preview 之间的动线" — Chat in the middle blocks the flow between file tree and preview.

---

## 2. Competitive Landscape Summary

Analysis of 8 major platforms (Claude.ai, Cursor, v0, Lovable, Bolt.new, OpenHands, Windsurf, Replit) reveals:

| Pattern | Used By | Fit for Us |
|---------|---------|------------|
| Chat LEFT, Preview RIGHT | Claude.ai, v0, Lovable, Bolt.new | Good for code-gen, but chat dominates screen |
| File tree LEFT, Editor CENTER, Chat RIGHT sidebar | Cursor, Windsurf, Replit | Strong — output is hero, chat is companion |
| Tabbed output panel | Bolt.new, Replit | Excellent — allows preview/code/terminal switching |
| Collapsible file tree | Cursor, Replit, Windsurf | Standard — file tree is navigation, not a primary panel |

**Key insight**: Code-generation platforms put chat on the left because conversation IS the primary artifact. But for **data analysis agents**, the visual output (charts, tables, files) is the primary artifact. Our layout should make the output the hero.

---

## 3. Recommended Layout: Workspace-Centric

### New Layout

```
[FileTree 220px] | [Workspace (flex:1, hero)] | [Chat Sidebar 380px]
```

```
+------------+----------------------------------------+-------------------+
| FILE TREE  |           WORKSPACE (hero)             |  CHAT SIDEBAR     |
| 220px      |           flex: 1                      |  380px            |
|            |                                        |                   |
| /workspace | +------------------------------------+ | +---------------+ |
| > data/    | |                                    | | | Agent msg...  | |
|   sales.csv| |    File Preview / Output            | | | Tool: Write   | |
| > output/  | |    (charts, code, images)           | | | Agent msg...  | |
|   chart.png| |                                    | | |               | |
|   report.md| |    Tabs: [Preview] [Terminal]       | | |               | |
|            | |                                    | | |               | |
|            | +------------------------------------+ | +---------------+ |
|            |                                        | | [Send a msg...] |
+------------+----------------------------------------+-------------------+
```

### Why This Layout

1. **Solves the core complaint**: File tree and workspace/preview are adjacent. Click a file, see it immediately in the large center area. Zero crossing distance.

2. **Output is the hero**: On a 1440px screen, the workspace gets ~840px width. Charts and images render at hero size — perfect for demo recordings and screenshots.

3. **Chat stays always-visible**: Unlike overlay approaches, users never lose conversation context. 380px is wider than Slack's sidebar (~340px) and sufficient for most agent responses.

4. **GTM-optimal**: The workspace dominates the screen. Screenshots and screen recordings naturally showcase the visual output, not the chat.

### Panel Widths by Screen Size

| Screen | FileTree | Workspace | Chat |
|--------|----------|-----------|------|
| 1920px | 220px | ~1320px | 380px |
| 1440px | 220px | ~840px | 380px |
| 1280px | 220px | ~680px | 380px |
| 1024px | hidden | ~644px | 380px |
| 768px | hidden | 100% | bottom sheet |

### Workspace Area Details

The workspace area contains:

- **Tab bar**: `[Preview] [Terminal]` tabs at the top
- **Preview tab** (default): Shows the currently selected file (code with syntax highlighting, images, or a welcome/empty state)
- **Terminal tab**: Full xterm.js terminal output
- **Empty state**: When no file is selected, show a subtle placeholder with the agent icon and a hint like "Select a file to preview, or send a message to get started"

### Chat Sidebar Details

The chat sidebar contains (top to bottom):

- **Chat header**: Agent name + status badge (moved from main header)
- **Chat messages**: Scrollable message area (user bubbles, agent cards, tool calls)
- **Chat input**: Textarea + send button at the bottom (always pinned)

### Header Simplification

The main header becomes minimal:

- Logo (`agent·bundle`) on the left
- File tree toggle button (hamburger) — always visible, toggles the left panel
- Status badge stays in the chat sidebar header

---

## 4. Interaction Improvements

### 4.1 File Tree

| Issue | Fix | Priority |
|-------|-----|----------|
| Directories cannot collapse/expand | Add click-to-toggle with `expandedDirs` Set; rotate chevron icon | **P0** |
| Full innerHTML rebuild on poll | Diff-based update preserving scroll position and expand state | **P1** |
| No keyboard navigation | Arrow keys, Enter to open, Left/Right to collapse/expand | **P2** |
| No tree lines | Add 1px vertical connector lines for nesting | **P2** |
| Width too wide (280px) | Reduce to 220px; file names are short | **P1** |

### 4.2 Chat Messages

| Issue | Fix | Priority |
|-------|-----|----------|
| No copy button on code blocks | Add clipboard icon on hover for code blocks | **P0** |
| Auto-scroll hijacks during streaming | Only scroll if user is within 100px of bottom; add "scroll to bottom" pill | **P0** |
| No elapsed time on tool calls | Show "running... 3s" with timer, "done (2.1s)" on completion | **P1** |
| Full-width agent messages feel monotonous | Cap agent message width at ~600px within the 380px sidebar | **P1** |
| No visual grouping of response + tools | Add subtle left border connecting related messages | **P2** |

### 4.3 Welcome State

| Issue | Fix | Priority |
|-------|-----|----------|
| Generic lightning bolt emoji | Replace with a purpose-specific animated SVG or meaningful icon | **P1** |
| No capability description | Add 1-2 sentence description below subtitle | **P0** |
| Instant disappear (no transition) | Fade-out + scale-down animation (~200ms) before hide | **P1** |
| All prompt chips look identical | Add distinct color tints per chip (violet, teal, blue) | **P2** |

**Welcome state placement**: In the new layout, the welcome state appears in the **workspace area** (center), not in the chat sidebar. This makes the first impression large and visually impactful.

### 4.4 File Preview (Now Workspace)

| Issue | Fix | Priority |
|-------|-----|----------|
| Too narrow (360px) | Now flex:1 — gets maximum available width | **P0** (solved by layout) |
| No line numbers in code | Add CSS counter-based line numbers | **P1** |
| No tab support | Add tab bar for multiple open files | **P2** |
| No auto-refresh on file change | Re-fetch when `files_changed` fires for active file | **P1** |
| No entrance/exit animation | Slide-in animation when opening a file | **P1** |
| Only filename shown, no path | Show relative path in breadcrumb format | **P1** |

### 4.5 Terminal

| Issue | Fix | Priority |
|-------|-----|----------|
| Terminal between chat and input (disruptive) | Move to workspace tab — no longer disrupts chat flow | **P0** (solved by layout) |
| Auto-expands intrusively | Only auto-switch to terminal tab on first tool call per session | **P1** |
| No resize handle | Terminal tab uses full workspace height — no resize needed | **P0** (solved by layout) |
| No clear button | Add clear button to terminal tab header | **P2** |

### 4.6 Image Handling

| Issue | Fix | Priority |
|-------|-----|----------|
| Images appended at end of message, not inline | Insert images at their markdown reference position | **P1** |
| No loading skeleton while fetching | Add pulsing placeholder while base64 loads | **P1** |
| Lightbox has no zoom | Add click-to-toggle between fit-to-screen and actual-size | **P2** |
| No download button in lightbox | Add download icon button in modal overlay | **P2** |

---

## 5. Visual Design Refinements

### 5.1 Color & Contrast

| Token | Current | Proposed | Reason |
|-------|---------|----------|--------|
| `--bg-card` | `rgba(255,255,255,0.03)` | `rgba(255,255,255,0.05)` | Better message card contrast |
| `--border` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.08)` | Clearer panel boundaries |
| `--text-muted` | `#52525b` | `#71717a` | WCAG AA compliance (4.5:1 ratio) |
| Tool call header | Teal (same as code) | Blue (`--blue`) | Differentiate tools from inline code |

### 5.2 Typography

| Element | Current | Proposed | Reason |
|---------|---------|----------|--------|
| Welcome subtitle | font-weight: 300 | font-weight: 400 | Better readability on dark bg |
| Chat sidebar agent msgs | 14px | 13px | Fit more content in 380px width |
| Code in preview | 12px | 13px | Better readability at larger preview width |

### 5.3 Animations

| Animation | Status | Action |
|-----------|--------|--------|
| `slideInLeft` | Defined, unused | Apply to file tree entrance on mobile |
| `slideInRight` | Defined, unused | Apply to chat sidebar entrance on mobile |
| `glowPulse` | Defined, unused | Remove (dead CSS) |
| Welcome exit | Missing | Add fade-out + scale-down (200ms) |
| File preview entrance | Missing | Add content fade-in (200ms) |
| Prompt chip stagger | Missing | Add 50ms delay per chip on load |
| Skeleton loading | Missing | Add pulsing bar pattern for async content |

### 5.4 `prefers-reduced-motion`

Add a media query that disables non-essential animations:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 6. Responsive Breakpoints

### Desktop (>1024px): 3-column layout
```
[FileTree 220px | Workspace (flex:1) | Chat 380px]
```

### Tablet (768px-1024px): 2-column, file tree as overlay
```
[Workspace (flex:1) | Chat 380px]
File tree: hamburger menu -> slide-in overlay from left
```

### Mobile (<768px): Single column with bottom sheet
```
[Workspace (100%)]
Chat: bottom sheet (swipe up to expand)
File tree: hamburger menu -> slide-in overlay from left
```

### Phone (<480px): Tighter mobile
Same as mobile, with:
- Reduced padding (10px instead of 16px)
- 44px minimum touch targets (current send button is 34px — fix)
- Font sizes: 13px base

### Missing Elements to Add
- Hamburger menu toggle button in header (currently missing from HTML)
- `.panel-overlay` backdrop element (currently missing from HTML)
- 2-column prompt chip grid at 768-1024px range

---

## 7. Accessibility Fixes

### Critical (P0)
- Add `role="log"` and `aria-live="polite"` to chat messages container
- Add `role="status"` and `aria-live="polite"` to status badge
- Fix `--text-muted` contrast ratio to meet WCAG AA (4.5:1)
- Add hamburger menu button for mobile file tree access

### Important (P1)
- Add proper ARIA tree roles to file tree (`role="tree"`, `role="treeitem"`, `aria-expanded`, `aria-level`)
- Add keyboard navigation to file tree (arrow keys, Enter)
- Add `aria-expanded` to tool call toggle headers
- Add focus trap to image modal
- Improve modal image `alt` text to include filename

### Nice-to-have (P2)
- Add skip-to-content link
- Add `tabindex="0"` to all interactive non-button elements
- Add `prefers-reduced-motion` support

---

## 8. Implementation Scope

### Phase 1: Layout Restructure (This PR)

**Files to modify:**
- `src/webui/public/index.html` — Restructure panel order, add workspace tabs, move chat to sidebar
- `src/webui/public/styles.css` — New layout CSS, workspace styles, chat sidebar styles, tab styles
- `src/webui/public/app.js` — Tab switching logic, welcome state in workspace, terminal in tab

**What changes:**
1. HTML: Reorder panels to `[file-panel | workspace-panel | chat-sidebar]`
2. HTML: Add tab bar in workspace (`[Preview] [Terminal]`)
3. HTML: Move welcome state into workspace area
4. HTML: Move chat messages + input into chat sidebar
5. HTML: Add hamburger menu button to header
6. CSS: Workspace becomes `flex:1`, file tree becomes `220px`, chat sidebar becomes `380px`
7. CSS: Add tab styles for workspace
8. CSS: Chat sidebar styling (messages, input, header)
9. CSS: Responsive breakpoints updated
10. JS: Tab switching between Preview and Terminal
11. JS: Welcome state shows in workspace, hides when first file appears or first message sent
12. JS: File tree collapse/expand with state tracking

**What does NOT change (preserve):**
- WebSocket connection and event handling
- All message rendering logic (user, agent, tool, error, thinking)
- File polling and tree data structure
- Image detection and lightbox
- xterm.js terminal setup
- Markdown rendering pipeline
- All API endpoints

### Phase 2: Micro-Interactions (Follow-up)
- Copy button on code blocks
- Auto-scroll fix
- Tool call elapsed time
- File preview auto-refresh
- Skeleton loading states
- Animation polish

### Phase 3: Accessibility (Follow-up)
- ARIA tree roles
- Keyboard navigation
- Focus management
- Contrast fixes
- Reduced motion support

---

## 9. Acceptance Criteria

The following must be true after Phase 1 implementation:

- [ ] Layout is `[FileTree 220px | Workspace (flex:1) | Chat 380px]`
- [ ] Clicking a file in the tree opens it in the workspace preview (adjacent, no crossing)
- [ ] Workspace has tab bar with [Preview] and [Terminal] tabs
- [ ] Terminal output appears in the Terminal tab (not between chat and input)
- [ ] Welcome state appears in the workspace area (large, centered)
- [ ] Chat messages and input are in the right sidebar
- [ ] Chat input remains pinned at bottom of sidebar
- [ ] Streaming text, tool calls, and thinking indicator work correctly in chat sidebar
- [ ] File tree directories can be collapsed/expanded
- [ ] Hamburger menu toggles file tree on tablet/mobile
- [ ] Status badge visible in chat sidebar header
- [ ] All existing functionality preserved (WebSocket, file polling, image modal, etc.)
- [ ] No visual regressions at 1440px, 1280px, 1024px, 768px, 480px breakpoints
