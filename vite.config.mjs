import { defineConfig } from 'vite';
import aurelia from '@aurelia/vite-plugin';
import { resolve } from 'path';
import copy from 'rollup-plugin-copy';

// Extension scripts run as classic scripts sharing one global scope, so
// each bundle is wrapped in an IIFE to keep top-level bindings private
const CLASSIC_SCRIPTS = new Set(['build/detector.js', 'build/contentscript.js', 'build/background.js', 'build/devtools.js']);

function wrapClassicScripts() {
  return {
    name: 'aurelia-devtools:wrap-classic-scripts',
    enforce: 'post',
    renderChunk(code, chunk) {
      if (!CLASSIC_SCRIPTS.has(chunk.fileName)) return null;
      return { code: `(() => {\n${code}\n})();\n`, map: null };
    }
  };
}

export default defineConfig(({ mode }) => {
  const production = mode === 'production';

  if (mode === 'hook') {
    // Page-side hook: a self-contained IIFE evaluated inside the inspected
    // page, so it must not emit import statements or top-level declarations
    return {
      build: {
        emptyOutDir: false,
        sourcemap: false,
        minify: false,
        outDir: 'dist/build',
        lib: {
          entry: resolve(__dirname, 'src/hook/index.ts'),
          formats: ['iife'],
          name: 'AureliaDevtoolsHook',
          fileName: () => 'hook.js'
        }
      }
    };
  }

  return {
    root: '.',
    plugins: [
      aurelia(),
      wrapClassicScripts(),
      copy({
        targets: [
          { src: 'src/popups', dest: 'dist' },
          { src: 'images', dest: 'dist' },
          { src: 'sidebar.html', dest: 'dist' },
          { src: 'manifest.json', dest: 'dist' },
          { src: 'src/devtools/devtools.html', dest: 'dist/devtools' },
        ],
        hook: 'writeBundle'
      })
    ],
    build: {
      sourcemap: !production,
      minify: production,
      emptyOutDir: false,
      rollupOptions: {
        input: {
          'build/sidebar': resolve(__dirname, 'src/sidebar/main.ts'),
          'build/detector': resolve(__dirname, 'src/detector/detector.ts'),
          'build/background': resolve(__dirname, 'src/background/background.ts'),
          'build/contentscript': resolve(__dirname, 'src/contentscript/contentscript.ts'),
          'build/devtools': resolve(__dirname, 'src/devtools/devtools.ts'),
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
