import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { Terminal } from "xterm";
import { FitAddon } from 'xterm-addon-fit';
import Split from "split-grid";
import { spinner, previewTemplate, miniBrowserTemplate } from "./preview-template.mjs";

import { render, html } from "lit";

import * as Comlink from "comlink";
import EmceptionWorker from "./emception.worker.js";

import { encodeBlob } from "./base43.js"
import deckHeader from "./deck.h"
import exampleCode from "./arpeggios.c"

import "./style.css";
import "xterm/css/xterm.css";

const emception = Comlink.wrap(new EmceptionWorker());
window.emception = emception;
window.Comlink = Comlink;

const editorContainer = document.createElement("div");
const editor = monaco.editor.create(editorContainer, {
	value: "",
	language: "cpp",
	theme: "vs-dark",
});

const terminalContainer = document.createElement("div");
const terminal = new Terminal({
    convertEol: true,
    theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
    },
});
terminal.open(terminalContainer);

const terminalFitAddon = new FitAddon();
terminal.loadAddon(terminalFitAddon);

window.editor = editor;
window.terminal = terminal;

editor.setValue(exampleCode);

emception.onstdout = Comlink.proxy((str) => terminal.write(str + "\n"));
emception.onstderr = Comlink.proxy((str) => terminal.write(str + "\n"));

window.addEventListener("resize", () => {
    editor.layout();
    terminalFitAddon.fit();
});

