import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{allowedHosts:["terminal.local"]},build:{target:'safari15',cssTarget:'safari15',modulePreload:{polyfill:true},sourcemap:false}});
