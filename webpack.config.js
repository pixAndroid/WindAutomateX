const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env) => {
  const isMain = env && env.target === 'main';

  if (isMain) {
    return {
      mode: 'development',
      entry: './src/main/index.ts',
      target: 'electron-main',
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            use: 'ts-loader',
            exclude: /node_modules/,
          },
        ],
      },
      resolve: {
        extensions: ['.tsx', '.ts', '.js'],
      },
      output: {
        filename: 'index.js',
        path: path.resolve(__dirname, 'dist/main'),
      },
      node: {
        __dirname: false,
        __filename: false,
      },
      externals: {
        'better-sqlite3': 'commonjs better-sqlite3',
      },
    };
  }

  // Renderer config
  return {
    mode: 'development',
    entry: './src/renderer/index.tsx',
    target: 'electron-renderer',
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
      filename: 'renderer.js',
      path: path.resolve(__dirname, 'dist/renderer'),
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/renderer/index.html',
        filename: 'index.html',
      }),
    ],
  };
};
