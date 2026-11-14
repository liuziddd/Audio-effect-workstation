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
                'neon-blue': '#2450FF',
                'neon-purple': '#5B7BFF',
                'neon-green': '#A6FF00',
            },
        },
    },
    plugins: [],
}
