# Wethaq UI design system

**Primary:** Navy `#0F2A44`, Olive `#8A9A4B`, Deep Olive `#5F6B32`.
**Canvas:** `#F7F8FA`. **Surfaces:** White. **Border:** `#E4E9EC`.
**Status:** dark olive success, muted amber warning, restrained brick-red failure, navy-derived blue informational.

- Sidebar 265 px (79–80 px collapsed); white, sticky top header; rounded 20 px cards.
- Most buttons 43px high with 13px radius; dialog radius 24px, inputs 12px radius.
- 8px-based spacing with 4px refinements. Responsive grids stack on narrower displays.
- Soft diffused borders and shadows. All interactive controls have hover/press/focus states.
- Type: Inter/Manrope/JetBrains Mono with local system-font fallback; no runtime font dependency.
- Motion: mostly 150–250 ms. Reduced-motion media query turns off animations.
- Brand SVG assets are copied unmodified from the user-supplied archive; the green variants are excluded.

Global tokens and component styles live in `src/styles.css` and can be refined in one place.
