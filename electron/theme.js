/**
 * Claude Desktop Theme
 *
 * Design tokens extracted from Claude Desktop app.asar
 * Source: /Applications/Claude.app/Contents/Resources/app.asar
 *
 * These values should be used to style the sidecar Electron window
 * to visually match Claude Desktop.
 *
 * Spec Reference: §14.3 Styling Investigation
 */

module.exports = {
  // Light theme values (default)
  light: {
    background: '#faf9f5',
    foreground: '#000000',
    secondary: '#737163',
    border: 'rgba(112, 107, 87, 0.25)',
    borderStrong: 'rgba(112, 107, 87, 0.65)',
    text: {
      primary: '#29261b',
      secondary: '#3d3929',
      muted: '#656358',
      description: '#535146'
    }
  },

  // Dark theme values (.darkTheme class in Claude Desktop)
  dark: {
    background: '#262624',
    foreground: '#ffffff',
    secondary: '#a6a39a',
    border: 'rgba(234, 221, 216, 0.1)',
    borderStrong: 'rgba(108, 106, 96, 0.58)',
    text: {
      primary: '#f5f4ef',
      secondary: '#e5e5e2',
      muted: '#b8b5a9',
      description: '#ceccc5'
    }
  },

  // Accent colors (shared between themes)
  accent: {
    brand: '#d97757',        // Clay orange - primary brand color
    brandHover: '#c9674a',   // Slightly darker for hover
    success: '#4a9137',      // Green for success states
    successDark: '#2d5a27',  // Darker green (used in sidecar FOLD button)
    danger: '#b94545',       // Red for errors/warnings
    pro: '#7c5dd6',          // Purple for pro features
    secondary: '#3b8ed8'     // Blue for secondary actions
  },

  // Typography
  fonts: {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
  },

  // Spacing and sizing
  spacing: {
    titleBarHeight: '28px',
    borderRadius: '4px',
    borderRadiusLarge: '8px'
  },

  // Helper function to convert HSL values from CSS to hex
  // Claude Desktop uses HSL format: "15 63.1% 59.6%"
  hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }
};
