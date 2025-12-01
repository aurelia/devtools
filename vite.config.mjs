import { defineConfig } from 'vite';
import aurelia from '@aurelia/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import copy from 'rollup-plugin-copy';

export default defineConfig(({ mode }) => {
  const production = mode === 'production';
  
  return {
    root: '.',
    plugins: [
      tailwindcss(),
      aurelia(),
      copy({
        targets: [
          { src: 'src/popups', dest: 'dist' },
          { src: 'images', dest: 'dist' },
          { src: 'sidebar.html', dest: 'dist' },
          { src: 'manifest.json', dest: 'dist' },
          { src: 'src/devtools', dest: 'dist' },
        ],
        hook: 'writeBundle'
      })
    ],
    build: {
      sourcemap: !production,
      minify: false,
      rollupOptions: {
        input: {
          'build/sidebar': resolve(__dirname, 'src/sidebar/main.ts'),
          'build/detector': resolve(__dirname, 'src/detector/detector.ts'),
          'build/background': resolve(__dirname, 'src/background/background.ts'),
          'build/contentscript': resolve(__dirname, 'src/contentscript/contentscript.ts'),
        },
        output: {
          dir: 'dist',
          entryFileNames: '[name].js',
          chunkFileNames: 'build/[name]-[hash].js',
          assetFileNames: 'build/[name][extname]'
        }
      }
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: {
        '@': resolve(__dirname, 'src')
      }
    }
  };
});