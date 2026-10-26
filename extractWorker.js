// Extracts a .7z/.rar archive with 7-Zip (WASM) off the main thread.
// workerData: { archivePath, outputPath }. Posts { ok: true } or { ok: false, error }.
const { workerData, parentPort } = require('worker_threads');
const path = require('path');
const SevenZip = require('7z-wasm');

async function extract({ archivePath, outputPath }) {
    const errors = [];
    const sevenZip = await SevenZip({
        print: () => {},
        printErr: line => errors.push(line)
    });

    // 7-Zip runs in a virtual file system; mount the archive's folder and the output folder into it.
    sevenZip.FS.mkdir('/archive');
    sevenZip.FS.mount(sevenZip.NODEFS, { root: path.dirname(archivePath) }, '/archive');
    sevenZip.FS.mkdir('/output');
    sevenZip.FS.mount(sevenZip.NODEFS, { root: outputPath }, '/output');

    // -y answers yes to prompts, -p- skips the password prompt for encrypted archives.
    const archiveName = '/archive/' + path.basename(archivePath);
    const exitCode = sevenZip.callMain(['x', archiveName, '-o/output', '-y', '-p-']);
    if (exitCode !== 0) {
        const output = errors.join('\n');
        if (/Wrong password/i.test(output)) {
            throw new Error('The archive is password-protected.');
        }
        if (/Cannot open the file as|Is not archive/i.test(output)) {
            throw new Error('The archive is damaged or not a supported format.');
        }
        throw new Error(output.trim() || `7-Zip exited with code ${exitCode}.`);
    }
}

extract(workerData)
    .then(() => parentPort.postMessage({ ok: true }))
    .catch(error => parentPort.postMessage({ ok: false, error: error.message }));
