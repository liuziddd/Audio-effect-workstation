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
                'dark-surface': '#141418',
                'dark-border': '#232329',
                'neon-blue': '#2450FF',
                'neon-purple': '#5B7BFF',
                'neon-green': '#A6FF00',
                'neon-orange': '#9CA3AF',
            },
            boxShadow: {
                'neon': '0 0 20px currentColor',
            }
        },
    },
    plugins: [],
}
