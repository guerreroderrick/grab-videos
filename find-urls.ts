import puppeteer, { HTTPRequest, HTTPResponse, Page } from 'https://deno.land/x/puppeteer@16.2.0/mod.ts'
import { requireEnv } from "./require-env.ts";
import { getFFmpegSafeFolderName } from "./filesystem.ts";
import Protocol from "https://deno.land/x/puppeteer@16.2.0/vendor/puppeteer-core/vendor/devtools-protocol/types/protocol.d.ts";

const COOKIE_FILE = './cookies.json'

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
async function main({ args, storageRoot }: mainParams) {
    if (args.length < 2) {
        console.log('usage: find-urls <folder> <url> [url ...]')
        return
    }

    const loginParams = requireEnv()
    const { cdnIdentifier } = loginParams
    
    const [folder, ...urls] = args
    await findVideo({ folder, urls, storageRoot, loginParams, cdnIdentifier, })
}

export type findVideoParams = {
    folder: string
    urls: string[]
    storageRoot: string
    loginParams: getLoggedInPageParams
    cdnIdentifier: string
}
export async function findVideo({ folder, urls, storageRoot, loginParams, cdnIdentifier, }: findVideoParams) {
    const results = await process({ urls, loginParams, cdnIdentifier, })
    const folderName = getFFmpegSafeFolderName(folder)
    const stagingName = `${storageRoot}/staging`
    const infoFilenames: string[] = []
    for (const result of results) {
        const titleFolderName = getFFmpegSafeFolderName(result.title)

        const titlePath = `${stagingName}/${folderName}/${titleFolderName}`
        await Deno.mkdir(titlePath, { recursive: true })

        const m3u8 = result.m3u8.map(([ url, body]) => [
            url.split('/').pop()!,
            url,
            body,
        ])
        const m3u8Urls = m3u8.map(([, url]) => url)
        const m3u8Files = m3u8.map(([file]) => file)
        const info = {
            folder,
            folderName,
            pageUrl: result.url,
            title: result.title,
            titleFolderName,
            m3u8Files,
            m3u8Urls,
        }
        for (const [ file, url, body ] of m3u8) {
            await Deno.writeTextFile(`${titlePath}/${file}`, body)
            console.log(`Wrote ${titlePath}}/${file} ${body.length} bytes from ${url}`)
        }
        const infoText = JSON.stringify(info, null, 2)
        const infoFileName = `${stagingName}/${folderName}_${titleFolderName}.json`
        await Deno.writeTextFile(infoFileName, infoText)
        infoFilenames.push(infoFileName)
        console.log(`Wrote ${infoFileName}`)
    }
    return infoFilenames
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
    let latestCookies: Protocol.Network.Cookie[] | undefined
    for (const url of urls) {
        const iframeResult = await getIFrameM3u8Urls({ page, url, cdnIdentifier, })
        if (iframeResult === undefined) { continue }

        const { title, m3u8Body, cookies } = iframeResult
        results.push({ url, title, m3u8: m3u8Body, })
        latestCookies = cookies
    }

    if (latestCookies !== undefined) {
        await saveCookies(latestCookies)
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

async function saveCookies(cookies: Protocol.Network.Cookie[])  {
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
        const cookies = await page.cookies()
        await saveCookies(cookies)
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
    const blockers: string[] = []
    const collectRequests = (eventName: string) => (event: HTTPRequest) => {
        const request = event
        const frame = request.frame()

        const url = request.url()
        if (url.includes('playerError?status=404')) {
            console.log(`playerError ${eventName}:${request.resourceType()}:[${frame?.url()}] → ${url}`)
            if (frame) {
                blockers.push(frame?.url())
            }
            return
        }

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

    const navigate = page.goto(url)
        .catch((error) => console.warn({ url, error }))

    const start = Date.now()
    const promiseIdentifier = (label: string) => () => ({
        time: Date.now() - start,
        promise: label,
    })
    const promiseResult = await Promise.allSettled([
            navigate,
            page.waitForNavigation({ waitUntil: 'networkidle2' })
                .then(promiseIdentifier('waitForNavigation:networkidle2'))
                .catch(promiseIdentifier('waitForNavigation:networkidle2:error')),
        ]).then(p =>
            p.map(r =>
                r.status === 'fulfilled' ? r.value : r.reason
            )
        )

    const pageCookies = await page.cookies()
    m3u8Urls = Array.from(new Set(m3u8Urls))
    cdnSites = Array.from(new Set(cdnSites
        .filter((site) => !blockers.includes(site))
    ))

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
        cookies: pageCookies,
    }
}
