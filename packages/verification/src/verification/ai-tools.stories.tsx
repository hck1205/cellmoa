/**
 * The reference's own tooling, on its own website.
 *
 * None of these is a grid feature. They are listed so a reader working through
 * the table of contents is not left wondering whether they were missed.
 */

import { NotAFeature } from '../Compare.js';

export default { title: 'Verification/AI tools' };

export const AiDocsAssistant = () => (
  <NotAFeature
    page="AI Docs Assistant"
    path="ai-docs-assistant"
    why="A chat box on the reference's documentation site."
  />
);

export const AiThemeBuilder = () => (
  <NotAFeature
    page="AI Theme Builder"
    path="ai-theme-builder"
    why="A generator on the reference's website that emits a theme's custom properties. cellmoa's themes are the same shape — a set of `--ht-*` values — but it consumes eleven of the roughly 334 the reference defines, so most of what such a generator emits would have nothing reading it."
  />
);

export const SkillsForClaudeCode = () => (
  <NotAFeature
    page="Skills for Claude Code"
    path="skills-for-claude-code"
    why="A plugin the reference publishes for an editor. Not part of the library."
  />
);
