const path = require("path");
const CompressionPlugin = require("compression-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
const WebpackMode = require("webpack-mode");

module.exports = {
    mode: `${WebpackMode}`,
    entry: "./index.js",
    output: {
        filename: "[name].bundle.js",
        path: path.resolve(__dirname, "../build/demo")
    },
    resolve: {
        alias: {
            emception: "../build/emception",
        },
        fallback: {
            "llvm-box.wasm": false,
            "binaryen-box.wasm": false,
            "python.wasm": false,
            "quicknode.wasm": false,
            "path": false,
            "node-fetch": false,
            "vm": false
        },
    },
    plugins: [
        new HtmlWebpackPlugin({
            title: "ScoreCard Creator",
        }),
        new MonacoWebpackPlugin({ languages: ["cpp"] }),
        new CopyWebpackPlugin({
            patterns: [{
                from: "../build/emception/brotli/brotli.wasm",
                to: "brotli/brotli.wasm"
            }, {
                from: "../build/emception/wasm-package/wasm-package.wasm",
                to: "wasm-package/wasm-package.wasm"
            }],
        }),
        new CompressionPlugin({
            exclude: /\.br$/,
        }),
    ],
    module: {
        rules: [{
            test: /\.css$/,
            use: ["style-loader", "css-loader"]
        }, {
            test: /\.wasm$/,
            type: "asset/resource",
        }, {
            test: /\.(pack|br|a)$/,
            type: "asset/resource",
        }, {
            test: /\.worker\.m?js$/,
            exclude: /monaco-editor/,
            use: ["worker-loader"],
        }, {
            test: /\.[ch]$/,
            use: "raw-loader",
        }]
    },
    devServer: {
        allowedHosts: "auto",
        port: "auto",
        server: "https",
        //headers: {
        //    "Cross-Origin-Embedder-Policy": "require-corp",
        //    "Cross-Origin-Opener-Policy": "same-origin",
        //}
    },
};
