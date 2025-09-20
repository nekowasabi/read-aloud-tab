const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
  const browser = env.browser || 'chrome';
  const isDev = argv.mode === 'development';

  return {
    mode: argv.mode || 'development',
    devtool: isDev ? 'inline-source-map' : false,
    entry: {
      background: './src/background/index.ts',
      content: './src/content/index.ts',
      popup: './src/popup/index.tsx',
    },
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
    ],
    // Service Workerのためのtarget設定
    target: browser === 'chrome' ? 'webworker' : 'web',
  };
};