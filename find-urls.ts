import { assert } from 'jsr:@std/assert/assert'
import puppeteer, { HTTPRequest, HTTPResponse, Page } from 'https://deno.land/x/puppeteer@16.2.0/mod.ts'

const COOKIE_FILE = './cookies.json'

if (import.meta.main) {
    const ffmpegPath = Deno.env.get('FFmpeg_path')
    const storageRoot = Deno.env.get('Storage_root')
    console.log({
        ffmpegPath,
        storageRoot,
    })
    if (!ffmpegPath) {
        console.log('FFmpeg_path not set.')
        Deno.exit(1)
    }
    if (!storageRoot) {
        console.log('Storage_root not set.')
        Deno.exit(1)
    }

    await main({
        args: Deno.args,
    })
}

type mainParams = {
    args: string[]
}
async function main({ args }: mainParams) {
    const urls = args
    if (urls.length === 0) {
        console.log('No URLs provided.')
        return
    }

    const loginUrl = Deno.env.get('login_url')
    assert(loginUrl?.length ?? 0 > 0, 'No login URL provided.')
    const loggedInSelector = Deno.env.get('logged_in_selector')
    assert(loggedInSelector?.length ?? 0 > 0, 'No logged in selector provided.')
    const cdnIdentifier = Deno.env.get('cdn_identifier')
    assert(cdnIdentifier !== undefined, 'No CDN identifier provided.')
    const loginParams = {
        loginUrl: loginUrl!,
        loggedInSelector: loggedInSelector!,
    }

    if (urls[0].startsWith('http')) {
        await findVideo({ urls, loginParams, cdnIdentifier, })
    } else {
        await downloadFolder({ folder: urls[0] })
    }
}

type downloadFolderParams = {
    folder: string
}
async function downloadFolder({ folder }: downloadFolderParams) {
    const infoText = await Deno.readTextFile(`./${folder}/info.json`)
    const info = JSON.parse(infoText)
    const { title, m3u8 }: { title: string, m3u8: string[], } = info

    console.log({ title })
    for (const m of m3u8) {
        const m3u8File = m.split('/').pop()!
        const m3u8Base = m.split('/').slice(0, -1).join('/')
        const m3u8Text = await Deno.readTextFile(`./${folder}/${m3u8File}`)

        const lines = m3u8Text.split(/\r?\n/)
        const videoSegments = lines
            .filter((line) => !line.startsWith('#'))
            .filter((line) => line.endsWith('.ts'))
        const keyLine = lines.find((line) => line.startsWith('#EXT-X-KEY:'))
        const keyUri = keyLine?.match(/URI="([^"]+)"/)?.[1]

        const downloadSegments = [keyUri, ...videoSegments]

        const promises: Promise<void>[] = []
        for (const segment of downloadSegments) {
            const segmentPath = `./${folder}/${segment}`
            const segmentUrl = `${m3u8Base}/${segment}`

            if (await Deno.stat(segmentPath).catch(() => null)) {
                console.log(`Skipping ${segment}...`)
                continue
            }

            console.log(`Downloading ${segment}...`)
            promises.push((async () => {
                const segmentResponse = await fetch(segmentUrl)
                const segmentBuffer = await segmentResponse.arrayBuffer()
                await Deno.writeFile(segmentPath, new Uint8Array(segmentBuffer))
                console.log(`Completed ${segment}...`)
            })())
        }
        await Promise.all(promises)
    }
}

type findVideoParams = {
    urls: string[]
    loginParams: getLoggedInPageParams
    cdnIdentifier: string
}
async function findVideo({ urls, loginParams, cdnIdentifier, }: findVideoParams) {
    const results = await process({ urls, loginParams, cdnIdentifier, })
    for (const result of results) {
        const titleFolder = result.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()
        console.log(`Writing to ${titleFolder}...`)
        await Deno.mkdir(`./${titleFolder}`, { recursive: true })

        const info = {
            pageUrl: result.url,
            title: result.title,
            m3u8: result.m3u8.map(([ url, _ ]) => url),
        }
        const infoText = JSON.stringify(info, null, 2)
        await Deno.writeTextFile(`./${titleFolder}/info.json`, infoText)
        for (const [ url, body ] of result.m3u8) {
            const m3u8File = url.split('/').pop()!
            await Deno.writeTextFile(`./${titleFolder}/${m3u8File}`, body)
        }
    }
    console.log({ results: results.map(({ m3u8, ...rest }) => ({
        ...rest,
        m3u8Url: m3u8.map(([ url, _ ]) => url),
        m3u8BodyLength: m3u8.map(([ _, body ]) => body.length),
    })) })
}

type processParams = {
    urls: string[]
    loginParams: getLoggedInPageParams
    cdnIdentifier: string
}
async function process({
    urls,
    loginParams,
    cdnIdentifier,
}: processParams) {
    const { browser, page } = await getLoggedInPage(loginParams)

    const results: {
        url: string,
        title: string,
        m3u8: [url: string, body: string][],
    }[] = []
    for (const url of urls) {
        const { title, m3u8Body, } = await getIFrameM3u8Urls({ page, url, cdnIdentifier, })
        results.push({ url, title, m3u8: m3u8Body, })
    }

    await browser.close();
    return results
}

async function loadCookies(page: Page) {
    try {
        const cookies = JSON.parse(await Deno.readTextFile(COOKIE_FILE));
        await page.setCookie(...cookies);
        return true
    } catch (error) {
        console.log({ msg: 'No saved cookies found, proceeding without.', error, })
        return false
    }
}

