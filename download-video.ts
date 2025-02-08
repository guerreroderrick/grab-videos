import { requireEnv } from "./require-env.ts";

if (import.meta.main) {
    const { storageRoot } = requireEnv()

    await main({
        args: Deno.args,
        storageRoot,
    })
}

type mainParams = {
    args: string[]
    storageRoot: string
}
async function main({ args, storageRoot, }: mainParams) {
    if (args.length < 1) {
        console.log('usage: download-folder <jsonPath> [jsonPath ...]')
        return
    }

    for (const jsonPath of args) {
        await downloadVideo({ jsonPath, storageRoot, })
    }
}

export type downloadVideoParams = {
    jsonPath: string
    storageRoot: string
}
export async function downloadVideo({ jsonPath, storageRoot, }: downloadVideoParams) {
    const infoText = await Deno.readTextFile(jsonPath)

    console.log(infoText)

    const info = JSON.parse(infoText)
    const {
        title,
        folderName,
        titleFolderName,
        m3u8Urls,
     }: {
        title: string,
        folderName: string,
        titleFolderName: string,
        m3u8Urls: string[],
    } = info

    console.log({ title })
    const titlePath = `${storageRoot}/staging/${folderName}/${titleFolderName}`
    const urlCount = m3u8Urls.length
    let i = 0
    const encoder = new TextEncoder()
    const client = Deno.createHttpClient({
        http2: true,
    })
    for (const m of m3u8Urls) {
        i++
        const m3u8File = m.split('/').pop()!
        const m3u8Base = m.split('/').slice(0, -1).join('/')
        const m3u8Text = await Deno.readTextFile(`${titlePath}/${m3u8File}`)

        const lines = m3u8Text.split(/\r?\n/)
        const videoSegments = lines
            .filter((line) => !line.startsWith('#'))
            .filter((line) => line.endsWith('.ts'))
        const keyLine = lines.find((line) => line.startsWith('#EXT-X-KEY:'))
        const keyUri = keyLine?.match(/URI="([^"]+)"/)?.[1]

        const downloadSegments = [keyUri, ...videoSegments]

        const downloaders: (() => Promise<void>)[] = []
        const downloadCount = downloadSegments.length
        let startedCount = 0
            , completedCount = 0
        const startTime = Date.now()
        for (const segment of downloadSegments) {
            const segmentPath = `${titlePath}/${segment}`
            const segmentUrl = `${m3u8Base}/${segment}`

            if (await Deno.stat(segmentPath).catch(() => null)) {
                console.log(`Skipping ${segment}...`)
                completedCount++
                continue
            }

            downloaders.push((async () => {
                startedCount++
                const completedPercent = (completedCount / downloadCount * 100).toFixed(2)
                Deno.stdout.write(encoder.encode(`\r[${i} / ${urlCount}] Downloading ${startedCount}, ${completedCount} / ${downloadCount}... ${completedPercent}%${' '.repeat(10)}`))
                const segmentResponse = await fetch(segmentUrl, {
                    client,
                })
                const segmentBuffer = await segmentResponse.arrayBuffer()
                await Deno.writeFile(segmentPath, new Uint8Array(segmentBuffer))
                completedCount++
                const completedPercent2 = (completedCount / downloadCount * 100).toFixed(2)
                Deno.stdout.write(encoder.encode(`\r[${i} / ${urlCount}] Downloading ${startedCount}, ${completedCount} / ${downloadCount}... ${completedPercent2}%${' '.repeat(10)}`))
            }))
        }

        const executing: Promise<void>[] = []

        for (const downloader of downloaders) {
            const selfRemover = downloader()
                .then(() => {
                    const index = executing.indexOf(selfRemover)
                    executing.splice(index, 1)
                })
            executing.push(selfRemover)
            if (executing.length > 7) {
                await Promise.race(executing)
            }
        }
        await Promise.all(executing)
        const taken = (Date.now() - startTime) / 1000
        console.log(`\r[${i} / ${urlCount}] took ${taken} seconds${' '.repeat(30)}`)
    }
}
