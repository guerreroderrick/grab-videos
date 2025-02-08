import { getFileSafeName } from "./filesystem.ts";
import { requireEnv } from "./require-env.ts";

if (import.meta.main) {
    const { ffmpegPath, storageRoot } = requireEnv()

    await main({
        args: Deno.args,
        ffmpegPath,
        storageRoot,
    })
}

type mainParams = {
    args: string[]
    ffmpegPath: string
    storageRoot: string
}
async function main({ args, ffmpegPath, storageRoot, }: mainParams) {
    if (args.length < 1) {
        console.log('usage: download-folder <folder> [folder ...] [--tee-log]')
        return
    }

    const teeLog = args.length > 1 && args.includes('--tee-log')
    for (const arg of args) {
        if (arg === '--tee-log') { continue }
        const jsonPath = arg
        await composeVideo({ jsonPath, teeLog, ffmpegPath, storageRoot, })
    }
}

export type composeVideoParams = {
    jsonPath: string
    teeLog: boolean
    ffmpegPath: string
    storageRoot: string
}
export async function composeVideo({ jsonPath, teeLog, ffmpegPath, storageRoot, }: composeVideoParams) {
    const infoText = await Deno.readTextFile(jsonPath)

    console.log(infoText)
    const info = JSON.parse(infoText)

    const {
        title,
        folderName,
        titleFolderName,
        m3u8Files,
     }: {
        title: string,
        folderName: string,
        titleFolderName: string,
        m3u8Files: string[],
    } = info

    console.log({ title })
    const titlePath = `${storageRoot}/staging/${folderName}/${titleFolderName}`
    const outPath = `${storageRoot}/${folderName}`
    await Deno.mkdir(outPath, { recursive: true })

    let i = 0
    for (const m3u8File of m3u8Files) {
        i++
        const videoBaseName = i === 1 ? title : `${title} - ${i}`
        const safeVideoBaseName = getFileSafeName(videoBaseName)
        const videoName = `${safeVideoBaseName}.mp4`
        const videoPath = `${outPath}/${videoName}`

        // run command: -protocol_whitelist file,http,https,tcp,tls,crypto -allowed_extensions ALL -i $url -c copy -bsf:a aac_adtstoasc $name
        const args = [
            '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
            '-allowed_extensions', 'ALL',
            '-i', `${titlePath}/${m3u8File}`,
            '-c', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            videoPath,
        ]
        const logFile = `${titlePath}/${safeVideoBaseName}.log`
        await runCommandTeeToFile({
            command: ffmpegPath,
            args,
            logFile,
            teeLog,
        })
        console.log(`Created ${videoPath}`)
    }
}

type runCommandTeeToFileParams = {
    command: string
    args: string[]
    logFile: string
    teeLog: boolean
}
async function runCommandTeeToFile({
    command,
    args,
    logFile,
    teeLog,
 }: runCommandTeeToFileParams) {

    const process = new Deno.Command(command, {
        args,
        stdout: 'piped',
        stderr: 'piped',
    })
    const child = process.spawn()

    const file = await Deno.open(logFile, { write: true, create: true, truncate: true })

    try {
        await Promise.all([
            teeStream(child.stdout, file, teeLog),
            teeStream(child.stderr, file, teeLog),
            child.status // Wait for process to finish
        ])
    } finally {
        file.close()
    }
}

async function teeStream(stream: ReadableStream<Uint8Array>, writer: Deno.FsFile, teeLog: boolean) {
    const reader = stream.getReader()
    while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const next = [writer.write(value)]
        if (teeLog) { next.push(Deno.stdout.write(value)) }
        await Promise.all(next)
    }
}
