const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const packageJson = require('./package.json');

module.exports = (env, argv) => {
  const browser = env.browser || 'chrome';
  const isDev = argv.mode === 'development';

  const entries = {
    background: './src/background/index.ts',
    content: './src/content/index.ts',
    popup: './src/popup/index.tsx',
    options: './src/options/index.tsx',
  };

  // Add offscreen entry only for Chrome
  if (browser === 'chrome') {
    entries.offscreen = './src/background/offscreen/offscreen.ts';
  }

  return {
    mode: argv.mode || 'development',
    devtool: isDev ? 'inline-source-map' : false,
    entry: entries,
    output: {
      path: path.resolve(__dirname, `dist/${browser}`),
      filename: '[name].js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          {
            from: `src/manifest/manifest.${browser}.json`,
            to: 'manifest.json',
            transform(content) {
              // package.jsonのバージョンをmanifest.jsonに自動同期
              const manifest = JSON.parse(content.toString());
              manifest.version = packageJson.version;
              return JSON.stringify(manifest, null, 2);
            },
          },
          {
            from: 'public/icons',
            to: 'icons',
            noErrorOnMissing: true,
          },
        ],
      }),
      new HtmlPlugin({
        template: 'src/popup/index.html',
        filename: 'popup.html',
        chunks: ['popup'],
      }),
      new HtmlPlugin({
        template: 'src/options/index.html',
        filename: 'options.html',
        chunks: ['options'],
      }),
      // Add offscreen HTML only for Chrome
      ...(browser === 'chrome'
        ? [
            new HtmlPlugin({
              template: 'src/background/offscreen/offscreen.html',
              filename: 'offscreen.html',
              chunks: ['offscreen'],
            }),
          ]
        : []),
    ],
    // Service Workerのためのtarget設定
    // Note: offscreen document uses 'web' target, not 'webworker'
    target: browser === 'chrome' ? 'webworker' : 'web',
  };
};