async function main() {
    render(html`
        <div id="layout">
            <div id="header">
                <div id="title">ScoreCard Creator</div>
                <button id="save">Save</button>
                <button disabled id="compile">Loading</button>
            </div>
            <div id="editor">${editorContainer}</div>
            <div id="vgutter"></div>
            <div id="preview">
                <iframe id="preview-frame"></iframe>
            </div>
            <div id="hgutter"></div>
            <div id="output">
                <div id="terminal">
                    ${terminalContainer}
                </div>
                <div id="status"></div>
            </div>
        </div>
    `, document.body);

    window.split = Split({
        onDrag: () => {
            editor.layout();
            terminalFitAddon.fit();
        },
        columnGutters: [{
            track: 1,
            element: document.getElementById("vgutter"),
        }],
        rowGutters: [{
            track: 2,
            element: document.getElementById("hgutter"),
        }],
    });

    const frame = document.getElementById("preview-frame");
    let url = "";
    function preview(html_content) {
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([html_content], { type: 'text/html' }));
        frame.src = url;
    }

    let miniUrl = "";
    function previewMiniBrowser(html_content) {
        if (miniUrl) URL.revokeObjectURL(miniUrl);
        miniUrl = URL.createObjectURL(new Blob([html_content], { type: 'text/html' }));
        preview(miniBrowserTemplate("main.html", miniUrl));
    }

    preview(previewTemplate(spinner(80), "Loading", ""));

    const status = document.getElementById("status");
    const statusElements = [];
    const onprocessstart = (argv) => {
        const lastEl = statusElements[statusElements.length - 1] || status;
        const newEl = document.createElement("div");
        newEl.className = "process-status";
        render(html`
            <div class="process-argv" title=${argv.join(" ")}>${argv.join(" ")}</div>
        `, newEl);
        statusElements.push(newEl);
        lastEl.appendChild(newEl);

        terminalFitAddon.fit();
        requestAnimationFrame(() => {
            terminalFitAddon.fit();
        });
    };
    const onprocessend = () => {
        const lastEl = statusElements.pop();
        if (lastEl) lastEl.remove();

        terminalFitAddon.fit();
        requestAnimationFrame(() => {
            terminalFitAddon.fit();
        });
    };
    emception.onprocessstart = Comlink.proxy(onprocessstart);
    emception.onprocessend = Comlink.proxy(onprocessend);

    function run(command) {
        onprocessstart(`/emscripten/${command}`.split(/\s+/g))
        terminal.write(`$ ${command}\n`)
        return emception.run(command)
    }

    async function build(source) {
        const reportSize = async () => {
            const size = (await emception.fileSystem.FS.stat("/working/main.wasm")).size
            terminal.write(`${size} bytes\n`)
            return size
        }

        terminal.write("Compiling...\n")
        await emception.fileSystem.writeFile("/working/main.c", source)
        if ((await run("emcc -Oz -Wall --no-entry -sSUPPORT_ERRNO=0 -sSUPPORT_LONGJMP=0 -sEXPORTED_FUNCTIONS=_process -o main.wasm main.c")).returncode) return
        await reportSize()

        terminal.write("Stripping...\n")
        let wat = (await emception._run_process(["/usr/bin/wasm-dis", "/working/main.wasm"])).stdout
        wat = wat.split("\n").filter(line => !/^ *\(export "stack|_initialize|indirect_function_table/.test(line))
            .map(line => line.replace(/^ *\(export "memory"/, '(export "m"').replace(/^ *\(export "title"/, '(export "d"').replace(/^ *\(export "setup"/, '(export "s"').replace(/^ *\(export "process"/, '(export "p"')).join("\n")
        await emception.fileSystem.writeFile("/working/main.wat", wat)
        await emception._run_process(["/usr/bin/wasm-as", "-all", "/working/main.wat", "-o", "/working/main.wasm"])
        let size = await reportSize()

        terminal.write("Optimizing...\n")
        // Run wasm-opt until size converges.
        let oldSize
        do {
            await emception._run_process(["/usr/bin/wasm-opt", "-all", "-Oz", "/working/main.wasm", "-o", "/working/main.wasm"])
            oldSize = size
            size = await reportSize()
        } while (size < oldSize)
        await emception._run_process(["/usr/bin/wasm-opt", "-all", "-Oz", "/working/main.wasm", "-o", "/working/main.wasm"])

        return emception.fileSystem.readFile("/working/main.wasm")
    }

    const save = document.getElementById("save")
    save.addEventListener("click", () => {
        const blob = new Blob([editor.getValue()])
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.style.display = "none"
        a.href = url
        a.download = "card.c"
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
    })

    const compile = document.getElementById("compile");
    compile.addEventListener("click", async () => {
        compile.disabled = true;
        compile.textContent = "Compiling";
        status.textContent = "Running:";
        preview(previewTemplate(spinner(80), "Compiling", ""));
        try {
            terminal.reset();
            const wasm = await build(editor.getValue());
            if (wasm) {
                frame.src = "https://ijc8.me/s?c=" + encodeBlob(wasm)
            } else {
                preview(previewTemplate("", "", "Compilation failed, check the output below"));
            }
        } catch (err) {
            preview(previewTemplate("", "", "Something went wrong, please file a bug report"));
            console.error(err);
        } finally {
            status.textContent = "Idle";
            statusElements.splice(0, statusElements.length);
            compile.textContent = "Compile!";
            compile.disabled = false;
        }
    });

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            editor.layout();
            terminalFitAddon.fit();
        });
    });
    terminal.write("Loading Emception...\n");
    status.textContent = "Loading...";

    await emception.init();
    await emception.fileSystem.writeFile("/working/deck.h", deckHeader)

    terminal.reset();
    terminal.write("Emception is ready\n");
    status.textContent = "Idle";
    compile.disabled = false;
    compile.textContent = "Compile!";
    const previewText = `
        <h2>Welcome to ScoreCard Creator!</h2>
        <div style="text-align: left">
            <p>ScoreCard Creator allows you to create <a href="https://github.com/ijc8/scorecard">score cards</a> without leaving the comfort of your browser (or first installing the Emscripten SDK)!</p>
            <p>Score cards are tiny generative music programs small enough to fit in QR codes (and thus distributed as physical cards). These programs take the form of audio-generating WebAssembly binaries.</p>
            <p>ScoreCard Creator provides an editor and compiler that run in the browser, so that you can make a score card without fussing with code editors and compiler toolchains.</p>
            <p>It also includes <code>deck.h</code>, a small library of utilities for composing cards. You can see the contents of <code>deck.h</code> <a href="https://github.com/ijc8/scorecard/blob/main/examples/deck.h">here</a>.</p>
            <p>A brief tutorial on how to write score cards is available <a href="https://ijc8.me/nime2024">here</a>.</p>
            <p>This application is based on the wonderful work of <a href="https://github.com/jprendes">jprendes</a> on <a href="https://github.com/jprendes/emception">Emception</a>, which enables us to run Emscripten in the browser.</p>
        </div>
        <div style="font-weight: bold">Your compiled score card will appear here. Click <div style="display: inline-block;border: 1px solid #858585;background: #454545;color: #cfcfcf;font-size: 15px;padding: 5px 10px;border-radius: 3px;">Compile!</div> above to start.</div>
        <div style="font-weight: bold">If you write something you like, make sure to click <div style="display: inline-block;border: 1px solid #858585;background: #454545;color: #cfcfcf;font-size: 15px;padding: 5px 10px;border-radius: 3px;">Save</div> to download your code.</div>
    `
    preview(previewTemplate("", "", previewText));
}

main();
