/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                'dark-bg': '#0a0a0a',
                'dark-surface': '#1a1a1a',
                'dark-border': '#2a2a2a',
                'neon-blue': '#00d4ff',
                'neon-purple': '#b84cff',
                'neon-green': '#39ff73',
                'neon-orange': '#ff6b35',
            },
            boxShadow: {
                'neon': '0 0 20px currentColor',
                'neon-lg': '0 0 40px currentColor',
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'glow': 'glow 2s ease-in-out infinite alternate',
            },
            keyframes: {
                glow: {
                    '0%': { boxShadow: '0 0 20px currentColor' },
                    '100%': { boxShadow: '0 0 40px currentColor, 0 0 60px currentColor' },
                }
            }
        },
    },
    plugins: [],
} 