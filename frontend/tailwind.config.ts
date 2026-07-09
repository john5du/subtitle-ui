import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/hooks/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      colors: {
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        "ring-soft": "var(--ring-soft)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)"
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)"
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)"
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)"
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
          soft: "var(--destructive-soft)",
          border: "var(--destructive-border)",
          muted: "var(--destructive-muted)"
        },
        success: {
          DEFAULT: "var(--success)",
          foreground: "var(--success-foreground)",
          soft: "var(--success-soft)",
          border: "var(--success-border)",
          muted: "var(--success-muted)"
        },
        warning: {
          DEFAULT: "var(--warning)",
          foreground: "var(--warning-foreground)",
          soft: "var(--warning-soft)",
          border: "var(--warning-border)",
          muted: "var(--warning-muted)"
        },
        info: {
          DEFAULT: "var(--info)",
          foreground: "var(--info-foreground)",
          soft: "var(--info-soft)",
          border: "var(--info-border)",
          muted: "var(--info-muted)"
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)"
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)"
        },
        "surface-subtle": "var(--surface-subtle)",
        "surface-strong": "var(--surface-strong)",
        "surface-hover": "var(--surface-hover)",
        "foreground-muted": "var(--foreground-muted)",
        "foreground-subtle": "var(--foreground-subtle)",
        "ring-offset": "var(--ring-offset)",
        overlay: {
          DEFAULT: "var(--overlay)",
          strong: "var(--overlay-strong)"
        }
      }
    }
  },
  plugins: []
};

export default config;
