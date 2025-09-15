# Copilot Instructions for HeIsComing

## Project Overview
This project appears to be a browser-based game or simulation, with assets and scripts organized for modularity and extensibility. The main entry point is likely `index.html`, which loads core scripts such as `heic_sim.js` and `heic_effects.js`.

## Architecture & Key Components
- **Assets**: Images for stats and items are stored in `/assets`, `/icons`, and `/items`. Use these for UI and gameplay features.
- **Scripts**: Core logic is in `heic_sim.js` (simulation/game logic) and `heic_effects.js` (visual or gameplay effects). Additional scripts may be in `/scripts`.
- **Data**: Game configuration and overrides are in `details.json` and `stats_overrides.json`.
- **Items**: Each item has its own folder under `/items`, supporting modular item definitions and assets.

## Developer Workflows
- **No build system detected**: Code runs directly in the browser via `index.html`. Edit JS/JSON/HTML files and refresh the browser to test changes.
- **Debugging**: Use browser dev tools for JS debugging. Console logs are the primary debugging method.
- **Testing**: No automated tests detected. Manual testing via browser is standard.

## Project-Specific Patterns
- **Item Modularity**: Each item is a folder under `/items` with its own assets and possibly scripts. When adding new items, follow this structure.
- **Stat Icons**: Stat icons (armor, attack, health, speed) are duplicated in `/assets` and `/icons`. Use the appropriate path for UI context.
- **Overrides**: Use `stats_overrides.json` to customize or override default stat values for items or entities.

## Integration Points
- **Main HTML**: All scripts and assets are loaded via `index.html`. Ensure new scripts are referenced here.
- **JSON Data**: Game logic reads from `details.json` and `stats_overrides.json` for configuration.

## External Dependencies
- No package manager dependencies detected (no node_modules). All code appears to be custom and self-contained.

## Example: Adding a New Item
1. Create a new folder under `/items` (e.g., `/items/new_item/`).
2. Add item assets (e.g., icon, image) to the folder.
3. Update `details.json` and/or `stats_overrides.json` if the item has custom stats or configuration.
4. Reference the new item in relevant scripts or UI components.

## Key Files & Directories
- `index.html`: Main entry point
- `heic_sim.js`, `heic_effects.js`: Core logic
- `/items/`: Modular item definitions
- `/assets/`, `/icons/`: Stat and item images
- `details.json`, `stats_overrides.json`: Game configuration

---
_If any section is unclear or missing important project-specific details, please provide feedback or point to relevant files to improve these instructions._