async function saveCookies(page: Page) {
    const cookies = await page.cookies();
    await Deno.writeTextFile(COOKIE_FILE, JSON.stringify(cookies, null, 2));
    console.log('Cookies saved successfully.');
}

type getLoggedInPageParams = {
    loginUrl: string
    loggedInSelector: string
}
async function getLoggedInPage({
    loginUrl,
    loggedInSelector,
}: getLoggedInPageParams) {
    const browser = await puppeteer.launch({
        args: ['--disable-features=site-per-process',],
        executablePath: `C:/Program Files/Google/Chrome/Application/chrome.exe`,
        headless: false,
    })

    const page = await browser.newPage()
    page.setViewport({ width: 1024, height: 768, })

    const loadedCookies = await loadCookies(page)
    if (!loadedCookies) {
        await page.goto(loginUrl)

        await Promise.race([
            page.waitForNavigation({ timeout: 2 * 60 * 1000, }),
            page.waitForSelector(loggedInSelector),
        ]);

        console.log('Login detected, saving cookies...')
        await saveCookies(page)
    }
    return {
        browser,
        page,
    }
}

type getIFrameM3u8UrlsParams = {
    page: Page
    url: string
    cdnIdentifier: string
}
async function getIFrameM3u8Urls({
    page,
    url,
    cdnIdentifier,
}: getIFrameM3u8UrlsParams) {
    const m3u8Body: [url: string, body: string][] = []
    let m3u8Urls: string[] = []
    let cdnSites: string[] = []

    const ignorePrefixes = new Map<string, number>()
    for (const ignore of ['blob:https', 'data:application/font-woff', 'data:image']) {
        ignorePrefixes.set(ignore, 0)
    }
    const ignoreExtensions = new Map<string, number>()
    for (const ignore of ['.css', '.jpg', '.js', '.key', '.php', '.png', '.ts', '.woff2']) {
        ignoreExtensions.set(ignore, 0)
    }
    const collectRequests = (eventName: string) => (event: HTTPRequest) => {
        const request = event
        const frame = request.frame()

        const url = request.url()

        for (const [ prefix, count ] of ignorePrefixes) {
            if (url.startsWith(prefix)) {
                ignorePrefixes.set(prefix, count + 1)
                return
            }
        }

        const urlPath = url.replace(/\?.*$/, '')
        const lastDot = urlPath.lastIndexOf('.')
        const ext = lastDot === -1 ? '' : urlPath.slice(lastDot)
        if (ignoreExtensions.has(ext)) {
            ignoreExtensions.set(ext, ignoreExtensions.get(ext)! + 1)
            return
        }

        if (url.includes('.m3u8')) {
            console.log(`${eventName}:${request.resourceType()}:[${frame?.url()}] → ${url}`)
            m3u8Urls.push(url)
        } else if (url.includes(cdnIdentifier)) {
            console.log(`cdn ${eventName}:${request.resourceType()}:[${frame?.url()}] → ${url}`)
            cdnSites.push(url)
        } else {
            console.log(`ignored ${eventName}:${request.resourceType()}:[${frame?.url()}] → ${url}`)
        }
    }
    const collectResponse = (event: HTTPResponse) => {
        if (event.status() !== 200) { return }

        const request = event.request()
        if (request.resourceType() !== 'xhr') { return }
        if (!event.url().endsWith('.m3u8')) { return }
        
        (async () => {
            const body = await event.text()
            m3u8Body.push([event.url(), body])
        })()
    }

    const events = [
        ['request', collectRequests('request')],
        ['requestfinished', collectRequests('requestfinished')],
        ['requestfailed', collectRequests('requestfailed')],
        ['requestservedfromcache', collectRequests('requestservedfromcache')],
    ] as const

    for (const [ eventName, handler ] of events) {
        page.on(eventName, handler)
    }
    page.on('response', collectResponse)

    page.goto(url)

    const start = Date.now()
    const promiseResult = await Promise.allSettled([
        // wait for all page resources to load
        Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' })
                .then(() => ({
                    time: Date.now() - start,
                    promise: 'waitForNavigation:networkidle2',
                })),
            page.waitForNetworkIdle()
                .then(() => ({
                    time: Date.now() - start,
                    promise: 'waitForNetworkIdle',
                })),
            page.waitForNetworkIdle({ idleTime: 500 })
                .then(() => ({
                    time: Date.now() - start,
                    promise: 'waitForNetworkIdle:idleTime=500',
                })),
        ]),
        new Promise((resolve) => setTimeout(resolve, 5000))
            .then(() => ({
                time: Date.now() - start,
                promise: 'timeout:5000',
            })),
    ])

    m3u8Urls = Array.from(new Set(m3u8Urls))
    cdnSites = Array.from(new Set(cdnSites))

    console.log({
        m3u8Body,
    })
    console.log({ promiseResult })
    console.log({
        m3u8Urls,
        cdnSites,
        ignoreExtensions,
        ignorePrefixes,
    })

    for (const [ eventName, handler ] of events) {
        page.off(eventName, handler)
    }
    page.off('response', collectResponse)

    const title = await page.title()

    for (let i = 0; i < cdnSites.length && m3u8Urls.length === 0; i++) {
        const cdnSite = cdnSites[i]
        console.log(`++++ Trying to find m3u8 URLs from ${cdnSite}`)
        const results = await getIFrameM3u8Urls({ page, url: cdnSite, cdnIdentifier, })
        m3u8Body.push(...results.m3u8Body)
    }
    return {
        title,
        m3u8Body,
    }
}
