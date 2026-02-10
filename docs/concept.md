# Detach - Concept

### Core Concept

A mobile-first application for managing AI coding agents (Claude Code, etc.) asynchronously. The key insight: this isn't "coding on mobile" - it's **managing a junior dev from your phone**.

**Primary workflow:**
1. Queue up a coding task from your phone (commuting, waiting, etc.)
2. AI agent executes in a cloud sandbox
3. Get push notification when complete
4. Review diff in a mobile-optimized UI
5. Approve/reject/request changes
6. Agent commits and pushes, or iterates

---

### Technical Architecture

| Component | Decision |
|-----------|----------|
| Execution environment | Cloud sandbox (you provide) |
| AI model access | BYOK (bring your own key) - user pays for AI |
| Codebase access | Clone repo to sandbox |
| Mobile apps | Native iOS/Android (not responsive web) |

**Current MVP implementation:** Four-panel web interface (LLM terminal with Claude Code, Git UI, shell Terminal, file browser) connecting to remote sandbox via WebSocket bridge.

---

### Key Features

- **Push notifications** for task completion
- **Mobile-optimized diff viewer** (touch-friendly, not desktop afterthought)
- **Voice input** for task descriptions
- **Queue management** - stack multiple tasks, prioritize
- **Review/approval flow** as the core UX
- Multi-provider support (Claude, GPT, local models via API)

---

### Business Model

- **Open core licensing:**
  - Open source: backend, sandbox orchestration, API
  - Closed/source-available: mobile apps
  - Monetize: hosted service + mobile apps, subscription pricing

- **Pricing:** ~$10-20/month subscription
- **Margins:** High (BYOK means no AI costs to absorb)

---

### Market Positioning

**What you're NOT competing with:**
- Claude Code (CLI-first, desktop)
- Cursor/Windsurf (IDE-based)
- Existing web UIs (desktop-optimized afterthoughts)

**What you ARE:**
- The async management layer on top of AI coding tools
- Mobile command center for developers who aren't always at their desk
- "Review and approve" workflow, not "write code on tiny screen"

---

### Validation of the Problem

- Developers complain about lack of proper diff/review UX in Claude Code
- Claude Code's non-interactive mode is slow and doesn't support async/background operation
- Existing web UIs (claude-code-webui, cui) are desktop-first
- Anthropic shipped Claude Code web in October 2025, but it's not mobile-optimized

---

### Strengths

| Factor | Assessment |
|--------|------------|
| Scratches your own itch | Yes - you said you "absolutely need it" |
| Sharp positioning | "Mobile + async + review" is specific and underserved |
| BYOK model | High margins, no AI cost exposure |
| Developer tools pricing | $15-25/month is normal and accepted |
| Skills match | Senior SWE can build this properly |
| Open source distribution | HN-friendly, builds trust for BYOK/repo access |

---

### Risks

| Risk | Mitigation |
|------|------------|
| Platform risk (Anthropic ships this) | Open source backend, multi-provider support |
| Surface area (mobile + infra + auth) | Build for yourself first, scope ruthlessly |
| Marketing as solo founder | Open source + indie hacker community + "built for myself" story |
| Niche may be small | Validate with community before scaling |

---

### Financial Projections

**Revenue targets:**
- $15/month subscription
- 170k TC replacement = ~$14k/month net = ~1,000 subscribers

**Probability estimates:**
- 50-60% chance: $2-5k MRR (solid side income)
- 25-30% chance: $10-15k MRR (job replacement territory)
- 10-15% chance: larger outcome (acqui-hire, trend wave)

---

### Downside Protection

Even if it fails commercially, you get:
- Portfolio piece with relevant buzzwords (mobile, cloud, AI, sandbox orchestration)
- Open source visibility and GitHub stars
- Network in indie hacker / devtools / AI community
- Skills: mobile dev, cloud infra, auth, billing
- Strong interview fodder

**The only way this fails entirely is if you abandon it after two weeks.**

---

### Recommended Path

1. Build minimal PWA with mobile-optimized diff viewer wrapping Claude Code headless
2. Use it yourself daily for 1 month
3. Open source the backend
4. Post on HN / Twitter / indie communities
5. See if "mobile + async + review" framing resonates
6. If traction: native apps + hosted service + subscription
